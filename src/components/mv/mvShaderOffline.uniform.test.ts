//==============================================================================
// drawShaderFrame 書き出し経路の uniform 構造回帰テスト（モックレンダラー使用）。
//
// 実機バグ（2026-08, Web 版）: 書き出し経路だけが uniform をプレーンオブジェクト
// { value: 0 } で生成していたため、AI 提出コード内の u.uTimeSec.mul(...) 等の
// ノードメソッド呼び出しが TypeError になり、drawShaderFrame の catch で静かに
// false を返していた。結果、ライブでは AI 生成シェーダーが描画されるのに
// エクスポート動画だけ Phaser プリセット背景へ静かにすり替わっていた。
//
// 本テストは TSL は実物を使い、WebGPURenderer のみモックに差し替え、
// 「uniform メソッドを使う提出コードが書き出し経路で描ける」ことを検証する。
// uniform がプレーンオブジェクトに戻ると本テストは確実に失敗する。
//==============================================================================
import { describe, expect, it, vi } from 'vitest';
import type { AudioSignals } from './types';

vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three/webgpu')>();
    /** 描画 API 面だけを持つモックレンダラー（ピクセルは単色グラデーションを返す） */
    class MockWebGPURenderer {
        backend = { isWebGPUBackend: true };
        domElement = { style: {} };
        async init(): Promise<void> { /* noop */ }
        setSize(_w: number, _h: number): void { /* noop */ }
        setRenderTarget(_t: unknown): void { /* noop */ }
        render(_scene: unknown, _cam: unknown): void { /* noop */ }
        async readRenderTargetPixelsAsync(
            _t: unknown, _x: number, _y: number, w: number, h: number,
        ): Promise<Uint8Array> {
            const px = new Uint8Array(w * h * 4);
            for (let i = 0; i < px.length; i += 4) {
                px[i] = 200; px[i + 1] = 110; px[i + 2] = 60; px[i + 3] = 255;
            }
            return px;
        }
        dispose(): void { /* noop */ }
    }
    return { ...actual, WebGPURenderer: MockWebGPURenderer } as unknown as typeof actual;
});

import { drawShaderFrame } from './mvShaderOffline';

const SIGNALS = {
    low: 0.5, mid: 0.4, high: 0.3, peak: 0.6, beat: 0.7,
    timeSeconds: 2.5, isPlaying: true, bpm: 120,
    viseme: 'a', visemeStrength: 0.5,
} as unknown as AudioSignals;

/** jsdom の Canvas2D スタブでも動くよう 1x1 で検証する */
const W = 1;
const H = 1;

function stubCtx(): CanvasRenderingContext2D {
    return { drawImage: () => { /* noop */ } } as unknown as CanvasRenderingContext2D;
}

describe('drawShaderFrame (書き出し経路の uniform 構造)', () => {
    it('uniform ノードのメソッドチェーン (.mul/.add) を使う提出コードが書き出しで描画される', async () => {
        const code = 'return tsl.vec4(u.uTimeSec.mul(0.5).add(0.5), u.uLow.add(u.uBeat), u.uEnergy, 1.0);';
        const drawn = await drawShaderFrame(stubCtx(), W, H, 2.5, code, SIGNALS);
        expect(drawn).toBe(true);
    });

    it('uniform を直接ノード引数へ渡す標準提出コードも書き出しで描画される', async () => {
        const code = 'return tsl.vec4(tsl.sin(u.uTimeSec).mul(0.5).add(0.5), u.uLow, u.uBeat, 1.0);';
        const drawn = await drawShaderFrame(stubCtx(), W, H, 1.0, code, SIGNALS);
        expect(drawn).toBe(true);
    });

    it('shaderCode 未指定時は false を返しフォールバック対象になる', async () => {
        const drawn = await drawShaderFrame(stubCtx(), W, H, 1.0, undefined, SIGNALS);
        expect(drawn).toBe(false);
    });
});
