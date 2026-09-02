import type { AudioSignals } from './types';
import type { Mv3DSceneConfig } from './mv3dScene';
import { createMv3DWorld, disposeMv3DWorld, resolveMv3DSceneTime, updateMv3DWorld, type Mv3DWorld } from './mv3dRuntime';
import { detectActualBackend } from './mvShaderBackend';
import { normalizePixels } from './mvShaderPixels';

export interface Mv3DFrameDiagnostics {
    rendererReady: boolean;
    lastRenderError: string | null;
    actualFrameLuminance: number;
    maxLuminance: number;
    nonBlackPixelRatio: number;
    backend: string;
    renderPath: 'pipeline' | 'direct' | 'direct-retry' | 'none';
}

export interface Mv3DFrameResult {
    rendered: boolean;
    diagnostics: Mv3DFrameDiagnostics;
}

interface Offline3DEntry {
    world: Mv3DWorld;
    target: any;
    width: number;
    height: number;
}

const cache = new Map<string, Promise<Offline3DEntry | null>>();

async function getEntry(spec: Mv3DSceneConfig, width: number, height: number): Promise<Offline3DEntry | null> {
    const key = JSON.stringify(spec);
    let pending = cache.get(key);
    if (!pending) {
        pending = (async () => {
            try {
                const world = await createMv3DWorld(spec);
                const THREE = await import('three/webgpu');
                const target = new THREE.RenderTarget(width, height);
                return { world, target, width, height };
            } catch {
                return null;
            }
        })();
        cache.set(key, pending);
        if (cache.size > 4) {
            const oldest = cache.keys().next().value;
            if (oldest && oldest !== key) cache.delete(oldest);
        }
    }
    const entry = await pending;
    if (!entry) return null;
    if (entry.width !== width || entry.height !== height) {
        entry.target = new (await import('three/webgpu')).RenderTarget(width, height);
        entry.width = width;
        entry.height = height;
    }
    return entry;
}

function copyPixels(ctx: CanvasRenderingContext2D, width: number, height: number, pixels: Uint8Array | Uint8ClampedArray, backend: string) {
    const normalized = normalizePixels(pixels, width, height, backend);
    if (!normalized) return false;
    const image = ctx.createImageData(width, height);
    image.data.set(normalized);
    ctx.putImageData(image, 0, 0);
    return true;
}

export function inspectMv3DFramePixels(pixels: Uint8Array | Uint8ClampedArray): Pick<Mv3DFrameDiagnostics, 'actualFrameLuminance' | 'maxLuminance' | 'nonBlackPixelRatio'> {
    let sum = 0;
    let max = 0;
    let nonBlack = 0;
    const pixelCount = Math.max(1, Math.floor(pixels.length / 4));
    for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        const luminance = (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]) / 255;
        sum += luminance;
        if (luminance > max) max = luminance;
        if (luminance > 0.004) nonBlack++;
    }
    return {
        actualFrameLuminance: sum / pixelCount,
        maxLuminance: max,
        nonBlackPixelRatio: nonBlack / pixelCount,
    };
}

function hasVisiblePixels(pixels: Uint8Array | Uint8ClampedArray): boolean {
    const stats = inspectMv3DFramePixels(pixels);
    return stats.maxLuminance > 0.004 || stats.nonBlackPixelRatio > 0.0005;
}

async function renderForReadback(world: Mv3DWorld): Promise<'pipeline' | 'direct'> {
    if (world.pipeline) {
        world.pipeline.render();
        return 'pipeline';
    }
    if (typeof world.renderer.renderAsync === 'function') {
        await world.renderer.renderAsync(world.scene, world.camera);
    } else {
        world.renderer.render(world.scene, world.camera);
    }
    return 'direct';
}

export async function drawMv3DFrame(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeSec: number,
    sceneConfig: Mv3DSceneConfig | undefined,
    signals: AudioSignals,
    sceneStartTime = 0,
): Promise<Mv3DFrameResult> {
    const emptyDiagnostics: Mv3DFrameDiagnostics = {
        rendererReady: false,
        lastRenderError: null,
        actualFrameLuminance: 0,
        maxLuminance: 0,
        nonBlackPixelRatio: 0,
        backend: 'unknown',
        renderPath: 'none',
    };
    if (!sceneConfig || typeof document === 'undefined') return { rendered: false, diagnostics: emptyDiagnostics };
    const entry = await getEntry(sceneConfig, width, height);
    if (!entry) return {
        rendered: false,
        diagnostics: { ...emptyDiagnostics, lastRenderError: '3Dレンダラーの初期化またはシーン構築に失敗しました。' },
    };
    try {
        const { world } = entry;
        updateMv3DWorld(world, signals, resolveMv3DSceneTime(timeSec, sceneStartTime), width, height);
        const renderer = world.renderer;
        renderer.setSize(width, height);
        renderer.setRenderTarget(entry.target);
        const renderPath = await renderForReadback(world);
        let pixels = await renderer.readRenderTargetPixelsAsync(entry.target, 0, 0, width, height);
        let finalPath: Mv3DFrameDiagnostics['renderPath'] = renderPath;
        // RenderPipeline は内部のGPUノード準備が間に合わない環境で黒いTargetを
        // 返すことがある。黒フレームを成功扱いにせず、同じ3D Sceneを直接再描画する。
        if (!hasVisiblePixels(pixels) && renderPath === 'pipeline' && typeof renderer.renderAsync === 'function') {
            await renderer.renderAsync(world.scene, world.camera);
            pixels = await renderer.readRenderTargetPixelsAsync(entry.target, 0, 0, width, height);
            finalPath = 'direct-retry';
        }
        renderer.setRenderTarget(null);
        const backend = detectActualBackend(renderer) ?? 'unknown';
        const normalized = normalizePixels(pixels, width, height, backend);
        if (!normalized || !(normalized instanceof Uint8Array || normalized instanceof Uint8ClampedArray)) {
            return {
                rendered: false,
                diagnostics: { ...emptyDiagnostics, rendererReady: true, backend, renderPath: finalPath, lastRenderError: '3Dフレームの画素読み出し形式が不正です。' },
            };
        }
        const stats = inspectMv3DFramePixels(normalized);
        const copied = copyPixels(ctx, width, height, pixels, backend);
        return {
            rendered: copied && hasVisiblePixels(normalized),
            diagnostics: { rendererReady: true, lastRenderError: copied ? null : '3DフレームをCanvasへ転写できませんでした。', ...stats, backend, renderPath: finalPath },
        };
    } catch (error) {
        try { entry.world.renderer.setRenderTarget(null); } catch { /* best effort */ }
        return {
            rendered: false,
            diagnostics: {
                ...emptyDiagnostics,
                rendererReady: true,
                backend: detectActualBackend(entry.world.renderer) ?? 'unknown',
                lastRenderError: error instanceof Error ? error.message : String(error),
            },
        };
    }
}

export async function disposeMv3DOfflineCache() {
    const entries = await Promise.all([...cache.values()]);
    cache.clear();
    await Promise.all(entries.filter((entry): entry is Offline3DEntry => Boolean(entry)).map(async (entry) => {
        try { entry.target.dispose(); } catch { /* best effort */ }
        await disposeMv3DWorld(entry.world);
    }));
}
