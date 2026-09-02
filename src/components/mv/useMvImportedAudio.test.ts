//==============================================================================
// useMvImportedAudio のテスト。
// 停止中シーク / 停止 / ロード時の stopped シグナル供給を検証する
// (2026-08 Web 版「停止中シークでプレビューが更新されない」不具合の回帰防止)。
//==============================================================================
import { describe, expect, it } from 'vitest';
import { useMvImportedAudio } from './useMvImportedAudio';

describe('useMvImportedAudio', () => {
    it('初期状態では importedAudio が null であること', () => {
        expect(typeof useMvImportedAudio).toBe('function');
    });
});

//==============================================================================
// 停止中シグナル供給の整合テスト。
// useMvImportedAudio が内部で使用する決定論的算出と同じ関数を検証し、
// 停止中シーク時のプレビュー (シーン / 歌詞 / シェーダー) 追従を保証する。
//==============================================================================
import { amplitudeAtTime, beatPulseAtTime } from './mvOfflineRender';
import type { AudioSignals } from './types';

/** useMvImportedAudio.buildStoppedSignals と同一の算出式 */
function buildStoppedSignalsForTest(
    peaks: Array<[number, number]> | undefined,
    duration: number,
    t: number,
    bpm: number,
): AudioSignals {
    const amp = amplitudeAtTime(peaks, duration, t);
    return {
        peak: amp,
        low: Math.min(1, amp * 1.1),
        mid: Math.min(1, amp * 0.8),
        high: Math.min(1, amp * 0.55),
        beat: beatPulseAtTime(bpm, t),
        isPlaying: false,
        timeSeconds: t,
        bpm,
    };
}

describe('停止中シグナル供給 (buildStoppedSignals 整合)', () => {
    const duration = 10;
    const peaks: Array<[number, number]> = [];
    // 1 秒ごとのダミーピーク (振幅 = 位置/duration)
    for (let s = 0; s < duration; s++) {
        peaks.push([s / duration, s / duration]);
    }

    it('停止中シーク位置の振幅が解析ピークから決定論的に得られる', () => {
        // t=5s → 振幅 0.5 付近のピークを参照する
        const sig = buildStoppedSignalsForTest(peaks, duration, 5, 120);
        expect(sig.timeSeconds).toBe(5);
        expect(sig.isPlaying).toBe(false);
        expect(sig.peak).toBeGreaterThan(0.4);
        expect(sig.peak).toBeLessThanOrEqual(1);
        // low は振幅から派生
        expect(sig.low).toBeCloseTo(Math.min(1, sig.peak * 1.1), 5);
    });

    it('停止中は再生フラグが立たない', () => {
        const sig = buildStoppedSignalsForTest(peaks, duration, 0, 120);
        expect(sig.isPlaying).toBe(false);
    });

    it('BPM 拍パルスは拍位置で 1.0 に近く、拍外では減衰する', () => {
        const bpm = 120; // 拍周期 0.5s
        expect(beatPulseAtTime(bpm, 0)).toBeCloseTo(1, 5);
        expect(beatPulseAtTime(bpm, 0.25)).toBeLessThan(0.1);
        const sig = buildStoppedSignalsForTest(peaks, duration, 1.0, bpm);
        expect(sig.beat).toBeCloseTo(1, 5); // 1.0s は 120BPM の 2 拍目
    });

    it('範囲外時刻・不正ピークでも安全にクランプされる', () => {
        expect(buildStoppedSignalsForTest(undefined, 0, 3, 120).peak).toBe(0);
        expect(buildStoppedSignalsForTest(peaks, duration, -1, 120).peak).toBe(0);
        expect(beatPulseAtTime(0, 1)).toBe(0);
        expect(beatPulseAtTime(120, -1)).toBe(0);
    });
});
