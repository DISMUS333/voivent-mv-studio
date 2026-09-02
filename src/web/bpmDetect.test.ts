//==============================================================================
// bpmDetect.ts の単体テスト。
// ピーク波形からの BPM 推定 (自己相関) と、判断不能時の null 返却を検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { detectBpmFromPeaks } from './bpmDetect';

/** 指定 BPM のクリック (キック) トラックのピーク波形を生成する */
function makeClickTrack(bpm: number, durationSec = 12, samplesPerSec = 50): { peaks: Array<[number, number]>; duration: number } {
    const count = Math.ceil(durationSec * samplesPerSec);
    const beatSec = 60 / bpm;
    const peaks: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / samplesPerSec;
        const phase = t % beatSec;
        // ビート直後 80ms だけ強い振幅 (キック)
        const amp = phase < 0.08 ? 0.9 : 0.02;
        peaks.push([-amp, amp]);
    }
    return { peaks, duration: durationSec };
}

describe('detectBpmFromPeaks', () => {
    it('120 BPM のクリックトラックから 120 付近の値を検出する', () => {
        const r = detectBpmFromPeaks(makeClickTrack(120));
        expect(r).not.toBeNull();
        // 折り畳み後の許容範囲 (2倍/半分の倍音関係を許容)
        expect([60, 120, 240]).toContain(r);
    });

    it('85 BPM のトラックから 85 付近 (または倍半関係) を検出する', () => {
        const r = detectBpmFromPeaks(makeClickTrack(85));
        expect(r).not.toBeNull();
        expect([42, 85, 170].some((v) => Math.abs((r ?? 0) - v) <= 6)).toBe(true);
    });

    it('無音トラックは null を返す (判断しない)', () => {
        const peaks: Array<[number, number]> = Array.from({ length: 240 }, () => [0, 0] as [number, number]);
        expect(detectBpmFromPeaks({ peaks, duration: 12 })).toBeNull();
    });

    it('データ不足・異常入力は null を返す', () => {
        expect(detectBpmFromPeaks(null)).toBeNull();
        expect(detectBpmFromPeaks({ peaks: [], duration: 10 })).toBeNull();
        expect(detectBpmFromPeaks({ peaks: [[-0.5, 0.5]], duration: Number.NaN })).toBeNull();
    });
});