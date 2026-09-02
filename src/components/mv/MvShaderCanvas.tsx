//==============================================================================
// AI 生成シェーダー（TSL）による GPU 背景レイヤー。
//
// 設計原則（2026-08 決定）:
// - 内部クロックを持たない。uTimeSec は必ず signals.timeSeconds から供給する
//   （= ライブと書き出しが同一の純関数描画になり、フレーム凍結系バグが構造的に起きない）
// - バックエンドは mvShaderBackend.ts の単一設定から解決する（'auto' = WebGPU 優先 /
//   'webgl2' = WebGL2 固定）。マシン単位で不変な選択のため、ライブ / プローブ /
//   書き出しの 3 経路が常に同一バックエンドとなり描画一致が保たれる
// - shaderCode は検証ハーネス (verifyTslShader) 通過済みであることを前提とするが、
//   ランタイムでも再コンパイルし、失敗時は何も描かず Phaser 背景にフォールバックさせる
//==============================================================================
import { useEffect, useRef } from 'react';
import type { AudioSignals } from './types';
import { compileTslShader, type ShaderUniforms } from './mvTslSandbox';
import { createShaderBackendOptions } from './mvShaderBackend';

interface MvShaderCanvasProps {
    shaderCode: string | undefined;
    signals: AudioSignals;
    canvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
}

interface CompiledScene {
    colorNode: unknown;
    uniforms: ShaderUniforms;
}

export function MvShaderCanvas({ shaderCode, signals, canvasRef }: MvShaderCanvasProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const compiledRef = useRef<CompiledScene | null>(null);
    /**
     * rAF 描画ループで使用中の NodeMaterial。
     * shaderCode 差し替え時にパイプライン再構築 (needsUpdate) を発火させるため
     * 描画ループ側の useEffect とシェアする。
     */
    const materialRef = useRef<{ needsUpdate: boolean } | null>(null);
    const signalsRef = useRef(signals);
    signalsRef.current = signals;
    const shaderCodeRef = useRef(shaderCode);
    shaderCodeRef.current = shaderCode;

    // shaderCode 変化時に再コンパイル（非同期・競合安全版）
    useEffect(() => {
        let cancelled = false;
        if (!shaderCode) {
            compiledRef.current = null;
            return;
        }
        compileTslShader(shaderCode).then((r) => {
            if (cancelled) return;
            compiledRef.current = (r.ok && r.colorNode && r.uniforms)
                ? { colorNode: r.colorNode, uniforms: r.uniforms }
                : null;
            // three r185: colorNode への代入は material.version を進めないため、
            // シェーダーグラフを差し替えても既存パイプライン (RenderObject) が
            // 再構築されず、最初のシーンのノードグラフと uniform バッファが
            // 使い回される。シーン境界を越えても背景が切り替わらない / 凍結する
            // 不具合の根本原因。needsUpdate を明示発火して material.version を
            // 進めると、次フレームの RenderObject 取得時に customProgramCacheKey
            // 差分（新 colorNode）を検知し、新グラフで再コンパイル ＋ 新 uniforms
            // が再バインドされる。
            const m = materialRef.current;
            if (m) m.needsUpdate = true;
        });
        return () => { cancelled = true; };
    }, [shaderCode]);

    // レンダラ生成・破棄と rAF 描画ループ
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let disposed = false;
        let rafId = 0;
        let renderer: {
            domElement: HTMLCanvasElement;
            setSize: (w: number, h: number) => void;
            render: (scene: unknown, cam: unknown) => void;
            dispose: () => Promise<void> | void;
        } | null = null;
        // three/webgpu は動的 import（シェーダー未使用セッションでは読込しない）
        const start = async () => {
            try {
                const THREE = await import('three/webgpu');
                if (disposed) return;
                const G = THREE as unknown as Record<string, new (...args: any[]) => any>;
                const cam = new G.OrthographicCamera(-1, 1, 1, -1, 0, 1);
                const scene = new G.Scene();
                const mat = new G.NodeMaterial();
                materialRef.current = mat;
                const quad = new G.Mesh(new G.PlaneGeometry(2, 2), mat);
                (quad as unknown as { frustumCulled: boolean }).frustumCulled = false;
                (scene as unknown as { add: (m: unknown) => void }).add(quad);
                const r = new (THREE as unknown as { WebGPURenderer: new (o: Record<string, unknown>) => any }).WebGPURenderer(createShaderBackendOptions());
                await (r as unknown as { init: () => Promise<void> }).init();
                if (disposed) {
                    await (r as unknown as { dispose: () => Promise<void> | void }).dispose();
                    return;
                }
                renderer = r as unknown as typeof renderer;

                const dom = r.domElement as HTMLCanvasElement;
                dom.style.width = '100%';
                dom.style.height = '100%';
                dom.style.display = 'block';
                host.appendChild(dom);
                if (canvasRef) canvasRef.current = dom;

                const resize = () => {
                    if (!renderer) return;
                    renderer.setSize(Math.max(2, host.clientWidth), Math.max(2, host.clientHeight));
                };
                resize();
                const ro = new ResizeObserver(resize);
                ro.observe(host);

                const loop = () => {
                    if (disposed) return;
                    const compiled = compiledRef.current;
                    let show = needsShow;
                    if (renderer && compiled) {
                        (mat as unknown as { colorNode: unknown }).colorNode = compiled.colorNode;
                        const u = compiled.uniforms;
                        const sig = signalsRef.current;
                        u.uTimeSec.value = sig.timeSeconds;
                        u.uLow.value = sig.low;
                        u.uMid.value = sig.mid;
                        u.uHigh.value = sig.high;
                        u.uBeat.value = sig.beat;
                        u.uEnergy.value = Math.max(0, Math.min(1, (sig.low + sig.beat) / 2));
                        renderer.render(scene, cam);
                        show = true;
                    } else if (renderer) {
                        // shaderCode 未所持（シーン間ギャップ or AI 生成なしシーン）の間は
                        // シェーダーレイヤーを非表示にする。非表示にしないと WebGL/WebGPU
                        // canvas に描かれた直近フレームが凍結したまま表示され続け、
                        // 「シーンを跨いだのに前シーンの背景が残る」ように見える。
                        // （rAF ループは止めない: 次の shaderCode シーンへ即復帰できるように）
                        show = false;
                    }
                    if (show !== needsShow) {
                        dom.style.display = show ? 'block' : 'none';
                        needsShow = show;
                    }
                    rafId = requestAnimationFrame(loop);
                };
                let needsShow = true;
                rafId = requestAnimationFrame(loop);
            } catch {
                // three/webgpu 読込失敗時は何も描かない（Phaser 背景 / 黒背景がそのまま映る）
            }
        };
        void start();

        return () => {
            disposed = true;
            cancelAnimationFrame(rafId);
            if (canvasRef) canvasRef.current = null;
            materialRef.current = null;
            const r = renderer;
            renderer = null;
            if (r) {
                try { r.dispose(); } catch { /* noop */ }
            }
            if (host) host.textContent = '';
        };
    }, [canvasRef]);

    return (
        <div
            ref={hostRef}
            data-mv-shader-layer="true"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
    );
}
