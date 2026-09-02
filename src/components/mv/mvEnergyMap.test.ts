//==============================================================================
// mvEnergyMap.ts の単体テスト。
// エネルギー分類、BPM 同期バンド分割、楽曲構造（イントロ/ピーク/ドロップ/静寂）
// の導出、および WebMCP 応答用の間引き処理を検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { classifyEnergy, buildEnergyMap, compressToMacroSections, downsampleEnergyMapBands } from './mvEnergyMap';

/**
 * 指定セグメント [from, to, amp] で振幅が定義された解析ピークを生成する。
 * セグメント外は無音（amp = 0）。
 */
function makeAnalysis(
    durationSec: number,
    segments: Array<{ from: number; to: number; amp: number }>,
    samplesPerSec = 20,
): { peaks: Array<[number, number]>; duration: number } {
    const count = Math.ceil(durationSec * samplesPerSec);
    const peaks: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / samplesPerSec;
        const seg = segments.find((s) => t >= s.from && t < s.to);
        const amp = seg ? seg.amp : 0;
        peaks.push([-amp, amp]);
    }
    return { peaks, duration: durationSec };
}

describe('classifyEnergy', () => {
    it('しきい値に従って 4 分類へ振り分ける', () => {
        expect(classifyEnergy(0)).toBe('quiet');
        expect(classifyEnergy(0.05)).toBe('quiet');
        expect(classifyEnergy(0.08)).toBe('low');
        expect(classifyEnergy(0.3)).toBe('low');
        expect(classifyEnergy(0.35)).toBe('mid');
        expect(classifyEnergy(0.69)).toBe('mid');
        expect(classifyEnergy(0.7)).toBe('high');
        expect(classifyEnergy(1.0)).toBe('high');
    });

    it('非数値は quiet 扱いにする', () => {
        expect(classifyEnergy(Number.NaN)).toBe('quiet');
        expect(classifyEnergy(Number.POSITIVE_INFINITY)).toBe('quiet');
    });
});

describe('buildEnergyMap', () => {
    it('120 BPM・8分音符分解能で 0.25 秒バンドに分割する', () => {
        const analysis = makeAnalysis(8, [{ from: 0, to: 8, amp: 0.5 }]);
        const map = buildEnergyMap(120, analysis);

        expect(map.bpm).toBe(120);
        expect(map.beatSec).toBe(0.5);
        expect(map.bandSec).toBe(0.25);
        expect(map.bandsPerBeat).toBe(2);
        expect(map.durationSec).toBe(8);
        expect(map.bands.length).toBe(32);

        const first = map.bands[0];
        expect(first.startSec).toBe(0);
        expect(first.endSec).toBeCloseTo(0.25, 5);
        expect(first.energy).toBeCloseTo(0.5, 5);
        expect(first.kind).toBe('mid');
        expect(first.bar).toBe(1);
        // バンド中心 0.125 秒 = 0.25 拍目
        expect(first.beatInBar).toBeCloseTo(0.25, 3);
    });

    it('帯域別推定値は low + mid + high = energy を満たす', () => {
        const analysis = makeAnalysis(2, [{ from: 0, to: 2, amp: 0.6 }]);
        const map = buildEnergyMap(120, analysis);
        for (const b of map.bands) {
            expect(b.low + b.mid + b.high).toBeCloseTo(b.energy, 5);
            expect(b.low).toBeGreaterThanOrEqual(0);
            expect(b.high).toBeGreaterThanOrEqual(0);
        }
    });

    it('イントロ長・ピーク・ドロップ・最長静寂を正しく導出する', () => {
        // 0-2s: 静寂イントロ / 2-8s: 中強度 / 8-12s: ピーク / 12-12.5s: 急落 / 12.5-16s: 中強度
        const analysis = makeAnalysis(16, [
            { from: 0, to: 2, amp: 0.02 },
            { from: 2, to: 8, amp: 0.5 },
            { from: 8, to: 12, amp: 0.9 },
            { from: 12, to: 12.5, amp: 0.05 },
            { from: 12.5, to: 16, amp: 0.6 },
        ]);
        const map = buildEnergyMap(120, analysis);

        expect(map.summary.introEndSec).toBe(2);
        expect(map.summary.dropStartSec).toBe(12);
        expect(map.summary.peakEnergy).toBeCloseTo(0.9, 3);
        expect(map.summary.peakStartSec).toBe(8);
        expect(map.summary.longestQuietStartSec).toBe(0);
        expect(map.summary.longestQuietEndSec).toBe(2);

        // セクション圧縮の順序と境界
        const kinds = map.summary.sections.map((s) => s.kind);
        expect(kinds).toEqual(['quiet', 'mid', 'high', 'quiet', 'mid']);
        expect(map.summary.sections[0].startSec).toBe(0);
        expect(map.summary.sections[0].endSec).toBe(2);
        expect(map.summary.sections[1].endSec).toBe(8);
        expect(map.summary.sections[2].endSec).toBe(12);
        expect(map.summary.sections[3].endSec).toBe(12.5);
        expect(map.summary.sections[4].endSec).toBe(16);
    });

    it('静寂が無い楽曲では longestQuiet / drop が null になる', () => {
        const analysis = makeAnalysis(4, [{ from: 0, to: 4, amp: 0.5 }]);
        const map = buildEnergyMap(120, analysis);
        expect(map.summary.longestQuietStartSec).toBeNull();
        expect(map.summary.longestQuietEndSec).toBeNull();
        expect(map.summary.dropStartSec).toBeNull();
        // 冒頭が mid なのでイントロは null
        expect(map.summary.introEndSec).toBeNull();
    });


    it('解析データが空の場合は空のマップを返す', () => {
        expect(buildEnergyMap(120, null).bands.length).toBe(0);
        expect(buildEnergyMap(120, { peaks: [], duration: 10 }).bands.length).toBe(0);
        expect(buildEnergyMap(120, { peaks: [[-0.5, 0.5]], duration: 0 }).bands.length).toBe(0);
        expect(buildEnergyMap(120, { peaks: [[-0.5, 0.5]], duration: Number.NaN }).bands.length).toBe(0);

        const empty = buildEnergyMap(120, null);
        expect(empty.summary.sections).toEqual([]);
        expect(empty.summary.avgEnergy).toBe(0);
        expect(empty.summary.introEndSec).toBeNull();
    });

    it('解析データに duration が無い場合は durationSec オプションをフォールバックに使う', () => {
        const analysis = makeAnalysis(4, [{ from: 0, to: 4, amp: 0.5 }]);
        const noDuration = { peaks: analysis.peaks };
        // フォールバック: duration 無し → オプション採用
        const map = buildEnergyMap(120, noDuration, { durationSec: 4 });
        expect(map.durationSec).toBe(4);
        expect(map.bands.length).toBe(16);
        // 解析データに duration がある場合はそちらが優先される
        const withDuration = buildEnergyMap(120, analysis, { durationSec: 4 });
        expect(withDuration.durationSec).toBe(4);
    });

    it('異常 BPM は 120 にフォールバックする', () => {
        const analysis = makeAnalysis(4, [{ from: 0, to: 4, amp: 0.5 }]);
        const map = buildEnergyMap(Number.NaN, analysis);
        expect(map.bpm).toBe(120);
        expect(map.beatSec).toBe(0.5);
    });

    it('16分音符分解能 (bandsPerBeat=4) を受け付ける', () => {
        const analysis = makeAnalysis(2, [{ from: 0, to: 2, amp: 0.5 }]);
        const map = buildEnergyMap(120, analysis, { bandsPerBeat: 4 });
        expect(map.bandsPerBeat).toBe(4);
        expect(map.bandSec).toBeCloseTo(0.125, 5);
        expect(map.bands.length).toBe(16);
    });

    it('極端に高分解能な要求でもバンド総数が上限に収まる', () => {
        // 60 秒 @ 120 BPM, bandsPerBeat=8 → 理論上 960 バンド < 上限 4096
        const analysis = makeAnalysis(60, [{ from: 0, to: 60, amp: 0.5 }], 20);
        const map = buildEnergyMap(120, analysis, { bandsPerBeat: 8 });
        expect(map.bandsPerBeat).toBe(8);
        expect(map.bands.length).toBeLessThanOrEqual(4096);
        // 最終バンドの終端は必ず durationSec 以下
        const last = map.bands[map.bands.length - 1];
        expect(last.endSec).toBeLessThanOrEqual(60);
    });
});

describe('compressToMacroSections', () => {
    const sec = (kind: string, startSec: number, endSec: number, avgEnergy: number) =>
        ({ kind, startSec, endSec, avgEnergy } as any);

    it('1 拍ごとに分断された細かいセクションを 3〜12 区間へ圧縮する', () => {
        // 実機テストで観測された破綻パターン: 0.25 秒級の low/mid 交互が 96 個続く
        const raw: any[] = [];
        for (let i = 0; i < 96; i++) {
            const start = i * 0.25;
            raw.push(sec(i % 2 === 0 ? 'low' : 'mid', start, start + 0.25, i % 2 === 0 ? 0.31 : 0.35));
        }
        const macro = compressToMacroSections(raw);
        expect(macro.length).toBeGreaterThanOrEqual(1);
        expect(macro.length).toBeLessThanOrEqual(12);
        // 区間は連続かつ全期間を覆う
        expect(macro[0].startSec).toBe(0);
        expect(macro[macro.length - 1].endSec).toBeCloseTo(24, 3);
        for (let i = 1; i < macro.length; i++) {
            expect(macro[i].startSec).toBeCloseTo(macro[i - 1].endSec, 3);
        }
    });

    it('静→ピーク→落ち→中強度の明確な構造は区画を保持して要約する', () => {
        const raw = [
            sec('quiet', 0, 8, 0.05),
            sec('high', 8, 16, 0.9),
            sec('quiet', 16, 16.5, 0.05),
            sec('mid', 16.5, 24, 0.6),
        ];
        const macro = compressToMacroSections(raw);
        // 0.5 秒の静寂は吸収され、大きな構造 3 区間になる
        expect(macro.length).toBe(3);
        expect(macro[0].startSec).toBe(0);
        expect(macro[0].endSec).toBe(8);
        expect(macro[1].startSec).toBe(8);
        expect(macro[1].endSec).toBe(16.5);
        expect(macro[2].endSec).toBe(24);
        // 分類はマージ後の平均エネルギーから再計算される
        expect(macro[1].kind).toBe('high');
    });

    it('短すぎる入力でも最低 1 区間を返す', () => {
        expect(compressToMacroSections([sec('mid', 0, 2, 0.5)]).length).toBe(1);
        expect(compressToMacroSections([])).toEqual([]);
    });
});

describe('downsampleEnergyMapBands', () => {
    const bands = Array.from({ length: 10 }, (_, i) => ({
        index: i,
        startSec: i * 0.25,
        endSec: (i + 1) * 0.25,
        energy: 0.5,
        low: 0.25,
        mid: 0.15,
        high: 0.1,
        kind: 'mid' as const,
        beatInBar: (i % 4) * 0.5,
        bar: Math.floor(i / 8) + 1,
    }));

    it('上限以下ならそのまま返し truncated=false', () => {
        const r = downsampleEnergyMapBands(bands, 10);
        expect(r.truncated).toBe(false);
        expect(r.bands).toBe(bands);
        const r2 = downsampleEnergyMapBands(bands, 0);
        expect(r2.truncated).toBe(false);
    });

    it('超過時は等間隔に間引く', () => {
        const r = downsampleEnergyMapBands(bands, 4);
        expect(r.truncated).toBe(true);
        expect(r.bands.length).toBe(4);
        expect(r.bands.map((b) => b.index)).toEqual([0, 3, 6, 9]);
    });
});
