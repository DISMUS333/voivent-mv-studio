//==============================================================================
// モデル配信 Worker のテスト。
// 純関数 (キー抽出 / Range パース) と、R2 バインディングをモックした
// fetch ハンドラの振る舞い (200 / 206 / 404 / 405 / CORS) を検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import worker, { parseRange, objectKeyOf, type Env } from './index';

/** R2 get() の戻りを模すオブジェクトを生成するヘルパー */
function makeR2Object(size: number, offset?: number, length?: number) {
    return {
        body: new ReadableStream(),
        size,
        range: offset !== undefined ? { offset, length } : undefined,
        httpEtag: 'etag-test-1',
        writeHttpMetadata: (headers: Headers) => headers.set('content-type', 'application/octet-stream'),
    };
}

/** 指定 range で get() された内容を記録するモック R2 */
function makeEnv(): { env: Env; state: { lastKey: string | null; lastRange: unknown } } {
    const state = { lastKey: null as string | null, lastRange: undefined as unknown };
    const env: Env = {
        STEM_MODELS: {
            head: async (key: string) => {
                state.lastKey = key;
                if (key !== 'models/htdemucs_embedded.onnx') return null;
                return {
                    size: 180355072,
                    httpEtag: 'etag-test-1',
                    writeHttpMetadata: (headers: Headers) => headers.set('content-type', 'application/octet-stream'),
                };
            },
            get: async (key: string, options?: { range?: { offset: number; length?: number } }) => {
                state.lastKey = key;
                state.lastRange = options?.range;
                if (key !== 'models/htdemucs_embedded.onnx') return null;
                if (options?.range) {
                    const { offset, length } = options.range;
                    return makeR2Object(180355072, offset, length) as Awaited<ReturnType<Env['STEM_MODELS']['get']>>;
                }
                return makeR2Object(180355072) as Awaited<ReturnType<Env['STEM_MODELS']['get']>>;
            },
        },
    };
    return { env, state };
}

describe('objectKeyOf (パストラバーサル防止)', () => {
    it('/models/<単純名> は models/ プレフィックス付きキーに変換', () => {
        expect(objectKeyOf('/models/htdemucs_embedded.onnx')).toBe('models/htdemucs_embedded.onnx');
    });

    it('/ort/<単純名> も許可する (onnxruntime WASM 配信用)', () => {
        expect(objectKeyOf('/ort/ort-wasm-simd-threaded.jsep.wasm')).toBe('ort/ort-wasm-simd-threaded.jsep.wasm');
    });

    it('未許可の名前空間は拒否する', () => {
        expect(objectKeyOf('/assets/app.js')).toBeNull();
        expect(objectKeyOf('/api/data')).toBeNull();
    });

    it('サブディレクトリ・親参照・多重スラッシュを拒否する', () => {
        expect(objectKeyOf('/models/sub/a.onnx')).toBeNull();
        expect(objectKeyOf('/models/../etc/passwd')).toBeNull();
        expect(objectKeyOf('/models//a.onnx')).toBeNull();
    });

    it('/models/ 以外は拒否する', () => {
        expect(objectKeyOf('/assets/app.js')).toBeNull();
        expect(objectKeyOf('/models/')).toBeNull();
    });
});

describe('parseRange', () => {
    it('bytes=N- は offset のみ (末尾まで)', () => {
        expect(parseRange('bytes=123-')).toEqual({ offset: 123 });
    });

    it('bytes=N-M は offset + length', () => {
        expect(parseRange('bytes=100-199')).toEqual({ offset: 100, length: 100 });
    });

    it('不正形式・開始未指定は undefined', () => {
        expect(parseRange(null)).toBeUndefined();
        expect(parseRange('bytes=-100')).toBeUndefined();
        expect(parseRange('bytes=abc-')).toBeUndefined();
        expect(parseRange('items=0-9')).toBeUndefined();
    });
});

describe('worker fetch', () => {
    it('GET /models/<key> は R2 から 200 + CORS + キャッシュヘッダーで配信', async () => {
        const { env, state } = makeEnv();
        const res = await worker.fetch(new Request('https://mv.example/models/htdemucs_embedded.onnx'), env);
        expect(res.status).toBe(200);
        expect(state.lastKey).toBe('models/htdemucs_embedded.onnx');
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        expect(res.headers.get('content-length')).toBe('180355072');
        expect(res.headers.get('cache-control')).toContain('immutable');
    });

    it('Range 付き GET は 206 + Content-Range を返す', async () => {
        const { env, state } = makeEnv();
        const req = new Request('https://mv.example/models/htdemucs_embedded.onnx', {
            headers: { range: 'bytes=172000-179999' },
        });
        const res = await worker.fetch(req, env);
        expect(res.status).toBe(206);
        expect(state.lastRange).toEqual({ offset: 172000, length: 8000 });
        expect(res.headers.get('content-range')).toBe('bytes 172000-179999/180355072');
        expect(res.headers.get('content-length')).toBe('8000');
    });

    it('中断再開 (bytes=N-) は 206 で末尾まで返す', async () => {
        const { env } = makeEnv();
        const req = new Request('https://mv.example/models/htdemucs_embedded.onnx', {
            headers: { range: 'bytes=180000000-' },
        });
        const res = await worker.fetch(req, env);
        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe('bytes 180000000-180355071/180355072');
    });

    it('存在しないモデルは 404', async () => {
        const { env } = makeEnv();
        const res = await worker.fetch(new Request('https://mv.example/models/unknown.onnx'), env);
        expect(res.status).toBe(404);
    });

    it('パストラバーサル URL は URL 正規化で /models/ 以外になり 404', async () => {
        const { env } = makeEnv();
        // new URL は .. を解決するため /models/../secret は /secret として到達する
        const res = await worker.fetch(new Request('https://mv.example/models/../secret'), env);
        expect(res.status).toBe(404);
    });

    it('多重スラッシュなどキー形式不正は 400', async () => {
        const { env } = makeEnv();
        const res = await worker.fetch(new Request('https://mv.example/models//a.onnx'), env);
        expect(res.status).toBe(400);
    });

    it('/models/ 以外は 404 (静的アセットに任せる範囲)', async () => {
        const { env } = makeEnv();
        const res = await worker.fetch(new Request('https://mv.example/assets/app.js'), env);
        expect(res.status).toBe(404);
    });

    it('POST は 405', async () => {
        const { env } = makeEnv();
        const res = await worker.fetch(
            new Request('https://mv.example/models/htdemucs_embedded.onnx', { method: 'POST' }),
            env,
        );
        expect(res.status).toBe(405);
    });

    it('HEAD はボディなし 200 + content-length を返す', async () => {
        const { env } = makeEnv();
        const res = await worker.fetch(
            new Request('https://mv.example/models/htdemucs_embedded.onnx', { method: 'HEAD' }),
            env,
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('180355072');
        expect(res.headers.get('accept-ranges')).toBe('bytes');
    });

    it('HEAD で存在しないキーは 404', async () => {
        const { env } = makeEnv();
        const res = await worker.fetch(
            new Request('https://mv.example/models/unknown.onnx', { method: 'HEAD' }),
            env,
        );
        expect(res.status).toBe(404);
    });

    it('OPTIONS は CORS プリフライト応答 (204) を返す', async () => {
        const { env } = makeEnv();
        const res = await worker.fetch(
            new Request('https://mv.example/models/htdemucs_embedded.onnx', { method: 'OPTIONS' }),
            env,
        );
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    });
});

describe('Workers AI 音声文字起こし (/api/transcribe)', () => {
    it('OPTIONS /api/transcribe は CORS プリフライト (204) を返す', async () => {
        const { env } = makeEnv();
        const res = await worker.fetch(
            new Request('https://mv.example/api/transcribe', { method: 'OPTIONS' }),
            env,
        );
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    });

    it('POST /api/transcribe は AI.run を呼び出してタイムスタンプ付き歌詞配列を返す', async () => {
        let calledModel = '';
        let calledLanguage = '';
        const mockEnv: Env = {
            STEM_MODELS: {
                get: async () => null,
                head: async () => null,
            },
            AI: {
                run: async (model, inputs) => {
                    calledModel = model;
                    calledLanguage = inputs.language || '';
                    return {
                        words: [
                            { word: 'こんにちは', start: 0.5, end: 1.2 },
                            { word: '世界', start: 1.3, end: 2.0 },
                        ],
                    };
                },
            },
        };

        const req = new Request('https://mv.example/api/transcribe', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                audioBase64: 'UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
                language: 'ja',
            }),
        });

        const res = await worker.fetch(req, mockEnv);
        expect(res.status).toBe(200);
        expect(calledModel).toBe('@cf/openai/whisper-large-v3-turbo');
        expect(calledLanguage).toBe('ja');

        const lyrics = await res.json();
        expect(Array.isArray(lyrics)).toBe(true);
        expect(lyrics.length).toBe(1);
        expect(lyrics[0].text).toBe('こんにちは世界');
        expect(lyrics[0].time).toBe(0.5);
    });

    it('GET /api/transcribe は 405 (Method Not Allowed)', async () => {
        const { env } = makeEnv();
        const res = await worker.fetch(new Request('https://mv.example/api/transcribe'), env);
        expect(res.status).toBe(405);
    });
});

