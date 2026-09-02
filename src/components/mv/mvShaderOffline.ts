//==============================================================================
// AI 生成シェーダー（TSL）のオフライン 1 フレーム描画。
//
// ライブ MvShaderCanvas と同一の純関数描画（uTimeSec = timeSec、音響 uniforms =
// signals）をオフスクリーンで実行し、結果を Canvas2D へ転写する。
// レンダラーは状態を保持せず任意時刻の 1 フレームを描けるため、
// Phaser ライブ canvas 状態には一切依存しない（凍結フレーム問題の構造的回避）。
//==============================================================================
import type { AudioSignals } from './types';
import { createShaderBackendOptions, detectActualBackend } from './mvShaderBackend';
import { evaluateShaderSubmission, type ShaderUniforms } from './mvTslSandbox';
import { normalizePixels } from './mvShaderPixels';

/** シェーダーコード別のコンパイル済みシーンキャッシュ */
interface CompiledEntry {
    scene: unknown;
    camera: unknown;
    uniforms: ShaderUniforms;
}
const compiledCache = new Map<string, CompiledEntry>();

interface OfflineRenderer {
    setSize: (w: number, h: number) => void;
    setRenderTarget: (t: unknown | null) => void;
    render: (scene: unknown, cam: unknown) => void;
    readPixels: (w: number, h: number) => Promise<Uint8Array | Uint8ClampedArray>;
    dispose: () => Promise<void>;
    /** 実バックエンド（'auto' = WebGPU / 'webgl2' / 'unknown'）。読み取り向きの判定に使う */
    backend: string;
}
let rendererPromise: Promise<OfflineRenderer | null> | null = null;
let currentTarget: unknown = null;
let currentSize = { w: 0, h: 0 };

async function getOfflineRenderer(): Promise<OfflineRenderer | null> {
    if (!rendererPromise) {
        rendererPromise = (async () => {
            try {
                const THREE = await import('three/webgpu');
                const r = new (THREE as unknown as { WebGPURenderer: new (o: Record<string, unknown>) => any })
                    .WebGPURenderer(createShaderBackendOptions());
                await (r as unknown as { init: () => Promise<void> }).init();
                return {
                    setSize: (w: number, h: number) => r.setSize(w, h),
                    setRenderTarget: (t: unknown | null) => r.setRenderTarget(t),
                    render: (scene: unknown, cam: unknown) => r.render(scene, cam),
                    readPixels: async (w: number, h: number) => {
                        // r185: 戻り値で TypedArray を受ける（旧来の受け取りバッファ渡しは不可）
                        const raw = await (r as unknown as {
                            readRenderTargetPixelsAsync: (t: unknown, x: number, y: number, w: number, h: number) => Promise<Uint8Array | Uint8ClampedArray>;
                        }).readRenderTargetPixelsAsync(currentTarget, 0, 0, w, h);
                        return raw;
                    },
                    dispose: () => r.dispose(),
                    backend: detectActualBackend(r) ?? 'unknown',
                };
            } catch {
                return null;
            }
        })();
    }
    return rendererPromise;
}

async function ensureTarget(width: number, height: number): Promise<boolean> {
    const r = await getOfflineRenderer();
    if (!r) return false;
    if (currentTarget && (currentSize.w !== width || currentSize.h !== height)) {
        currentTarget = null;
    }
    if (!currentTarget) {
        const THREE = await import('three/webgpu');
        const G = THREE as unknown as Record<string, new (...args: any[]) => any>;
        currentTarget = new G.RenderTarget(width, height);
        currentSize = { w: width, h: height };
    }
    return true;
}

/**
 * シェーダー背景 1 フレームを Canvas2D へ描画する。
 * shaderCode 未指定・コンパイル失敗・環境不備時は false を返し、
 * 呼び出し元は従来の Phaser 背景へフォールバックする。
 */
export async function drawShaderFrame(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeSec: number,
    shaderCode: string | undefined,
    signals: AudioSignals,
): Promise<boolean> {
    if (!shaderCode || typeof document === 'undefined') return false;

    // コンパイル（コード単位でキャッシュ再利用）
    let entry = compiledCache.get(shaderCode);
    if (!entry) {
        const THREE = await import('three/webgpu');
        const G = THREE as unknown as Record<string, new (...args: any[]) => any>;
        // ⚠️ uniform は必ず TSL uniform() ノードで生成する（ライブ / プローブと同一構造）。
        // 実機バグ（2026-08）: 旧実装はプレーンオブジェクト { value: 0 } を渡しており、
        // AI 提出コード内の u.uTimeSec.mul(...) 等のノードメソッド呼び出しが
        // 書き出し経路のみ TypeError になり、drawShaderFrame の catch で静かに
        // false を返していた。結果、AI シェーダーはライブでは描けるのに
        // エクスポート動画だけ Phaser プリセット背景（デフォルト演出）に
        // すり替わる不具合の原因となった。
        const TSL = (THREE as unknown as { TSL: Record<string, unknown> }).TSL;
        const uniform = TSL.uniform as
            | undefined
            | ((v: number) => { value: number; isUniformNode?: boolean });
        if (typeof uniform !== 'function') return false;
        const uniforms: ShaderUniforms = {
            uTimeSec: uniform(0),
            uLow: uniform(0),
            uMid: uniform(0),
            uHigh: uniform(0),
            uBeat: uniform(0),
            uEnergy: uniform(0),
        } as ShaderUniforms;
        try {
            // ライブ / プローブと同一の評価ヘルパー（提出形状の揺れを吸収）。
            // これにより検証合格コードがライブでは描けるのに書き出しだけ
            // 静かに失敗する不整合を構造的に排除する。
            const colorNode = evaluateShaderSubmission(shaderCode, TSL, uniforms);
            if (!colorNode || typeof colorNode !== 'object') return false;
            const scene = new G.Scene();
            const mat = new G.NodeMaterial();
            (mat as unknown as { colorNode: unknown }).colorNode = colorNode;
            const quad = new G.Mesh(new G.PlaneGeometry(2, 2), mat);
            (quad as unknown as { frustumCulled: boolean }).frustumCulled = false;
            (scene as unknown as { add: (m: unknown) => void }).add(quad);
            const camera = new G.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            entry = { scene, camera, uniforms };
            if (compiledCache.size > 16) compiledCache.clear();
            compiledCache.set(shaderCode, entry);
        } catch {
            return false;
        }
    }

    if (!(await ensureTarget(width, height))) return false;
    const r = await getOfflineRenderer();
    if (!r) return false;

    // uniform 更新（ライブ MvShaderCanvas と同一の純関数描画）
    const u = entry.uniforms;
    u.uTimeSec.value = timeSec;
    u.uLow.value = signals.low;
    u.uMid.value = signals.mid;
    u.uHigh.value = signals.high;
    u.uBeat.value = signals.beat;
    u.uEnergy.value = Math.max(0, Math.min(1, (signals.low + signals.beat) / 2));

    try {
        r.setSize(width, height);
        r.setRenderTarget(currentTarget);
        r.render(entry.scene, entry.camera);
        const pixels = await r.readPixels(width, height);
        // バックエンド差（行パディング・行の向き）を吸収してタイト・上原点へ正規化。
        // WebGPU バックエンドは上原点でそのまま、WebGL2 (gl.readPixels) は下原点なので反転。
        const normalized = normalizePixels(pixels, width, height, r.backend);
        if (!normalized) return false;

        // 正規化済み（上原点・タイト packing）ピクセルをそのまま Canvas2D へ転写
        const tmp = document.createElement('canvas');
        tmp.width = width;
        tmp.height = height;
        const tctx = tmp.getContext('2d');
        if (!tctx) return false;
        const imgData = tctx.createImageData(width, height);
        const rowBytes = width * 4;
        for (let y = 0; y < height; y++) {
            imgData.data.set(normalized.subarray(y * rowBytes, y * rowBytes + rowBytes), y * rowBytes);
        }
        tctx.putImageData(imgData, 0, 0);
        ctx.drawImage(tmp, 0, 0, width, height);
        return true;
    } catch {
        return false;
    }
}

