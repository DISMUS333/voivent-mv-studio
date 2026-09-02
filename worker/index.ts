//==============================================================================
// モデル / ort WASM 配信 ＆ Workers AI 音声文字起こし Worker。
//
// 担当機能:
// 1. /models/* と /ort/*: R2 バケットからの大容量モデル・WASM ストリーミング配信
// 2. /api/transcribe: Cloudflare Workers AI (@cf/openai/whisper-large-v3-turbo)
//    による超高速・高精度ボーカル歌詞文字起こし & タイムスタンプ生成
//==============================================================================

/** R2 バケット ＆ Workers AI バインディング */
export interface Env {
    STEM_MODELS: {
        get: (key: string, options?: { range?: { offset: number; length?: number } }) => Promise<{
            body: ReadableStream;
            size: number;
            range?: { offset: number; length: number };
            httpEtag: string;
            writeHttpMetadata: (headers: Headers) => void;
        } | null>;
        head: (key: string) => Promise<{ size: number; httpEtag: string; writeHttpMetadata: (headers: Headers) => void } | null>;
    };
    AI?: {
        run: (model: string, inputs: { audio: number[] | Uint8Array; language?: string }) => Promise<{
            text?: string;
            vtt?: string;
            word_count?: number;
            words?: Array<{ word: string; start: number; end: number }>;
            segments?: Array<{ text: string; start: number; end: number }>;
        }>;
    };
}

/** 配信を許可する名前空間 (/models, /ort) */
const ALLOWED_NAMESPACES = ['models', 'ort'] as const;

/** /<名前空間>/<ファイル名> 形式のキーのみ許可する (パストラバーサル防止) */
export function objectKeyOf(pathname: string): string | null {
    const m = /^\/([a-z]+)\/([A-Za-z0-9._-]+)$/.exec(pathname);
    if (!m) return null;
    const [ns, file] = [m[1], m[2]];
    if (!(ALLOWED_NAMESPACES as readonly string[]).includes(ns)) return null;
    return `${ns}/${file}`;
}

/** Range ヘッダー (例: bytes=12345-) を R2 の範囲指定へ変換 */
export function parseRange(header: string | null): { offset: number; length?: number } | undefined {
    if (!header) return undefined;
    const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
    if (!m) return undefined;
    const offset = Number(m[1]);
    if (!Number.isFinite(offset) || offset < 0) return undefined;
    return m[2] ? { offset, length: Number(m[2]) - offset + 1 } : { offset };
}

/** VTT タイムスタンプ文字列 ("00:01:23.450" または "01:23.450") を秒数 (float) に変換 */
export function parseVttTimestamp(ts: string): number {
    const parts = ts.trim().split(':');
    if (parts.length === 3) {
        return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        return Number(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(ts) || 0;
}

/** WebVTT 形式テキストから歌詞アイテム配列をパース */
export function parseVttToLyrics(vtt: string): Array<{ text: string; time: number; duration: number }> {
    const lines = vtt.split(/\r?\n/);
    const lyrics: Array<{ text: string; time: number; duration: number }> = [];
    let currentStart: number | null = null;
    let currentEnd: number | null = null;
    let currentText: string[] = [];

    const timeRegex = /((?:\d+:)?\d+:\d+\.\d+)\s*-->\s*((?:\d+:)?\d+:\d+\.\d+)/;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'WEBVTT' || /^\d+$/.test(trimmed)) continue;

        const timeMatch = timeRegex.exec(trimmed);
        if (timeMatch) {
            if (currentStart !== null && currentEnd !== null && currentText.length > 0) {
                const text = currentText.join(' ').trim();
                if (text) {
                    lyrics.push({
                        text,
                        time: Number(currentStart.toFixed(2)),
                        duration: Number(Math.max(0.6, currentEnd - currentStart).toFixed(2)),
                    });
                }
                currentText = [];
            }
            currentStart = parseVttTimestamp(timeMatch[1]);
            currentEnd = parseVttTimestamp(timeMatch[2]);
        } else if (currentStart !== null) {
            currentText.push(trimmed);
        }
    }

    if (currentStart !== null && currentEnd !== null && currentText.length > 0) {
        const text = currentText.join(' ').trim();
        if (text) {
            lyrics.push({
                text,
                time: Number(currentStart.toFixed(2)),
                duration: Number(Math.max(0.6, currentEnd - currentStart).toFixed(2)),
            });
        }
    }

    return lyrics;
}

/** 単語リストを自然なポーズ・単語数でフレーズにまとめる */
export function groupWordsIntoPhrases(
    words: Array<{ word: string; start: number; end: number }>,
    maxWords = 6,
    pauseThreshold = 0.45,
): Array<{ text: string; time: number; duration: number }> {
    const phrases: Array<{ text: string; time: number; duration: number }> = [];
    let buf: Array<{ word: string; start: number; end: number }> = [];

    const flush = () => {
        if (buf.length === 0) return;
        const text = buf.map((w) => w.word).join('').trim();
        if (text) {
            const start = round(buf[0].start);
            const end = round(buf[buf.length - 1].end);
            const dur = round(Math.max(0.6, end - start));
            phrases.push({ text, time: start, duration: dur });
        }
        buf = [];
    };

    const round = (num: number) => Number(num.toFixed(2));

    for (const word of words) {
        if (!word.word || !word.word.trim()) continue;
        if (buf.length > 0) {
            const gap = word.start - buf[buf.length - 1].end;
            if (gap >= pauseThreshold || buf.length >= maxWords) {
                flush();
            }
        }
        buf.push(word);
    }
    flush();

    return phrases;
}

const HALLUCINATION_PATTERNS = [
    /ご視聴(?:ありがとう|頂きありがとう|いただきありがとう|感謝)/,
    /視聴(?:ありがとう|頂きありがとう|いただきありがとう|感謝)/,
    /チャンネル登録/,
    /高評価/,
    /Thank you for watching/i,
    /Thanks for watching/i,
    /Subtitles by/i,
    /Translated by/i,
    /Please subscribe/i,
];

/** 幻覚（YouTube 定型字幕・無音時の誤出力）を検知して除外 */
export function isHallucinatedLyric(text: string): boolean {
    const clean = text.trim();
    if (!clean) return true;
    return HALLUCINATION_PATTERNS.some((pat) => pat.test(clean));
}

/** Whisper 出力（VTT, words, segments, text）を統合パース */
export function parseWhisperResultToLyrics(result: {
    text?: string;
    vtt?: string;
    words?: Array<{ word: string; start: number; end: number }>;
    segments?: Array<{ text: string; start: number; end: number; no_speech_prob?: number }>;
}): Array<{ text: string; time: number; duration: number }> {
    if (!result) return [];

    let items: Array<{ text: string; time: number; duration: number }> = [];

    // 1. words (単語単位タイムスタンプ) があれば最優先でフレーズ化
    if (Array.isArray(result.words) && result.words.length > 0) {
        items = groupWordsIntoPhrases(result.words);
    } else if (Array.isArray(result.segments) && result.segments.length > 0) {
        // 1b. segments 配下に words が含まれる場合も単語単位でフレーズ化
        const nestedWords: Array<{ word: string; start: number; end: number }> = [];
        for (const seg of result.segments as any[]) {
            if (seg.no_speech_prob && seg.no_speech_prob > 0.6) continue;
            if (Array.isArray(seg.words) && seg.words.length > 0) {
                nestedWords.push(...seg.words);
            }
        }
        if (nestedWords.length > 0) {
            items = groupWordsIntoPhrases(nestedWords);
        } else {
            // 2. segments (セグメント単位タイムスタンプ) があれば変換
            items = result.segments
                .filter((s) => s.text && s.text.trim() && (!s.no_speech_prob || s.no_speech_prob <= 0.6))
                .map((s) => ({
                    text: s.text.trim(),
                    time: Number(s.start.toFixed(2)),
                    duration: Number(Math.max(0.6, s.end - s.start).toFixed(2)),
                }));
        }
    } else if (result.vtt && result.vtt.includes('-->')) {
        // 3. VTT 形式があれば VTT パース
        items = parseVttToLyrics(result.vtt);
    } else if (result.text && result.text.trim()) {
        // 4. テキストのみの場合 (単一フレーズフォールバック)
        items = [{ text: result.text.trim(), time: 0.0, duration: 4.0 }];
    }

    // 幻覚（「ご視聴ありがとうございました」等）を完全除去
    return items.filter((item) => !isHallucinatedLyric(item.text));
}

/** Uint8Array を Base64 文字列へエンコード */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any);
    }
    return btoa(binary);
}

/** Base64 文字列を Uint8Array へ復元 */
export function decodeBase64Audio(b64: string): Uint8Array {
    const cleanB64 = b64.replace(/^data:audio\/[a-z0-9]+;base64,/, '').trim();
    const binStr = atob(cleanB64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        // ── 🎙 Workers AI 音声文字起こし (/api/transcribe) ─────────────────
        if (url.pathname === '/api/transcribe') {
            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    status: 204,
                    headers: {
                        'access-control-allow-origin': '*',
                        'access-control-allow-methods': 'POST, OPTIONS',
                        'access-control-allow-headers': 'content-type',
                        'access-control-max-age': '86400',
                    },
                });
            }

            if (request.method !== 'POST') {
                return new Response(JSON.stringify({ error: 'method not allowed' }), {
                    status: 405,
                    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
                });
            }

            if (!env.AI) {
                return new Response(
                    JSON.stringify({ error: 'Cloudflare Workers AI binding is not configured in this environment' }),
                    { status: 500, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } },
                );
            }

            try {
                let b64Audio = '';
                let language = url.searchParams.get('lang') || 'ja';

                const contentType = request.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const body = (await request.json()) as { audioBase64?: string; language?: string };
                    if (body.audioBase64) {
                        b64Audio = body.audioBase64.replace(/^data:audio\/[a-z0-9]+;base64,/, '').trim();
                    }
                    if (body.language) {
                        language = body.language;
                    }
                } else {
                    const buf = await request.arrayBuffer();
                    if (buf.byteLength > 0) {
                        b64Audio = uint8ArrayToBase64(new Uint8Array(buf));
                    }
                }

                if (!b64Audio) {
                    return new Response(JSON.stringify([]), {
                        status: 200,
                        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
                    });
                }

                // 🚀 Cloudflare Workers AI (@cf/openai/whisper-large-v3-turbo) を直接実行
                // vad_filter は歌声を無音判定で誤削除するため false、initial_prompt の幻覚混入を排除
                const aiResult = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
                    audio: b64Audio,
                    language: language || 'ja',
                    task: 'transcribe',
                    vad_filter: false,
                    condition_on_previous_text: false,
                });

                const lyrics = parseWhisperResultToLyrics(aiResult);

                return new Response(JSON.stringify(lyrics), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                        'access-control-allow-origin': '*',
                    },
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error('[Workers AI whisper-large-v3-turbo error]:', message);
                return new Response(JSON.stringify({ error: message }), {
                    status: 500,
                    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
                });
            }
        }

        // ── 📦 モデル / WASM 配信 (/models/*, /ort/*) ──────────────────────
        const isModelPath = url.pathname.startsWith('/models/') || url.pathname.startsWith('/ort/');
        if (!isModelPath) {
            return new Response(JSON.stringify({ error: 'not found' }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
            });
        }

        // デスクトップ WebView 等のクロスオリジン Range 取得のための事前リクエスト
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'access-control-allow-origin': '*',
                    'access-control-allow-methods': 'GET, OPTIONS',
                    'access-control-allow-headers': 'range',
                    'access-control-max-age': '86400',
                },
            });
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('method not allowed', { status: 405 });
        }

        const key = objectKeyOf(url.pathname);
        if (!key) {
            return new Response(JSON.stringify({ error: 'invalid object path' }), {
                status: 400,
                headers: { 'content-type': 'application/json' },
            });
        }

        // HEAD: ボディなしでメタデータのみ返す (ツール / ブラウザの事前確認用)
        if (request.method === 'HEAD') {
            const meta = await env.STEM_MODELS.head(key);
            if (!meta) {
                return new Response(JSON.stringify({ error: 'model not found' }), {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                });
            }
            const headHeaders = new Headers();
            meta.writeHttpMetadata(headHeaders);
            headHeaders.set('etag', meta.httpEtag);
            headHeaders.set('accept-ranges', 'bytes');
            headHeaders.set('access-control-allow-origin', '*');
            headHeaders.set('content-length', String(meta.size));
            return new Response(null, { status: 200, headers: headHeaders });
        }

        const range = parseRange(request.headers.get('range'));
        const obj = await env.STEM_MODELS.get(key, range ? { range } : undefined);
        if (!obj) {
            return new Response(JSON.stringify({ error: 'model not found' }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
            });
        }

        const headers = new Headers();
        obj.writeHttpMetadata(headers);
        headers.set('etag', obj.httpEtag);
        headers.set('accept-ranges', 'bytes');
        // クロスオリジン (デスクトップ WebView) 取得を許可。same-origin では無害
        headers.set('access-control-allow-origin', '*');
        // モデルは不変データなので 1 年キャッシュ (デプロイ差し替え時はキーを変更)
        headers.set('cache-control', 'public, max-age=31536000, immutable');

        const isPartial = range !== undefined && obj.range !== undefined;
        if (isPartial) {
            const start = obj.range!.offset;
            const end = start + (obj.range!.length ?? obj.size - start) - 1;
            headers.set('content-range', `bytes ${start}-${end}/${obj.size}`);
        }
        headers.set('content-length', String(obj.range?.length ?? obj.size));

        return new Response(obj.body, { status: isPartial ? 206 : 200, headers });
    },
};
