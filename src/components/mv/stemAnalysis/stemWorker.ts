//==============================================================================
// ステム分離ワーカー。
// spike-stem (Phase 0 ベンチスパイク) の segmentWorker.ts を本体統合向けに調整。
// UI スレッドをブロックせず、推論と解析 (StemAnalysis 生成) をここで実行する。
//==============================================================================

/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';
import { DemucsProcessor, CONSTANTS } from './vendor/demucs-web/src/index.js';
import { buildStemAnalysis } from './stemAnalyzer';
import type {
    StemAnalysis,
    StemBuffers,
    StemKind,
    StemWorkerRequest,
    StemWorkerResponse,
} from './types';
import { STEM_KINDS } from './types';
import { computePeaks } from './stemPeaks';

// Web デプロイ時に vite.config.web.ts の define で注入される ort WASM URL。
// 未定義 (デスクトップ) の場合は onnxruntime-web 既定の解決
// (バンドル内 data URL or import.meta.url 相対) に任せる。
// ort の WASM バイナリ。Web デプロイでは R2 から自前取得したものを
// env.wasm.wasmBinary に渡す (ort 自身の wasmPaths 経由の外部 fetch を排除。
// spike-stem との差分を最小化するため)。デスクトップでは null のまま。
let cachedOrtWasmBinary: ArrayBuffer | null = null;

/**
 * ort WASM の取得先上書き (Web デプロイのみ)。
 * 戻り値: 事前取得した wasmBinary (R2 から自前 fetch) と、
 * レガシー用の wasmPaths (spike 同様の Vite バンドル解決に任せるため基本未使用)
 */
async function resolveOrtWasmBinary(absWasmUrl: string | undefined): Promise<ArrayBuffer | null> {
    if (!absWasmUrl) return null;
    if (cachedOrtWasmBinary) return cachedOrtWasmBinary;
    log('model', `ort WASM を取得中: ${absWasmUrl}`);
    const res = await fetch(absWasmUrl);
    if (!res.ok) throw new Error(`ort WASM 取得失敗: HTTP ${res.status}`);
    cachedOrtWasmBinary = await res.arrayBuffer();
    log('model', `ort WASM 取得完了: ${(cachedOrtWasmBinary.byteLength / 1024 / 1024).toFixed(1)} MB`);
    return cachedOrtWasmBinary;
}

const post = (msg: StemWorkerResponse) => (self as unknown as Worker).postMessage(msg);
const log = (phase: string, message: string) => post({ type: 'log', phase, message });

//==============================================================================
// モデル取得 (Cache API / Range 再開) — spike 実装の準用
//
// 注意: この Worker は vite の ?worker&inline (Blob URL 生成) で動くため、
// 相対 URL が解決できない環境がある (特に WKWebView の独自スキーマ生成元)。
// よって URL は必ず main スレッドで絶対 URL に解決してから渡すこと。
// キャッシュキーも同じ絶対 URL を使う。
//==============================================================================

const CACHE_NAME = 'voivent-stem-models-v1';

/** Cache API が利用不可の環境 (一部 WebView) では null を返し、毎回 DL にフォールバック */
async function openCacheOrNull(): Promise<Cache | null> {
    try {
        if (typeof caches === 'undefined') return null;
        return await caches.open(CACHE_NAME);
    } catch {
        return null;
    }
}

async function fetchWithProgressAndCache(url: string): Promise<ArrayBuffer> {
    const cache = await openCacheOrNull();
    if (cache) {
        const cached = await cache.match(url);
        if (cached) {
            log('model', 'キャッシュヒット — ダウンロードをスキップ');
            return cached.arrayBuffer();
        }
    }

    log('model', `ダウンロード開始: ${url}`);

    // Range 再開: 前回中断分から続行 (未対応サーバーでは 200 でフル取得)
    let startByte = 0;
    let cachedPrefix: ArrayBuffer | null = null;
    if (cache) {
        const prev = await cache.match(url);
        if (prev) {
            const len = Number(prev.headers.get('content-length') ?? '0');
            if (len > 0) {
                const probe = await fetch(url, { headers: { Range: `bytes=${len}-` } });
                if (probe.status === 206) {
                    startByte = len;
                    cachedPrefix = await prev.arrayBuffer();
                    log('model', `中断分から再開: ${(len / 1024 / 1024).toFixed(1)} MB 継承`);
                }
            }
        }
    }

    const headers: Record<string, string> = startByte > 0 ? { Range: `bytes=${startByte}-` } : {};
    const res = await fetch(url, { headers });
    if (!res.ok && res.status !== 206) {
        throw new Error(`モデル取得失敗: HTTP ${res.status}`);
    }

    const total = Number(res.headers.get('content-length') ?? '0') + startByte;
    const reader = res.body?.getReader();
    if (!reader) {
        const buf = await res.arrayBuffer();
        if (cache) {
            await cache.put(url, new Response(buf));
        }
        return buf;
    }

    const chunks: Uint8Array[] = [];
    let received = startByte;
    let lastReported = -1;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        const pct = total > 0 ? Math.floor((received / total) * 100) : 0;
        if (pct !== lastReported) {
            lastReported = pct;
            post({ type: 'model-progress', loaded: received, total });
        }
    }

    // 結合 (再開分 prefix + 今回受信 tail)
    const tailLen = received - startByte;
    const tail = new Uint8Array(tailLen);
    let offset = 0;
    for (const c of chunks) {
        tail.set(c, offset);
        offset += c.byteLength;
    }
    let full: Uint8Array;
    if (cachedPrefix && startByte > 0) {
        full = new Uint8Array(startByte + tailLen);
        full.set(new Uint8Array(cachedPrefix), 0);
        full.set(tail, startByte);
    } else {
        full = tail;
    }

    if (cache) {
        await cache.put(url, new Response(full.buffer as ArrayBuffer));
        log('model', `ダウンロード完了: ${(full.byteLength / 1024 / 1024).toFixed(1)} MB をキャッシュ`);
    } else {
        log('model', `ダウンロード完了: ${(full.byteLength / 1024 / 1024).toFixed(1)} MB (キャッシュ不可の環境のため毎回取得)`);
    }
    return full.buffer as ArrayBuffer;
}

//==============================================================================
// モデルロード (WebGPU 判定付き)
//==============================================================================

let processor: DemucsProcessor | null = null;
let backendInUse = 'unknown';

/** 分離 PCM の worker 内キャッシュ (メインスレッドへは送らない) */
let pcmCache: Partial<Record<StemKind, StemBuffers>> = {};
let pcmSampleRate = CONSTANTS.SAMPLE_RATE;

/** Float32 PCM 2ch → 16bit PCM WAV ArrayBuffer */
function encodeWav16(stem: StemBuffers, sampleRate: number): ArrayBuffer {
    const len = Math.min(stem.left.length, stem.right.length);
    const dataSize = len * 4; // 2ch * 16bit
    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);
    const writeStr = (off: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    let off = 44;
    for (let i = 0; i < len; i++) {
        const l = Math.max(-1, Math.min(1, stem.left[i]));
        const r = Math.max(-1, Math.min(1, stem.right[i]));
        view.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true); off += 2;
        view.setInt16(off, r < 0 ? r * 0x8000 : r * 0x7fff, true); off += 2;
    }
    return ab;
}

async function loadModel(modelUrl: string, ortWasmUrl?: string) {
    log('model', '推論エンジン初期化中');
    // 最初に不定インジケータへ切り替える (キャッシュ読み出し中も UI が
    // 「0% で固まった」ように見えないようにするため)
    post({ type: 'model-progress', loaded: 1, total: 0 });

    let hasWebGpu = false;
    try {
        hasWebGpu = 'gpu' in navigator && !!(await (navigator as any).gpu?.requestAdapter());
    } catch { hasWebGpu = false; }

    // マルチスレッド WASM は SharedArrayBuffer 必須 (COOP/COEP ヘッダが必要)。
    // SharedArrayBuffer の無い環境 (JUCE WebView の独自スキーマ生成元など) で
    // numThreads > 1 を設定すると emscripten の pthread 生成が例外を出さずに
    // 永久待機し、セッション構築が固まる。環境判定で 1 スレッドに落とす。
    const sabAvailable = typeof SharedArrayBuffer !== 'undefined';
    ort.env.wasm.numThreads = sabAvailable ? Math.min(4, navigator.hardwareConcurrency || 4) : 1;
    // 環境を明示ログ化 (デスクトップ / Web の速度差診断に使う)
    log('model', `推論環境: WebGPU=${hasWebGpu ? 'あり' : 'なし'} / SharedArrayBuffer=${sabAvailable ? 'あり' : 'なし'} / WASM threads=${ort.env.wasm.numThreads}`);
    // Web デプロイでは 25MiB 上限のため ort WASM を静的アセットに同梱できず、
    // R2 (same-origin /ort/) から取得させる。デスクトップでは未定義なので
    // 既定 (バンドル内 data URL) のまま変わらない。
    const wasmBinary = await resolveOrtWasmBinary(ortWasmUrl);
    if (wasmBinary) {
        // ort 自身の外部 fetch (wasmPaths 経由) を排除し、バイト列を直接渡す。
        // これで spike-stem との差分 (ort ロード経路) を実質ゼロにする
        (ort.env.wasm as any).wasmBinary = wasmBinary;
        log('model', `ort WASM: バイナリ直接渡し (${(wasmBinary.byteLength / 1024 / 1024).toFixed(1)} MB, wasmPaths 未使用)`);
    }
    if (hasWebGpu) {
        (ort.env as any).webgpu = { powerPreference: 'high-performance' };
    }

    const buf = await fetchWithProgressAndCache(modelUrl);
    log('model', `モデル ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB 取得 → セッション構築中`);
    // ダウンロード後のセッション構築 (数秒〜数十秒) を UI に明示する。
    // 進捗値は不定だがインジケータが動くこと自体に意味がある
    post({ type: 'model-progress', loaded: 1, total: 0 });

    processor = new DemucsProcessor({
        ort,
        sessionOptions: {
            executionProviders: hasWebGpu ? ['webgpu', 'wasm'] : ['wasm'],
            // メモリ抑制 (spike 実測で有効だった低メモリ設定を準用)
            enableCpuMemArena: false,
            enableMemPattern: false,
        },
        onProgress: (info: { progress: number; currentSegment: number; totalSegments: number }) => {
            post({
                type: 'separate-progress',
                progress: info.progress,
                currentSegment: info.currentSegment,
                totalSegments: info.totalSegments,
            });
        },
        onLog: (phase: string, message: string) => log(phase, message),
    });

    // セッション構築の進行確認用ウォッチドッグ (10秒ごとに経過を通知)。
    // 「Loading model... のまま沈黙」が ort 内部のどの段階かを切り分ける
    let createElapsed = 0;
    const watchdog = setInterval(() => {
        createElapsed += 10;
        log('model', `セッション構築 待機中… ${createElapsed}s 経過 (WebGPU 初期化 / 重み配置中)`);
    }, 10000);

    await processor.loadModel(buf);

    clearInterval(watchdog);
    backendInUse = hasWebGpu ? 'webgpu(+wasm fallback)' : 'wasm';
    post({ type: 'model-ready', backend: backendInUse });
    log('model', `セッション構築完了 (backend: ${backendInUse})`);
}

//==============================================================================
// 分離 + 解析 + PCM 解放
//==============================================================================

async function separateAndAnalyze(
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
) {
    if (!processor) throw new Error('モデル未ロード');
    const t0 = performance.now();
    const audioSec = left.length / sampleRate;
    log('separate', `分離開始: ${audioSec.toFixed(1)} 秒 / ${sampleRate} Hz`);

    // 分離エンジンは 44100Hz 決め打ち。UI 側でリサンプル済みの前提
    const result = (await processor.separate(left, right)) as Record<StemKind, StemBuffers>;

    const elapsed = (performance.now() - t0) / 1000;
    const speed = audioSec / elapsed;
    log('separate', `分離完了: ${elapsed.toFixed(1)} 秒 (速度 ${speed.toFixed(2)}x)`);

    // 解析 (純関数)。onset / 包絡 / 発声区間をメタデータへ圧縮する
    const analysis = buildStemAnalysis(result, CONSTANTS.SAMPLE_RATE, audioSec);
    log('analyze', `解析完了: onset ${analysis.drumOnsets.length} 件 / 発声区間 ${analysis.vocalSegments.length} 件`);

    // PCM は worker 内キャッシュへ (試聴 / WAV 保存時のみ使用)。メインスレッドへは送らない
    pcmCache = result;
    pcmSampleRate = CONSTANTS.SAMPLE_RATE;

    post({ type: 'analysis-done', analysis });
}

if (typeof self !== 'undefined' && !self.name?.startsWith('em-pthread')) {
    self.addEventListener('message', async (e: MessageEvent<StemWorkerRequest>) => {
        const req = e.data;
        if (!req || typeof req !== 'object' || !('type' in req)) return;
        try {
            if (req.type === 'load-model') {
                await loadModel(req.modelUrl, req.ortWasmUrl);
            } else if (req.type === 'separate') {
                await separateAndAnalyze(req.left, req.right, req.sampleRate);
            } else if (req.type === 'export-wav') {
                const stem = pcmCache[req.kind];
                if (!stem) {
                    post({ type: 'error', message: '分離済み PCM がありません (解放済みの可能性)' });
                } else {
                    const wav = encodeWav16(stem, pcmSampleRate);
                    post({ type: 'wav-ready', kind: req.kind, wav });
                }
            } else if (req.type === 'get-peaks') {
                const stem = pcmCache[req.kind];
                if (!stem) {
                    post({ type: 'error', message: `ピーク取得失敗: ${req.kind} の PCM がありません (解放済みの可能性)` });
                } else {
                    const peaks = computePeaks(stem, Math.max(16, Math.min(2000, req.numPoints)));
                    post({ type: 'peaks-ready', kind: req.kind, peaks });
                }
            } else if (req.type === 'release-pcm') {
                pcmCache = {};
                log('pcm', '分離済み PCM キャッシュを解放しました');
            }
        } catch (err) {
            const msg = err instanceof Error ? `${err.message}` : String(err);
            post({ type: 'error', message: msg });
        }
    });
}

export {};
