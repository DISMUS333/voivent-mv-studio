//==============================================================================
// stemAnalyzer 純関数の単体テスト。
// 合成 PCM / 包絡から onset 検知・BPM 推定・発声区間抽出の正しさを検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import {
    computeEnvelope,
    normalizeEnvelope,
    detectOnsets,
    estimateBeatGrid,
    extractVocalSegments,
    buildStemAnalysis,
    stemSignalsAtTime,
    DEFAULT_BAND_SEC,
} from './stemAnalyzer';
import { STEM_KINDS, type StemBuffers } from './types';

const SR = 44100;

/** 単発の減衰パルス (ドラム打撃モデル) を PCM へ加算する */
function addPulse(
    pcm: Float32Array,
    sampleRate: number,
    timeSec: number,
    amp = 0.9,
    decaySec = 0.08,
) {
    const start = Math.floor(timeSec * sampleRate);
    const len = Math.floor(decaySec * sampleRate);
    for (let i = 0; i < len && start + i < pcm.length; i++) {
        const env = Math.exp(-i / (len * 0.25));
        pcm[start + i] += amp * env * Math.sin((2 * Math.PI * 200 * i) / sampleRate);
    }
}

/** 一定振幅の矩形トーンを区間へ加算する */
function addTone(pcm: Float32Array, sampleRate: number, fromSec: number, toSec: number, amp = 0.5) {
    const s = Math.floor(fromSec * sampleRate);
    const e = Math.min(pcm.length, Math.floor(toSec * sampleRate));
    for (let i = s; i < e; i++) {
        pcm[i] = amp * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
}

function silence(sec: number): Float32Array {
    return new Float32Array(Math.floor(sec * SR));
}

function monoPair(l: Float32Array, r?: Float32Array): Record<'drums', StemBuffers> & Record<string, StemBuffers> {
    return {
        vocals: { left: silence(0.01), right: silence(0.01) },
        drums: { left: l, right: r ?? l },
        bass: { left: silence(0.01), right: silence(0.01) },
        other: { left: silence(0.01), right: silence(0.01) },
    };
}

describe('computeEnvelope', () => {
    it('無音 PCM は全バンド 0', () => {
        const env = computeEnvelope(silence(1), silence(1), SR, 0.25);
        expect(env.length).toBe(4);
        expect(env.every((v) => v === 0)).toBe(true);
    });

    it('一定振幅トーンの包絡はほぼ一定', () => {
        const pcm = silence(1);
        addTone(pcm, SR, 0, 1, 0.5);
        const env = computeEnvelope(pcm, pcm, SR, 0.25);
        expect(env.length).toBe(4);
        for (const v of env) {
            expect(v).toBeGreaterThan(0.3);
            expect(v).toBeLessThan(0.6);
        }
    });

    it('無効な sampleRate は空配列', () => {
        expect(computeEnvelope(silence(1), silence(1), 0, 0.25)).toEqual([]);
    });
});

describe('normalizeEnvelope', () => {
    it('最大値が 1 に正規化される', () => {
        const norm = normalizeEnvelope([0.2, 0.5, 1.0, 0.25]);
        expect(norm[2]).toBeCloseTo(1);
        expect(norm[0]).toBeCloseTo(0.2);
    });

    it('全 0 は全 0 のまま', () => {
        expect(normalizeEnvelope([0, 0, 0])).toEqual([0, 0, 0]);
    });
});

describe('detectOnsets', () => {
    it('120BPM のドラムパルス列から各拍の onset を検出する', () => {
        const dur = 8;
        const pcm = silence(dur);
        const bpm = 120;
        const beatSec = 60 / bpm;
        for (let t = 0.5; t < dur - 0.2; t += beatSec) {
            addPulse(pcm, SR, t);
        }
        const env = computeEnvelope(pcm, pcm, SR, DEFAULT_BAND_SEC);
        const onsets = detectOnsets(env, DEFAULT_BAND_SEC);
        expect(onsets.length).toBeGreaterThanOrEqual(10);
        // onset は昇順
        for (let i = 1; i < onsets.length; i++) {
            expect(onsets[i].timeSec).toBeGreaterThan(onsets[i - 1].timeSec);
        }
        // 最初の onset は 0.5 秒付近 (±1 バンド)
        expect(Math.abs(onsets[0].timeSec - 0.5)).toBeLessThanOrEqual(DEFAULT_BAND_SEC);
    });

    it('平坦な包絡からは onset を検出しない', () => {
        const pcm = silence(2);
        addTone(pcm, SR, 0, 2, 0.3);
        const env = computeEnvelope(pcm, pcm, SR, DEFAULT_BAND_SEC);
        expect(detectOnsets(env, DEFAULT_BAND_SEC)).toEqual([]);
    });
});

describe('estimateBeatGrid', () => {
    it('等間隔 onset から正しい BPM を推定する', () => {
        const bpm = 120;
        const beatSec = 60 / bpm;
        const onsets = [];
        for (let t = 0.5; t < 20; t += beatSec) {
            onsets.push({ timeSec: t, strength: 0.8 });
        }
        const grid = estimateBeatGrid(onsets, 20);
        expect(grid.bpm).toBeCloseTo(120, 0);
        expect(grid.confidence).toBeGreaterThan(0.5);
        // 位相は 0.5 秒付近 (拍周期 0.5s のため 0 または 0.5 に縮退し得る)
        expect(grid.offsetSec % 0.5).toBeCloseTo(0, 1);
    });

    it('onset が少なすぎる場合は推定しない', () => {
        const grid = estimateBeatGrid([{ timeSec: 1, strength: 0.5 }], 10);
        expect(grid.bpm).toBe(0);
        expect(grid.confidence).toBe(0);
    });
});

describe('extractVocalSegments', () => {
    it('しきい値以上の包絡区間を発声区間として抽出する', () => {
        // 1 秒発声 / 1 秒休止 を 3 回
        const env: number[] = [];
        for (let rep = 0; rep < 3; rep++) {
            for (let i = 0; i < 4; i++) env.push(0.8); // 1 秒 (bandSec 0.25)
            for (let i = 0; i < 8; i++) env.push(0.02); // 2 秒休止
        }
        const segs = extractVocalSegments(env, 0.25);
        expect(segs.length).toBe(3);
        expect(segs[0].startSec).toBeCloseTo(0, 1);
        expect(segs[0].endSec).toBeCloseTo(1, 1);
        expect(segs[0].meanEnergy).toBeGreaterThan(0.5);
    });

    it('隣接バンド (隙間なし) は 1 区間に統合される', () => {
        const env = [...Array(4).fill(0.8), ...Array(4).fill(0.8)];
        const segs = extractVocalSegments(env, 0.25);
        expect(segs.length).toBe(1);
    });

    it('1 バンド (250ms) の隙間は分割される', () => {
        const env = [...Array(4).fill(0.8), ...Array(1).fill(0.05), ...Array(4).fill(0.8)];
        const segs = extractVocalSegments(env, 0.25);
        expect(segs.length).toBe(2);
    });

    it('1 秒の隙間は分割される', () => {
        const env = [...Array(4).fill(0.8), ...Array(4).fill(0.05), ...Array(4).fill(0.8)];
        const segs = extractVocalSegments(env, 0.25);
        expect(segs.length).toBe(2);
    });

    it('空包絡は空配列', () => {
        expect(extractVocalSegments([], 0.25)).toEqual([]);
    });
});

describe('buildStemAnalysis', () => {
    it('ドラム PCM から onset と BPM を導出する', () => {
        const dur = 10;
        const drums = silence(dur);
        const beatSec = 0.5; // 120 BPM
        for (let t = 0.5; t < dur - 0.2; t += beatSec) {
            addPulse(drums, SR, t);
        }
        const stems = monoPair(drums);
        const analysis = buildStemAnalysis(stems as any, SR, dur);

        expect(analysis.version).toBe(1);
        expect(analysis.sampleRate).toBe(SR);
        expect(analysis.drumOnsets.length).toBeGreaterThanOrEqual(15);
        expect(analysis.proposedBpm).toBeCloseTo(120, 0);
        // 全 stem の包絡が生成される
        for (const kind of STEM_KINDS) {
            expect(Array.isArray(analysis.energy[kind])).toBe(true);
        }
        expect(analysis.energy.drums.length).toBeGreaterThan(30);
        expect(analysis.bandSec).toBe(DEFAULT_BAND_SEC);
    });

    it('決定論的: 同一入力なら同一結果', () => {
        const drums = silence(4);
        addPulse(drums, SR, 1);
        addPulse(drums, SR, 2);
        const a1 = buildStemAnalysis(monoPair(drums) as any, SR, 4);
        const a2 = buildStemAnalysis(monoPair(drums) as any, SR, 4);
        expect(a2).toEqual(a1);
    });
});

describe('stemSignalsAtTime', () => {
    // 0.5 秒間隔の 4 拍パルス。onset 検出時刻はバンド中央へ量子化されるため、
    // テストでは検出結果の実時刻を参照する (実装とテストの二重固定を避ける)
    const analysis = buildStemAnalysis(monoPair((() => {
        const pcm = silence(4);
        for (let t = 1.0; t < 3.0; t += 0.5) addPulse(pcm, SR, t, 1.0);
        return pcm;
    })()) as any, SR, 4);
    const firstOnset = analysis.drumOnsets[0];

    it('onset 直後は drumPulse が最大 (strength × 減衰直後)', () => {
        const t = firstOnset.timeSec + 0.02;
        const s = stemSignalsAtTime(analysis, t);
        expect(s.drumPulse).toBeGreaterThan(0.5);
        expect(s.timeSinceDrumOnset).toBeLessThan(0.1);
    });

    it('onset から離れると drumPulse は減衰し timeSince が増える', () => {
        const early = stemSignalsAtTime(analysis, firstOnset.timeSec + 0.05);
        const late = stemSignalsAtTime(analysis, firstOnset.timeSec + 0.45);
        expect(late.drumPulse).toBeLessThan(early.drumPulse);
        expect(late.timeSinceDrumOnset).toBeGreaterThan(early.timeSinceDrumOnset);
    });

    it('onset 前は drumPulse 0', () => {
        expect(stemSignalsAtTime(analysis, firstOnset.timeSec - 0.2).drumPulse).toBe(0);
    });

    it('null / 異常時刻はゼロ値を返す', () => {
        const s = stemSignalsAtTime(null, 1);
        expect(s.drumPulse).toBe(0);
        expect(s.vocalActive).toBe(false);
        expect(stemSignalsAtTime(analysis, -1).drumPulse).toBe(0);
    });

    it('ボーカル包絡から vocalActive が決まる', () => {
        // 発声区間抽出の統合テスト: vocals にトーンを入れれば active になる
        const vocals = silence(4);
        addTone(vocals, SR, 1.0, 2.0, 0.6);
        const withVocal = buildStemAnalysis({
            ...monoPair(silence(0.01)),
            vocals: { left: vocals, right: vocals },
        } as any, SR, 4);
        const inside = stemSignalsAtTime(withVocal, 1.5);
        const outside = stemSignalsAtTime(withVocal, 3.5);
        expect(inside.vocalActive).toBe(true);
        expect(inside.vocalEnergy).toBeGreaterThan(0.3);
        expect(outside.vocalActive).toBe(false);
    });
});
