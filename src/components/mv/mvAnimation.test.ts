//==============================================================================
// mvAnimation.ts の単体テスト。
// キーフレーム補間・イージング・カラオケ進行・タイミング自動生成を検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import {
    applyEasing,
    evaluateKeyframes,
    keyframeTransformCss,
    karaokeProgress,
    generateLyricTimings,
} from './mvAnimation';
import type { MvKeyframe, LyricItem } from './types';

describe('applyEasing', () => {
    it('linear は入力値をそのまま返す', () => {
        expect(applyEasing(0.25)).toBeCloseTo(0.25);
        expect(applyEasing(0.7)).toBeCloseTo(0.7);
    });

    it('easeIn は二次曲線で加速する', () => {
        expect(applyEasing(0.5, 'easeIn')).toBeCloseTo(0.25);
    });

    it('easeOut は二次曲線で減速する', () => {
        expect(applyEasing(0.5, 'easeOut')).toBeCloseTo(0.75);
    });

    it('easeInOut は中点で 0.5 を通る', () => {
        expect(applyEasing(0.5, 'easeInOut')).toBeCloseTo(0.5);
    });

    it('範囲外はクランプされる', () => {
        expect(applyEasing(-1)).toBe(0);
        expect(applyEasing(2)).toBe(1);
    });
});

describe('evaluateKeyframes', () => {
    const frames: MvKeyframe[] = [
        { t: 0, value: 0 },
        { t: 0.5, value: 10 },
        { t: 1, value: 20 },
    ];

    it('未定義・空配列は undefined', () => {
        expect(evaluateKeyframes(undefined, 0.5)).toBeUndefined();
        expect(evaluateKeyframes([], 0.5)).toBeUndefined();
    });

    it('単一キーフレームはその値を返す', () => {
        expect(evaluateKeyframes([{ t: 0.3, value: 42 }], 0.9)).toBe(42);
    });

    it('先頭より前はクランプ', () => {
        expect(evaluateKeyframes(frames, -0.5)).toBe(0);
    });

    it('末尾より後はクランプ', () => {
        expect(evaluateKeyframes(frames, 1.5)).toBe(20);
    });

    it('区間内は線形補間される', () => {
        expect(evaluateKeyframes(frames, 0.25)).toBeCloseTo(5);
        expect(evaluateKeyframes(frames, 0.75)).toBeCloseTo(15);
    });

    it('キーフレーム位置では正確な値を返す', () => {
        expect(evaluateKeyframes(frames, 0.5)).toBeCloseTo(10);
    });

    it('ソートされていない入力でも正しく補間する', () => {
        const unsorted: MvKeyframe[] = [
            { t: 1, value: 20 },
            { t: 0, value: 0 },
            { t: 0.5, value: 10 },
        ];
        expect(evaluateKeyframes(unsorted, 0.25)).toBeCloseTo(5);
    });
});

describe('keyframeTransformCss', () => {
    it('空オブジェクトは空文字列', () => {
        expect(keyframeTransformCss({})).toBe('');
    });

    it('scale / rotate / translate を生成する', () => {
        const css = keyframeTransformCss({ scale: 1.2, rotateDeg: 45 });
        expect(css).toContain('scale(1.2)');
        expect(css).toContain('rotate(45deg)');
    });

    it('blur / brightness は filter 部へ出力する', () => {
        const css = keyframeTransformCss({ blurPx: 4, brightness: 1.5 });
        expect(css).toContain('blur(4px)');
        expect(css).toContain('brightness(1.5)');
    });

    it('blur がほぼ 0 の場合は省略される', () => {
        expect(keyframeTransformCss({ blurPx: 0 })).not.toContain('blur');
    });
});

describe('karaokeProgress', () => {
    const lyric: LyricItem = { time: 10, duration: 4, text: 'テスト' };

    it('開始前は 0', () => {
        expect(karaokeProgress(8, lyric)).toBe(0);
        expect(karaokeProgress(10, lyric)).toBe(0);
    });

    it('終了後は 1', () => {
        expect(karaokeProgress(14, lyric)).toBe(1);
        expect(karaokeProgress(20, lyric)).toBe(1);
    });

    it('進行中は線形に増加する', () => {
        expect(karaokeProgress(12, lyric)).toBeCloseTo(0.5);
    });
});

describe('generateLyricTimings', () => {
    it('データなし時は等間隔フォールバック', () => {
        const result = generateLyricTimings({
            peaks: [],
            durationSec: 16,
            phraseCount: 4,
        });
        expect(result).toHaveLength(4);
        expect(result[0].time).toBe(0);
        expect(result[3].time).toBeCloseTo(12);
    });

    it('エネルギー高い区間を優先して選択する', () => {
        // 100 ピーク × 0.1 秒 = 10 秒。後半に強いエネルギーを配置
        const peaks: Array<[number, number]> = [];
        for (let i = 0; i < 100; i++) {
            const amp = i >= 50 ? 0.9 : 0.05;
            peaks.push([-amp, amp]);
        }
        const result = generateLyricTimings({
            peaks,
            durationSec: 10,
            phraseCount: 2,
        });
        expect(result).toHaveLength(2);
        // 時刻昇順
        expect(result[0].time).toBeLessThan(result[1].time);
        // 少なくとも一方は後半（5秒以降）に配置される
        expect(Math.max(...result.map((r) => r.time))).toBeGreaterThanOrEqual(4.5);
    });

    it('テキスト配列があれば順に引き継ぐ', () => {
        const peaks: Array<[number, number]> = Array.from({ length: 40 }, () => [-0.5, 0.5]);
        const result = generateLyricTimings({
            peaks,
            durationSec: 4,
            phraseCount: 3,
            texts: ['A', 'B', 'C'],
        });
        expect(result.map((r) => r.text)).toEqual(['A', 'B', 'C']);
    });

    it('duration は最小 0.5 秒以上になる', () => {
        const peaks: Array<[number, number]> = Array.from({ length: 200 }, (_, i) =>
            i < 190 ? [-0.01, 0.01] : [-0.9, 0.9],
        );
        const result = generateLyricTimings({
            peaks,
            durationSec: 20,
            phraseCount: 1,
        });
        for (const r of result) {
            expect(r.duration).toBeGreaterThanOrEqual(0.5);
        }
    });
});