import { describe, expect, it } from 'vitest';
import { computePeaks } from './stemPeaks';

describe('computePeaks', () => {
    it('比例ブロックで PCM の末尾まで集計する', () => {
        const left = new Float32Array(10);
        const right = new Float32Array(10);
        right[9] = 0.75;

        const peaks = computePeaks({ left, right }, 3);

        expect(peaks[2]).toBe(1);
        expect(peaks[0]).toBe(0);
        expect(peaks[1]).toBe(0);
    });

    it('左右チャンネルの大きい方を採用して正規化する', () => {
        const left = new Float32Array([0.1, 0.2, 0]);
        const right = new Float32Array([0.4, 0.05, 0]);

        expect(Array.from(computePeaks({ left, right }, 3))).toEqual([1, 0.5, 0]);
    });

    it('無効な PCM 値はピークを汚染しない', () => {
        const left = new Float32Array([Number.NaN, 0.5]);
        const right = new Float32Array([Number.NaN, 0.25]);

        expect(Array.from(computePeaks({ left, right }, 2))).toEqual([0, 1]);
    });
});
