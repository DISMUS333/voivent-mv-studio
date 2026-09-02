//==============================================================================
// withStemSignals (AudioSignals 合成) の契約テスト。
// 「未分離時は 1 バイトも変更しない」後方互換を最優先で検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { withStemSignals } from './stemSignals';
import type { AudioSignals } from '../types';
import type { StemAnalysis } from './types';

const baseSignals: AudioSignals = {
    peak: 0.6,
    low: 0.7,
    mid: 0.5,
    high: 0.3,
    beat: 0.4,
    isPlaying: true,
    timeSeconds: 1.02,
    bpm: 120,
};

const analysis: StemAnalysis = {
    version: 1,
    sampleRate: 44100,
    durationSec: 10,
    proposedBpm: 122,
    beatConfidence: 0.8,
    beatOffsetSec: 0.5,
    drumOnsets: [
        { timeSec: 1.0, strength: 0.9 },
        { timeSec: 1.5, strength: 0.5 },
    ],
    energy: {
        vocals: [0.1, 0.9, 0.9, 0.1],
        drums: [0, 1, 0, 0],
        bass: [0.8, 0.8, 0, 0],
        other: [0, 0, 0, 0],
    },
    bandSec: 0.25,
    vocalSegments: [{ startSec: 0.25, endSec: 0.75, meanEnergy: 0.9 }],
};

describe('withStemSignals', () => {
    it('未分離 (analysis null) は入力をそのまま返す (同一参照)', () => {
        expect(withStemSignals(baseSignals, null, true)).toBe(baseSignals);
    });

    it('stemMode OFF は入力をそのまま返す (同一参照)', () => {
        expect(withStemSignals(baseSignals, analysis, false)).toBe(baseSignals);
    });

    it('分離済み + ON は stem シグナルを付与し beat/low を強化する', () => {
        const merged = withStemSignals(baseSignals, analysis, true);
        expect(merged.stem).toBeDefined();
        // onset 1.0 → 1.02 は直後なのでパルス高め
        expect(merged.stem!.drumPulse).toBeGreaterThan(0.5);
        expect(merged.stem!.timeSinceDrumOnset).toBeCloseTo(0.02, 2);
        // 実測 bass 包絡 (band0 = 0.8) が low を引き上げる
        expect(merged.low).toBeGreaterThanOrEqual(baseSignals.low);
        // beat は実測パルスと擬似拍の最大値
        expect(merged.beat).toBeGreaterThanOrEqual(baseSignals.beat);
    });

    it('既存フィールド (peak / mid / viseme 等) は上書きしない', () => {
        const merged = withStemSignals(baseSignals, analysis, true);
        expect(merged.peak).toBe(baseSignals.peak);
        expect(merged.mid).toBe(baseSignals.mid);
        expect(merged.isPlaying).toBe(baseSignals.isPlaying);
        expect(merged.timeSeconds).toBe(baseSignals.timeSeconds);
        expect(merged.bpm).toBe(baseSignals.bpm);
    });
});
