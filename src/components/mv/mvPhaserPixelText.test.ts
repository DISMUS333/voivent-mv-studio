//==============================================================================
// mvPhaserPixelText / 歌詞レイヤーモードゲートの回帰テスト。
//
// 背景: AI 生成プリセット（lyricEffect 付きシーン）で動画書き出しすると、
// プレビューの粒子文字が消え「水色のカラオケ塗りテロップ」へすり替わる
// 不具合が発生していた。ライブと同一の表示モード解決＋決定論的粒子文字
// 再現で修正したことを検証する。
//==============================================================================
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioSignals, LyricEffectKind, LyricItem, MvScene } from './types';
import { drawPhaserPixelLyric } from './mvPhaserPixelText';
import { renderFrameToCanvas } from './mvFrameRenderer';

const makeSignals = (t: number): AudioSignals => ({
    peak: 0.8,
    low: 0.5,
    mid: 0.4,
    high: 0.3,
    beat: 0.7,
    isPlaying: true,
    timeSeconds: t,
    bpm: 120,
});

const lyric: LyricItem = { time: 0, duration: 4, text: '夢の先へ' };

interface RecordedCommand { op: string; args: number[]; }

/**
 * jsdom の getContext('2d') を差し替える。
 * - メイン描画先（__mvTestMain マーカー付き canvas）: 描画命令を記録するスタブ
 * - それ以外（モジュール内部のオフスクリーン字形スキャン用）: 塗り文字→全ピクセル不透明を返すスタブ
 */
function installCanvasStubs(): { commands: RecordedCommand[]; restore: () => void } {
    const commands: RecordedCommand[] = [];
    const num = (v: number) => Number(v.toFixed(3));
    const mainStub: Record<string, unknown> = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        shadowColor: '',
        shadowBlur: 0,
        font: '',
        fillRect: (x: number, y: number, w: number, h: number) => commands.push({ op: 'fillRect', args: [num(x), num(y), num(w), num(h)] }),
        beginPath: () => { commands.push({ op: 'beginPath', args: [] }); },
        closePath: () => {},
        moveTo: (x: number, y: number) => commands.push({ op: 'moveTo', args: [num(x), num(y)] }),
        lineTo: (x: number, y: number) => commands.push({ op: 'lineTo', args: [num(x), num(y)] }),
        arc: (x: number, y: number, r: number) => commands.push({ op: 'arc', args: [num(x), num(y), num(r)] }),
        fill: () => { commands.push({ op: 'fill', args: [] }); },
        stroke: () => { commands.push({ op: 'stroke', args: [] }); },
        save: () => {},
        restore: () => {},
        fillText: () => { commands.push({ op: 'fillText', args: [] }); },
        strokeText: () => {},
        measureText: (text: string) => ({ width: text.length * 42 }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
    };
    const offscreenStub: Record<string, unknown> = {
        font: '',
        fillStyle: '',
        textAlign: '',
        textBaseline: '',
        measureText: (text: string) => ({ width: text.length * 42 }),
        fillText: () => {},
        getImageData: (x: number, y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
    };
    const original = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = function (
        this: HTMLCanvasElement,
        contextType: string,
        ...args: unknown[]
    ) {
        if (contextType !== '2d') {
            return (original as (...a: unknown[]) => unknown).apply(this, [contextType, ...args] as unknown as unknown[]);
        }
        const isMain = (this as unknown as Record<string, unknown>).__mvTestMain === true;
        return isMain ? mainStub : offscreenStub;
    };
    return {
        commands,
        restore: () => {
            (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = original;
        },
    };
}

function makeMainCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    (canvas as unknown as Record<string, unknown>).__mvTestMain = true;
    return canvas;
}

describe('drawPhaserPixelLyric', () => {
    it('粒子文字は字形サンプリングした fillRect 群で描かれる', () => {
        const { commands, restore } = installCanvasStubs();
        try {
            const ctx = makeMainCanvas().getContext('2d') as CanvasRenderingContext2D;
            drawPhaserPixelLyric(ctx, 1280, 720, 1.0, lyric, 'particle_disintegrate', makeSignals(1.0));
            const rects = commands.filter((c) => c.op === 'fillRect');
            expect(rects.length).toBeGreaterThan(100);
            // 粒子文字は画面下 3/4 (height * 0.75) 近傍に集中する
            const nearLyricY = rects.filter((c) => c.args[1] > 720 * 0.6 && c.args[1] < 720 * 0.9);
            expect(nearLyricY.length).toBeGreaterThan(50);
            expect(String((ctx as unknown as Record<string, unknown>).fillStyle)).toContain('rgba(255,255,255');
        } finally {
            restore();
        }
    });

    it('lyricEffect none は何も描かない', () => {
        const { commands, restore } = installCanvasStubs();
        try {
            const ctx = makeMainCanvas().getContext('2d') as CanvasRenderingContext2D;
            drawPhaserPixelLyric(ctx, 1280, 720, 1.0, lyric, 'none', makeSignals(1.0));
            expect(commands).toHaveLength(0);
        } finally {
            restore();
        }
    });

    it('フレーズ区間外では描画しない', () => {
        const { commands, restore } = installCanvasStubs();
        try {
            const ctx = makeMainCanvas().getContext('2d') as CanvasRenderingContext2D;
            drawPhaserPixelLyric(ctx, 1280, 720, 5.0, lyric, 'particle_disintegrate', makeSignals(5.0));
            expect(commands).toHaveLength(0);
        } finally {
            restore();
        }
    });
});

describe('drawPhaserPixelLyric 決定論性', () => {
    it('6 エフェクトすべてが同一入力に対し完全に同一の描画命令になる', () => {
        const effects: LyricEffectKind[] = [
            'particle_disintegrate',
            'kinetic_assembly',
            'liquid_morph',
            'impact_reactive',
            'glitch_neon',
            'camera_warp',
        ];
        const run = (effect: LyricEffectKind): RecordedCommand[] => {
            const { commands, restore } = installCanvasStubs();
            try {
                const ctx = makeMainCanvas().getContext('2d') as CanvasRenderingContext2D;
                drawPhaserPixelLyric(ctx, 640, 360, 2.0, lyric, effect, makeSignals(2.0));
                return commands;
            } finally {
                restore();
            }
        };
        for (const effect of effects) {
            const first = run(effect);
            expect(first.length).toBeGreaterThan(0);
            expect(run(effect)).toEqual(first);
        }
    });

    it('粒子崩壊は時刻が進むと描画が変化する（静止動画化しない）', () => {
        const run = (t: number): RecordedCommand[] => {
            const { commands, restore } = installCanvasStubs();
            try {
                const ctx = makeMainCanvas().getContext('2d') as CanvasRenderingContext2D;
                drawPhaserPixelLyric(ctx, 1280, 720, t, lyric, 'particle_disintegrate', makeSignals(t));
                return commands;
            } finally {
                restore();
            }
        };
        expect(run(1.0)).not.toEqual(run(3.5));
    });

    it('glitch_neon は最後に青ゴースト色を設定する（赤→青の色収差）', () => {
        const { restore } = installCanvasStubs();
        try {
            const ctx = makeMainCanvas().getContext('2d') as CanvasRenderingContext2D;
            drawPhaserPixelLyric(ctx, 1280, 720, 1.0, lyric, 'glitch_neon', makeSignals(1.0));
            expect(String((ctx as unknown as Record<string, unknown>).fillStyle)).toBe('rgba(56, 189, 248, 0.75)');
        } finally {
            restore();
        }
    });
});

describe('renderFrameToCanvas 歌詞レイヤーモードゲート', () => {
    /** AI 生成カスタムシーン相当（既知プリセット識別子を含まない・svgCode なし） */
    const aiScene: MvScene = {
        id: 'scene_1',
        name: 'AI Scene',
        startTime: 0,
        endTime: 8,
        lyricEffect: 'particle_disintegrate',
    };

    const renderCommands = async (scene: MvScene, lyricStyle?: Record<string, unknown>): Promise<RecordedCommand[]> => {
        const { commands, restore } = installCanvasStubs();
        try {
            const canvas = makeMainCanvas();
            const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
            await renderFrameToCanvas({
                canvas,
                ctx,
                width: 1280,
                height: 720,
                timeSec: 1.0,
                scenes: [scene],
                lyrics: [lyric],
                signals: makeSignals(1.0),
                lyricStyle: lyricStyle as never,
                isOfflineRender: true,
            });
            return commands;
        } finally {
            restore();
        }
    };

    it('lyricEffect 付き AI シーンの書き出しは粒子文字になり、カラオケテロップ（水色塗り）にすり替わらない', async () => {
        const commands = await renderCommands(aiScene);
        // 粒子文字の fillRect が大量に描かれる
        expect(commands.filter((c) => c.op === 'fillRect').length).toBeGreaterThan(100);
        // 水色カラオケ塗りは一切使われない（デフォルト karaokeColor 不使用）
        const styles = commands.map((c) => c.op);
        expect(styles).not.toContain('fillText');
        // 粒子文字はボトムテロップ位置 (0.85h) ではなく 0.75h 近傍に描かれる
        const rects = commands.filter((c) => c.op === 'fillRect');
        const nearBottomTelop = rects.filter((c) => c.args[1] > 720 * 0.8).length;
        const nearParticleY = rects.filter((c) => c.args[1] > 720 * 0.6 && c.args[1] < 720 * 0.8).length;
        expect(nearParticleY).toBeGreaterThan(nearBottomTelop);
    });

    it('lyricEffect なしシーンの書き出しは従来どおりテロップ文字（fillText）を描く', async () => {
        const quietScene = { ...aiScene, lyricEffect: undefined };
        const commands = await renderCommands(quietScene);
        expect(commands.some((c) => c.op === 'fillText')).toBe(true);
        // カラオケ無効時は水色のカラオケ塗りに進まない（白文字のまま）
        expect(commands.filter((c) => c.op === 'fillRect').length).toBeLessThan(100);
    });
});



afterEach(() => {
    // 念のため復元漏れがあっても次テストへ影響させない
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext =
        HTMLCanvasElement.prototype.getContext;
});
