//==============================================================================
// mvPhaserFallback の単体テスト。
// テーマ名正規化 (resolvePhaserTheme)、決定論的フォールバック描画
// (drawPhaserFallback)、ライブ canvas 利用可否判定 (isPhaserCanvasUsable) を検証。
// jsdom 環境では Canvas 2D コンテキストが取得できない場合があるため、
// 描画系アサーションは ctx 取得時のみ実行する (既存ガードテストと同一方針)。
//==============================================================================
import { describe, it, expect } from 'vitest';
import {
    resolvePhaserTheme,
    drawPhaserFallback,
    isPhaserCanvasUsable,
    markPhaserCanvasFresh,
    isPhaserCanvasFresh,
    DEFAULT_PHASER_THEME,
    FALLBACK_PHASER_THEME,
} from './mvPhaserFallback';
import type { AudioSignals, PhaserThemeKind } from './types';

const makeSignals = (t: number): AudioSignals => ({
    peak: 0.6,
    low: 0.5,
    mid: 0.4,
    high: 0.3,
    beat: 0.7,
    isPlaying: true,
    timeSeconds: t,
    bpm: 120,
});

const THEMES: PhaserThemeKind[] = ['oscilloscope', 'fluid_aurora', 'ambient_bokeh', 'spectrum_bars'];

/**
 * jsdom の getContext('2d') スタブへ記録機能を一時的に追加し、
 * drawPhaserFallback が発行する描画命令を文字列として記録する。
 * ピクセル実体のない jsdom でも「何を・どこへ描いたか」を検証できる。
 */
function recordCommands(draw: (ctx: CanvasRenderingContext2D) => void): string[] {
    const commands: string[] = [];
    const num = (v: unknown) => (typeof v === 'number' ? Number(v.toFixed(3)) : v);
    const stub = {
        fillRect: (x: number, y: number, w: number, h: number) => commands.push(`fillRect ${num(x)},${num(y)},${num(w)},${num(h)}`),
        arc: (x: number, y: number, r: number) => commands.push(`arc ${num(x)},${num(y)},${num(r)}`),
        beginPath: () => {},
        closePath: () => {},
        moveTo: (x: number, y: number) => commands.push(`moveTo ${num(x)},${num(y)}`),
        lineTo: (x: number, y: number) => commands.push(`lineTo ${num(x)},${num(y)}`),
        fill: () => commands.push('fill'),
        stroke: () => commands.push('stroke'),
        save: () => commands.push('save'),
        restore: () => commands.push('restore'),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        shadowColor: '',
        shadowBlur: 0,
    } as unknown as CanvasRenderingContext2D & Record<string, unknown>;
    const original = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext = function (contextType: string, ...args: unknown[]) {
        if (contextType === '2d') return stub;
        return (original as (...a: unknown[]) => unknown).apply(this, [contextType, ...args]);
    };
    try {
        draw(stub);
    } finally {
        (HTMLCanvasElement.prototype as any).getContext = original;
    }
    return commands;
}

describe('resolvePhaserTheme', () => {
    it('実装済みテーマはそのまま返す', () => {
        const valid: PhaserThemeKind[] = ['none', 'oscilloscope', 'fluid_aurora', 'ambient_bokeh', 'spectrum_bars'];
        for (const thm of valid) {
            expect(resolvePhaserTheme(thm)).toBe(thm);
        }
    });

    it('未指定・空文字は既定テーマ (oscilloscope) を返す', () => {
        expect(resolvePhaserTheme(undefined)).toBe(DEFAULT_PHASER_THEME);
        expect(resolvePhaserTheme(null)).toBe(DEFAULT_PHASER_THEME);
        expect(resolvePhaserTheme('')).toBe(DEFAULT_PHASER_THEME);
        expect(DEFAULT_PHASER_THEME).toBe('oscilloscope');
    });

    it('旧称・類似テーマ名は世界観が近い実装済みテーマへ救済する', () => {
        expect(resolvePhaserTheme('cyber_grid')).toBe('spectrum_bars');
        expect(resolvePhaserTheme('starfield_warp')).toBe('fluid_aurora');
        expect(resolvePhaserTheme('monolith_fog')).toBe('ambient_bokeh');
        expect(resolvePhaserTheme('bokeh')).toBe('ambient_bokeh');
    });

    it('完全な未知語はフォールバックテーマ (fluid_aurora) へ救済し黒背景化を防ぐ', () => {
        expect(resolvePhaserTheme('totally_unknown_theme')).toBe(FALLBACK_PHASER_THEME);
        expect(FALLBACK_PHASER_THEME).toBe('fluid_aurora');
    });
});

describe('isPhaserCanvasUsable / 鮮度トラッカー', () => {
    it('null / サイズ 0 / DOM 未接続の canvas は使用不可と判定する', () => {
        expect(isPhaserCanvasUsable(null)).toBe(false);
        expect(isPhaserCanvasUsable(undefined)).toBe(false);

        const zero = document.createElement('canvas');
        zero.width = 0;
        zero.height = 0;
        expect(isPhaserCanvasUsable(zero)).toBe(false);

        const detached = document.createElement('canvas');
        detached.width = 64;
        detached.height = 64;
        expect(isPhaserCanvasUsable(detached)).toBe(false);
    });

    it('鮮度記録の付与と参照が動作する', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        document.body.appendChild(canvas);
        const before = isPhaserCanvasFresh(canvas);
        markPhaserCanvasFresh(canvas);
        expect(isPhaserCanvasFresh(canvas)).toBe(true);
        // 記録後は DOM 接続済み canvas が使用可能と判定される
        expect(isPhaserCanvasUsable(canvas)).toBe(true);
        expect(before).toBe(false);
        canvas.remove();
    });
});

describe('drawPhaserFallback', () => {
    it('全テーマで例外なく描画を完了する (ctx 未取得環境ではスキップ)', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        if (!ctx) return; // jsdom + node-canvas 未導入環境
        for (const thm of THEMES) {
            expect(() => drawPhaserFallback(ctx, 640, 360, 1.25, thm, makeSignals(1.25))).not.toThrow();
        }
    });

    it('同じ時刻・シグナルなら完全に同じピクセルを描く (決定論性)', () => {
        const a = document.createElement('canvas');
        a.width = 320;
        a.height = 180;
        const b = document.createElement('canvas');
        b.width = 320;
        b.height = 180;
        const ctxA = a.getContext('2d');
        const ctxB = b.getContext('2d');
        if (!ctxA || !ctxB) return;

        for (const thm of THEMES) {
            drawPhaserFallback(ctxA, 320, 180, 2.5, thm, makeSignals(2.5));
            drawPhaserFallback(ctxB, 320, 180, 2.5, thm, makeSignals(2.5));
            expect(a.toDataURL('image/png')).toBe(b.toDataURL('image/png'));
        }
    });

    it('時刻が進むと描画コマンドが変化する (静止画ホールドでないこと)', () => {
        const commands = recordCommands((ctx2) => {
            drawPhaserFallback(ctx2, 320, 180, 1.0, 'fluid_aurora', makeSignals(1.0));
        });
        const commandsLater = recordCommands((ctx2) => {
            drawPhaserFallback(ctx2, 320, 180, 3.5, 'fluid_aurora', makeSignals(3.5));
        });
        // 座標文字列の逐次記録で、時刻依存のモーションを検証
        expect(commands.join('\n')).not.toBe(commandsLater.join('\n'));
    });

    it('全テーマが時間経過で変化する (フォールバックは常にアニメーションする)', () => {
        for (const thm of THEMES) {
            const a = recordCommands((ctx2) => drawPhaserFallback(ctx2, 320, 180, 1.0, thm, makeSignals(1.0)));
            const b = recordCommands((ctx2) => drawPhaserFallback(ctx2, 320, 180, 4.0, thm, makeSignals(4.0)));
            expect(a.join('\n')).not.toBe(b.join('\n'));
        }
    });

    it('背景を描くため描画コマンドが空にならない (黒背景放置でないこと)', () => {
        for (const thm of THEMES) {
            const commands = recordCommands((ctx2) => drawPhaserFallback(ctx2, 320, 180, 0.8, thm, makeSignals(0.8)));
            // 塗りまたは線の描画命令が少なくとも 1 回は発行される
            expect(commands.some((c) => c === 'fill' || c === 'stroke' || c.startsWith('fillRect'))).toBe(true);
        }
    });

    it('none テーマと signals 未指定でも例外を投げない', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        expect(() => drawPhaserFallback(ctx, 160, 90, 0, 'none', makeSignals(0))).not.toThrow();
        expect(() => drawPhaserFallback(ctx, 160, 90, 0, 'fluid_aurora', undefined as unknown as AudioSignals)).not.toThrow();
    });

    it('非有限時刻は 0 にクランプされ例外を投げない', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        expect(() => drawPhaserFallback(ctx, 160, 90, Number.NaN, 'oscilloscope', makeSignals(0))).not.toThrow();
        expect(() => drawPhaserFallback(ctx, 160, 90, Number.POSITIVE_INFINITY, 'oscilloscope', makeSignals(0))).not.toThrow();
    });
});
