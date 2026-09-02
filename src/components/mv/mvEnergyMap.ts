//==============================================================================
// 楽曲エネルギーマップ生成エンジン（純粋関数）。
// 解析ピーク（振幅）と BPM から拍より細かい解像度で楽曲を分割し、
// 楽曲構造（イントロ / 盛り上がり / ピーク / ドロップ / 静寂区間）を導出する。
// WebMCP ツール get_energy_map 経由で AI エージェントに公開され、
// シーン割り当てや自動演出タイミングのデータ駆動判断に使われる。
//==============================================================================
import type { OfflineAnalysisSource } from './mvOfflineRender';
import { amplitudeAtTime, beatPulseAtTime } from './mvOfflineRender';

/** バンド 1 個あたりのエネルギー分類 */
export type EnergyBandKind = 'quiet' | 'low' | 'mid' | 'high';

export interface EnergyMapBand {
    /** バンドインデックス（0 始まり） */
    index: number;
    /** 開始時刻（秒） */
    startSec: number;
    /** 終了時刻（秒） */
    endSec: number;
    /** 平均振幅 0..1（楽曲全体のエネルギー） */
    energy: number;
    /** 帯域別推定値（low + mid + high = energy）。拍位相から推定した参考値 */
    low: number;
    mid: number;
    high: number;
    /** エネルギー分類 */
    kind: EnergyBandKind;
    /** バンド中心の小節内拍位置（0..4、4/4 拍子想定） */
    beatInBar: number;
    /** 小節番号（1 始まり） */
    bar: number;
}

export interface EnergyMapSection {
    kind: EnergyBandKind;
    startSec: number;
    endSec: number;
    avgEnergy: number;
}

export interface EnergyMapSummary {
    avgEnergy: number;
    /** エネルギー最大バンドの開始時刻（サビ等のピーク） */
    peakStartSec: number;
    peakEnergy: number;
    /** 最長静寂区間（存在しない場合は null） */
    longestQuietStartSec: number | null;
    longestQuietEndSec: number | null;
    /** イントロ（quiet/low 冒頭セクション）の終了時刻 */
    introEndSec: number | null;
    /** 高エネルギーからの急激な落ち（ドロップ）開始時刻 */
    dropStartSec: number | null;
    /** 生セクション（0.25 秒級の細かいランレングス圧縮） */
    sections: EnergyMapSection[];
    /** 楽曲構造レベルのマクロ区間 (3〜12 区間に圧縮)。シーン割り当てはこちらを基準に使う */
    macroSections: EnergyMapSection[];
}

export interface EnergyMapResult {
    bpm: number;
    beatSec: number;
    bandSec: number;
    bandsPerBeat: number;
    durationSec: number;
    bands: EnergyMapBand[];
    summary: EnergyMapSummary;
}

export interface EnergyMapOptions {
    /** 1 拍あたりのバンド数（1=4分音符, 2=8分音符[既定], 4=16分音符） */
    bandsPerBeat?: number;
    /** 楽曲長（秒）。解析データに duration がない場合のフォールバック */
    durationSec?: number;
}

/** エネルギー分類しきい値（0..1 正規化振幅） */
const QUIET_THRESHOLD = 0.08;
const LOW_THRESHOLD = 0.35;
const HIGH_THRESHOLD = 0.7;
/** バンド総数のハード上限（極端に長い楽曲・高分解能でのメモリ爆発防止） */
const MAX_BANDS = 4096;
/** ドロップ検出: 直前バンドがこのエネルギー以上のときのみ判定（誤検出防止） */
const DROP_MIN_PREV_ENERGY = 0.4;
/** ドロップ検出: 直前バンドのこの倍率以下に急落したらドロップとみなす */
const DROP_RATIO = 0.4;

/**
 * 振幅 0..1 をエネルギー分類へ変換する。
 */
export function classifyEnergy(energy: number): EnergyBandKind {
    if (!Number.isFinite(energy) || energy < QUIET_THRESHOLD) return 'quiet';
    if (energy < LOW_THRESHOLD) return 'low';
    if (energy < HIGH_THRESHOLD) return 'mid';
    return 'high';
}

/**
 * 楽曲のエネルギーマップを構築する。
 *
 * - 解析ピーク配列を bandsPerBeat 分割（BPM 同期）の時間バンドに分割
 * - 各バンドの平均振幅をエネルギーとし、静寂/低/中/高に分類
 * - low/mid/high 帯域比は拍位相（キック=low 強調）から決定論的に推定した参考値
 * - 連続する同分類バンドをセクションへ圧縮し、ピーク/ドロップ/イントロ長を導出
 */
export function buildEnergyMap(
    bpm: number,
    analysis: OfflineAnalysisSource | null | undefined,
    options: EnergyMapOptions = {},
): EnergyMapResult {
    const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
    const bandsPerBeat = Math.max(1, Math.min(8, Math.round(Number(options.bandsPerBeat) || 2)));
    const beatSec = 60 / safeBpm;
    const bandSec = beatSec / bandsPerBeat;

    const srcDuration = Number.isFinite(analysis?.duration) ? Number(analysis?.duration) : 0;
    const fallbackDuration = Number.isFinite(options.durationSec) ? Number(options.durationSec) : 0;
    const durationSec = Math.max(0, srcDuration > 0 ? srcDuration : fallbackDuration);
    const peaks = analysis?.peaks;

    const emptySummary: EnergyMapSummary = {
        avgEnergy: 0,
        peakStartSec: 0,
        peakEnergy: 0,
        longestQuietStartSec: null,
        longestQuietEndSec: null,
        introEndSec: null,
        dropStartSec: null,
        sections: [],
        macroSections: [],
    };
    if (durationSec <= 0 || bandSec <= 0 || !peaks || peaks.length === 0) {
        return { bpm: safeBpm, beatSec, bandSec, bandsPerBeat, durationSec: 0, bands: [], summary: emptySummary };
    }

    const bandCount = Math.max(1, Math.min(MAX_BANDS, Math.ceil(durationSec / bandSec)));
    const bands: EnergyMapBand[] = [];
    for (let i = 0; i < bandCount; i++) {
        const startSec = i * bandSec;
        const endSec = Math.min(durationSec, startSec + bandSec);
        const center = startSec + (endSec - startSec) / 2;
        const raw = amplitudeAtTime(peaks, durationSec, center);
        const energy = Math.max(0, Math.min(1, raw));
        // 帯域別推定: 拍の瞬間（pulse=1）はキック等の低域が支配し、
        // 拍と拍の間（pulse=0）は中高域が相対的に伸びるという位相ヒューリスティック。
        const pulse = beatPulseAtTime(safeBpm, center);
        const lowRatio = 0.3 + 0.5 * pulse;
        const midRatio = 0.4 - 0.3 * pulse;
        const highRatio = 1 - lowRatio - midRatio;
        const beatFloat = center / beatSec;
        bands.push({
            index: i,
            startSec,
            endSec,
            energy,
            low: energy * lowRatio,
            mid: energy * midRatio,
            high: energy * highRatio,
            kind: classifyEnergy(energy),
            beatInBar: Number((beatFloat % 4).toFixed(3)),
            bar: Math.floor(beatFloat / 4) + 1,
        });
    }

    // ── セクション圧縮（同分類連続バンドのランレングス） ──────────────────────
    const sections: EnergyMapSection[] = [];
    let acc: { kind: EnergyBandKind; startSec: number; endSec: number; sum: number; count: number } | null = null;
    const flushAcc = () => {
        if (acc) {
            sections.push({
                kind: acc.kind,
                startSec: acc.startSec,
                endSec: acc.endSec,
                avgEnergy: acc.count > 0 ? acc.sum / acc.count : 0,
            });
        }
    };
    for (const b of bands) {
        if (acc && acc.kind === b.kind) {
            acc.endSec = b.endSec;
            acc.sum += b.energy;
            acc.count += 1;
        } else {
            flushAcc();
            acc = { kind: b.kind, startSec: b.startSec, endSec: b.endSec, sum: b.energy, count: 1 };
        }
    }
    flushAcc();

    // ── サマリ指標の導出 ─────────────────────────────────────────────────────
    let sumEnergy = 0;
    let peakBand: EnergyMapBand | null = null;
    let dropStartSec: number | null = null;
    for (const b of bands) {
        sumEnergy += b.energy;
        if (!peakBand || b.energy > peakBand.energy) peakBand = b;
        if (dropStartSec === null) {
            const prev = b.index > 0 ? bands[b.index - 1] : null;
            if (prev && prev.energy >= DROP_MIN_PREV_ENERGY && b.energy <= prev.energy * DROP_RATIO) {
                dropStartSec = b.startSec;
            }
        }
    }

    let longestQuiet: EnergyMapSection | null = null;
    for (const sec of sections) {
        if (sec.kind !== 'quiet') continue;
        if (!longestQuiet || sec.endSec - sec.startSec > longestQuiet.endSec - longestQuiet.startSec) {
            longestQuiet = sec;
        }
    }

    const firstSection = sections[0] ?? null;
    const introEndSec = firstSection && (firstSection.kind === 'quiet' || firstSection.kind === 'low')
        ? firstSection.endSec
        : null;

    // ── マクロ楽曲構造 (シーン割り当て用の 3〜12 区間) ────────────────────────
    const macroSections = compressToMacroSections(sections);

    return {
        bpm: safeBpm,
        beatSec,
        bandSec,
        bandsPerBeat,
        durationSec,
        bands,
        summary: {
            avgEnergy: bands.length > 0 ? sumEnergy / bands.length : 0,
            peakStartSec: peakBand ? peakBand.startSec : 0,
            peakEnergy: peakBand ? peakBand.energy : 0,
            longestQuietStartSec: longestQuiet ? longestQuiet.startSec : null,
            longestQuietEndSec: longestQuiet ? longestQuiet.endSec : null,
            introEndSec,
            dropStartSec,
            sections,
            macroSections,
        },
    };
}

/**
 * 生セクション列をマクロ楽曲構造へ圧縮する。
 *
 * 0.25 秒級のランレングス圧縮だけでは、エネルギー変動が激しい楽曲で
 * 1 拍ごとにセクションが分断され、AI がシーン割り当てに使えない。
 * 本関数は短いセクションを周囲へ吸収マージし、最終的に
 * minimumSections 〜 maximumSections の楽曲構造レベルの区間へ整える。
 *
 * アルゴリズム:
 *  1. minSec 未満の短セクションを、隣接する最長セクションへ吸収マージ
 *  2. maximumSections を超える間、平均エネルギー差が最小の隣接ペアを反復マージ
 *  3. 残りが minimumSections 未満の間、平均エネルギー差が最小の隣接ペアをマージ
 *  4. 分類は混在後の平均エネルギーから再計算 (分類名の整合を保証)
 */
export function compressToMacroSections(
    sections: EnergyMapSection[],
    options: { minSec?: number; minimumSections?: number; maximumSections?: number } = {},
): EnergyMapSection[] {
    const minSec = options.minSec ?? 4;
    const minimumSections = Math.max(1, Math.min(options.minimumSections ?? 3, 12));
    const maximumSections = Math.max(minimumSections, Math.min(options.maximumSections ?? 12, 24));

    const reclassify = (s: EnergyMapSection): EnergyMapSection => ({
        ...s,
        kind: classifyEnergy(s.avgEnergy),
    });
    const mergeAt = (list: EnergyMapSection[], i: number): EnergyMapSection[] => {
        const a = list[i];
        const b = list[i + 1];
        const merged: EnergyMapSection = {
            kind: a.kind,
            startSec: a.startSec,
            endSec: b.endSec,
            avgEnergy: (a.avgEnergy * (a.endSec - a.startSec) + b.avgEnergy * (b.endSec - b.startSec)) / (b.endSec - a.startSec),
        };
        return [...list.slice(0, i), merged, ...list.slice(i + 2)];
    };

    let list = sections.filter((s) => s.endSec - s.startSec > 0.001).map((s) => ({ ...s }));
    if (list.length === 0) return [];
    /** 全長に対する末尾マイクロ区間の許容比率 (全長 24s なら 0.96s まで吸収) */
    const MICRO_TAIL_RATIO = 0.04;

    // 1a. マイクロ破片の吸収: 1 秒未満の破片は拍的なノイズなので常時吸収する
    // (ガードは最低 1 区間のみ)
    const MICRO_SEC = 1;
    for (let i = 0; i < list.length && list.length > 1; ) {
        const dur = list[i].endSec - list[i].startSec;
        if (dur >= MICRO_SEC) { i++; continue; }
        const prevLen = i > 0 ? list[i - 1].endSec - list[i - 1].startSec : -1;
        const nextLen = i + 1 < list.length ? list[i + 1].endSec - list[i + 1].startSec : -1;
        if (prevLen < 0 && nextLen < 0) break;
        const mergeIdx = nextLen >= prevLen ? i : i - 1;
        list = mergeAt(list, mergeIdx);
    }

    // 1b. 短期区間の吸収: 1〜minSec 秒の区間は楽曲構造になり得るため、
    // minimumSections を維持する範囲でのみ吸収する
    for (let i = 0; i < list.length && list.length > minimumSections; ) {
        const dur = list[i].endSec - list[i].startSec;
        if (dur >= minSec) { i++; continue; }
        const prevLen = i > 0 ? list[i - 1].endSec - list[i - 1].startSec : -1;
        const nextLen = i + 1 < list.length ? list[i + 1].endSec - list[i + 1].startSec : -1;
        if (prevLen < 0 && nextLen < 0) break;
        const mergeIdx = nextLen >= prevLen ? i : i - 1;
        list = mergeAt(list, mergeIdx);
    }

    // 1c. 末尾マイクロ区間の吸収: 全長の 4% 未満しかない末尾区間は最後の本体区間へ統合
    const totalSpan = list[list.length - 1].endSec - list[0].startSec;
    while (list.length > 1) {
        const last = list[list.length - 1];
        if (last.endSec - last.startSec >= totalSpan * MICRO_TAIL_RATIO) break;
        list = mergeAt(list, list.length - 2);
    }

    // 2. 上限超過の解消: 最も均質な隣接ペアからマージ
    while (list.length > maximumSections) {
        let best = -1;
        let bestDiff = Number.POSITIVE_INFINITY;
        for (let i = 0; i + 1 < list.length; i++) {
            const diff = Math.abs(list[i].avgEnergy - list[i + 1].avgEnergy);
            if (diff < bestDiff) { bestDiff = diff; best = i; }
        }
        if (best < 0) break;
        list = mergeAt(list, best);
    }

    // 3. 最小区間数の調整: 最も均質な隣接ペアからマージ
    while (list.length > minimumSections) {
        let best = -1;
        let bestDiff = Number.POSITIVE_INFINITY;
        for (let i = 0; i + 1 < list.length; i++) {
            const diff = Math.abs(list[i].avgEnergy - list[i + 1].avgEnergy);
            if (diff < bestDiff) { bestDiff = diff; best = i; }
        }
        if (best < 0) break;
        list = mergeAt(list, best);
    }

    // 4. 分類名をマージ後の平均エネルギーから再計算
    return list.map(reclassify);
}

/**
 * バンド配列を等間隔間引きして返却サイズへ収める。
 * AI エージェントへの応答サイズ制限用（truncated=true の場合は間引き済み）。
 */
export function downsampleEnergyMapBands(
    bands: EnergyMapBand[],
    maxBands: number,
): { bands: EnergyMapBand[]; truncated: boolean } {
    if (!Number.isFinite(maxBands) || maxBands <= 0 || bands.length <= maxBands) {
        return { bands, truncated: false };
    }
    const stride = Math.ceil(bands.length / maxBands);
    const out = bands.filter((_, i) => i % stride === 0);
    return { bands: out, truncated: true };
}
