import { useEffect, useRef } from 'react';
import type { AudioSignals } from './types';
import type { Mv3DSceneConfig } from './mv3dScene';
import { createMv3DWorld, disposeMv3DWorld, renderMv3DWorld, updateMv3DWorld, type Mv3DWorld } from './mv3dRuntime';

interface Mv3DSceneCanvasProps {
    sceneConfig: Mv3DSceneConfig | undefined;
    signals: AudioSignals;
    sceneStartTime?: number;
}

export function Mv3DSceneCanvas({ sceneConfig, signals, sceneStartTime = 0 }: Mv3DSceneCanvasProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const signalsRef = useRef(signals);
    signalsRef.current = signals;

    useEffect(() => {
        if (!sceneConfig) return;
        let disposed = false;
        let rafId = 0;
        let world: Mv3DWorld | null = null;
        const host = hostRef.current;
        if (!host) return;

        const start = async () => {
            try {
                world = await createMv3DWorld(sceneConfig);
                if (disposed) {
                    await disposeMv3DWorld(world);
                    return;
                }
                world.renderer.setPixelRatio(Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 1.5));
                const dom = world.renderer.domElement as HTMLCanvasElement;
                dom.style.width = '100%';
                dom.style.height = '100%';
                dom.style.display = 'block';
                host.appendChild(dom);

                const resize = () => {
                    if (!world) return;
                    const w = Math.max(2, host.clientWidth);
                    const h = Math.max(2, host.clientHeight);
                    world.renderer.setSize(w, h);
                    world.camera.aspect = w / h;
                    world.camera.updateProjectionMatrix();
                };
                resize();
                const ro = new ResizeObserver(resize);
                ro.observe(host);
                const loop = (now: number) => {
                    if (disposed || !world) return;
                    const w = Math.max(2, host.clientWidth);
                    const h = Math.max(2, host.clientHeight);
                    const timeSec = signalsRef.current.timeSeconds ?? now / 1000;
                    const sceneTimeSec = Math.max(0, timeSec - sceneStartTime);
                    updateMv3DWorld(world, signalsRef.current, sceneTimeSec, w, h);
                    renderMv3DWorld(world);
                    rafId = requestAnimationFrame(loop);
                };
                rafId = requestAnimationFrame(loop);
                (host as any).__mv3dResizeObserver = ro;
            } catch {
                // WebGL/WebGPU非対応環境では既存の背景レイヤーをそのまま使う。
            }
        };
        void start();

        return () => {
            disposed = true;
            cancelAnimationFrame(rafId);
            const ro = (host as any).__mv3dResizeObserver as ResizeObserver | undefined;
            ro?.disconnect();
            delete (host as any).__mv3dResizeObserver;
            if (world) void disposeMv3DWorld(world);
            host.textContent = '';
        };
    }, [sceneConfig, sceneStartTime]);

    return (
        <div
            ref={hostRef}
            data-mv-3d-layer="true"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
    );
}
