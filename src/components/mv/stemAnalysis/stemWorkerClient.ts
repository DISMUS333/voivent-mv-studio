//==============================================================================
// ステム分離ワーカーのメインスレッド側クライアント。
// Worker 生成 / リクエスト送信 / レスポンスの Promise 化 / 進捗通知を担う。
// ステム分離ワーカーはビルド設定ごとに方式を切り替える:
//   - デスクトップ (vite.config.ts): Blob inline Worker (singlefile 同梱のため)
//   - Web (vite.config.web.ts): 実ファイル Module Worker
//     (spike-stem と同じ構成。Blob inline だと ort の import.meta.url 基準の
//      内部ローダ (.mjs 動的 import / pthread 生成) が解決できず、
//      WebGPU EP の初期化が固まるため)
// 両方を import し、__STEM_WORKER_FILE__ (ビルド時定数) で選択する。
// 未使用側は define による定数畳み込みでロールアップが除去する。
import StemWorkerInline from './stemWorker?worker&inline';
import StemWorkerFile from './stemWorker?worker';

declare const __STEM_WORKER_FILE__: boolean | undefined;

const StemWorkerCtor: new () => Worker =
    typeof __STEM_WORKER_FILE__ !== 'undefined' && __STEM_WORKER_FILE__ ? StemWorkerFile : StemWorkerInline;
import type {
    StemAnalysis,
    StemKind,
    StemWorkerRequest,
    StemWorkerResponse,
} from './types';

export interface StemSeparationHandlers {
    onLog?: (phase: string, message: string) => void;
    onModelProgress?: (loaded: number, total: number) => void;
    onModelReady?: (backend: string) => void;
    onSeparateProgress?: (progress: number, currentSegment: number, totalSegments: number) => void;
}

/** リサンプル付き AudioBuffer → Float32 ペア変換 (44100Hz 決め打ちの分離器向け) */
export async function extractStereoAt44k(buffer: AudioBuffer): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number }> {
    const TARGET = 44100;
    if (buffer.sampleRate === TARGET) {
        const left = buffer.getChannelData(0);
        const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0);
        return { left, right, sampleRate: TARGET };
    }
    // OfflineAudioContext で線形補間リサンプル (ブラウザ内完結)
    const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const off = new OfflineCtx(2, Math.ceil(buffer.duration * TARGET), TARGET);
    const src = off.createBufferSource();
    src.buffer = buffer;
    src.connect(off.destination);
    src.start(0);
    const rendered = await off.startRendering();
    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : rendered.getChannelData(0);
    return { left, right, sampleRate: TARGET };
}

export class StemWorkerClient {
    private worker: Worker | null = null;
    private handlers: StemSeparationHandlers = {};
    private pending: Array<{ resolve: (r: any) => void; reject: (e: any) => void }> = [];

    private ensureWorker(): Worker {
        if (!this.worker) {
            const w = new StemWorkerCtor();
            w.onmessage = (e: MessageEvent<StemWorkerResponse>) => this.handleMessage(e.data);
            w.onerror = (e) => {
                const err = new Error(e.message || 'stem worker error');
                this.rejectAll(err);
            };
            this.worker = w;
        }
        return this.worker;
    }

    private handleMessage(msg: StemWorkerResponse) {
        switch (msg.type) {
            case 'log':
                this.handlers.onLog?.(msg.phase, msg.message);
                break;
            case 'model-progress':
                this.handlers.onModelProgress?.(msg.loaded, msg.total);
                break;
            case 'model-ready': {
                this.handlers.onModelReady?.(msg.backend);
                const p = this.pending.shift();
                if (p) p.resolve(msg);
                break;
            }
            case 'separate-progress':
                this.handlers.onSeparateProgress?.(msg.progress, msg.currentSegment, msg.totalSegments);
                break;
            case 'separate-done':
            case 'analysis-done':
            case 'wav-ready':
            case 'peaks-ready': {
                const p = this.pending.shift();
                if (p) p.resolve(msg);
                break;
            }
            case 'error': {
                const p = this.pending.shift();
                const err = new Error(msg.message);
                if (p) p.reject(err);
                else this.rejectAll(err);
                break;
            }
        }
    }

    private rejectAll(err: Error) {
        const list = this.pending;
        this.pending = [];
        for (const p of list) p.reject(err);
    }

    setHandlers(h: StemSeparationHandlers) {
        this.handlers = h;
    }

    /** モデル取得 + セッション構築 (キャッシュヒット時は即完了) */
    loadModel(modelUrl: string, ortWasmUrl?: string): Promise<void> {
        const w = this.ensureWorker();
        return new Promise((resolve, reject) => {
            this.pending.push({ resolve: () => resolve(), reject });
            w.postMessage({ type: 'load-model', modelUrl, ortWasmUrl } as StemWorkerRequest);
        });
    }

    /** 分離 + 解析。StemAnalysis (小容量メタデータ) を返す */
    separate(buffer: AudioBuffer): Promise<StemAnalysis> {
        const w = this.ensureWorker();
        return new Promise(async (resolve, reject) => {
            try {
                const { left, right, sampleRate } = await extractStereoAt44k(buffer);
                this.pending.push({ resolve: (r: StemWorkerResponse) => {
                    if (r.type === 'analysis-done') resolve(r.analysis);
                    else reject(new Error('unexpected worker response'));
                }, reject });
                w.postMessage({ type: 'separate', left, right, sampleRate } as StemWorkerRequest);
            } catch (e) {
                reject(e);
            }
        });
    }

    /** 分離済み PCM から WAV を生成 (保存用)。PCM は worker から出ない */
    exportWav(kind: StemKind): Promise<ArrayBuffer> {
        const w = this.ensureWorker();
        return new Promise((resolve, reject) => {
            this.pending.push({ resolve: (r: StemWorkerResponse) => {
                if (r.type === 'wav-ready') resolve(r.wav);
                else reject(new Error('unexpected worker response'));
            }, reject });
            w.postMessage({ type: 'export-wav', kind } as StemWorkerRequest);
        });
    }

    /**
     * 分離済み PCM からピーク配列を取得 (ミニ波形描画用)。
     * numPoints 点の Float32Array を返す。WAV 生成より数 KB しか訪わない。
     */
    getPeaks(kind: StemKind, numPoints = 600): Promise<Float32Array> {
        const w = this.ensureWorker();
        return new Promise((resolve, reject) => {
            this.pending.push({ resolve: (r: StemWorkerResponse) => {
                if (r.type === 'peaks-ready') resolve(r.peaks);
                else reject(new Error('unexpected worker response'));
            }, reject });
            w.postMessage({ type: 'get-peaks', kind, numPoints } as StemWorkerRequest);
        });
    }

    /** worker 内 PCM キャッシュを解放 (メモリ規律) */
    releasePcm(): void {
        if (this.worker) {
            this.worker.postMessage({ type: 'release-pcm' } as StemWorkerRequest);
        }
    }

    dispose(): void {
        this.rejectAll(new Error('disposed'));
        this.worker?.terminate();
        this.worker = null;
    }
}
