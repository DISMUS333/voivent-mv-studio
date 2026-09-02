//==============================================================================
// ステム解析エンジン (純粋関数のみ・DOM 依存なし)。
// 分離済み stem PCM から ドラム onset / 拍グリッド / エネルギー包絡 /
// ボーカル発声区間を導出し、StemAnalysis メタデータへ圧縮する。
// すべての関数は決定論的 (同一入力 → 同一出力) で、Vitest から直接検証可能。
//==============================================================================
import type {
    StemAnalysis,
    StemBuffers,
    StemKind,
    StemOnset,
    StemVocalSegment,
} from './types';
import { STEM_KINDS } from './types';

/** 包絡の既定バンド長 (秒)。get_energy_map のバンド解像度と同程度の粒度 */
export const DEFAULT_BAND_SEC = 0.25;
/** onset 重複除去: この秒数以内の密集 onset は最強の 1 つに統合する */
export const ONSET_MERGE_SEC = 0.05;
/** BPM 探索範囲 */
export const BPM_MIN = 60;
export const BPM_MAX = 200;
/** 発声判定の正規化包絡しきい値 */
export const VOCAL_ENV_THRESHOLD = 0.12;

/**
 * モノラル PCM の RMS 包絡を bandSec 刻みで計算する。
 * 戻り値は各バンドの RMS (振幅スケール、正規化は行わない)。
 */
export function computeEnvelope(
    left: Float32Array,
    right: Float32Array,
    sampleRate: number,
    bandSec: number,
): number[] {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || bandSec <= 0) return [];
    const bandLen = Math.max(1, Math.round(sampleRate * bandSec));
    const len = Math.min(left.length, right.length);
    if (len === 0) return [];
    const out: number[] = [];
    for (let start = 0; start < len; start += bandLen) {
        const end = Math.min(len, start + bandLen);
        let sum = 0;
        for (let i = start; i < end; i++) {
            const l = left[i];
            const r = right[i];
            sum += (l * l + r * r) * 0.5;
        }
        out.push(Math.sqrt(sum / Math.max(1, end - start)));
    }
    return out;
}

/**
 * 包絡を全体最大で 0..1 正規化する (無音・極小音源は 0 のまま)。
 */
export function normalizeEnvelope(env: number[]): number[] {
    let max = 0;
    for (const v of env) if (Number.isFinite(v) && v > max) max = v;
    if (max <= 0) return env.map(() => 0);
    return env.map((v) => Math.max(0, Math.min(1, v / max)));
}

/**
 * RMS 包絡からドラム onset を検出する。
 * 隣接バンド差分が「局所平均 + 全体ノイズフロア」しきい値を超えた点を打撃とみなす。
 * 戻り値は { timeSec, strength 0..1 } の時刻昇順列。
 */
export function detectOnsets(env: number[], bandSec: number): StemOnset[] {
    if (env.length < 3 || bandSec <= 0) return [];
    const win = Math.max(2, Math.round(0.5 / bandSec));
    const onsets: StemOnset[] = [];
    let peakEnv = 0;
    for (const v of env) if (v > peakEnv) peakEnv = v;
    if (peakEnv <= 0) return [];

    for (let i = 1; i < env.length - 1; i++) {
        const diff = env[i] - env[i - 1];
        if (diff <= 0) continue;
        // 前後 win バンドの平均 (自身は除く) を局所基準とする
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - win); j < Math.min(env.length, i + win + 1); j++) {
            if (j === i) continue;
            sum += env[j];
            count++;
        }
        const localMean = count > 0 ? sum / count : 0;
        // 打撃判定: 局所平均の 60% 超の立ち上がり + 全体ピーク 8% 超のみ
        if (env[i] < 0.08 * peakEnv) continue;
        if (diff < localMean * 0.6) continue;
        onsets.push({
            timeSec: Number(((i + 0.5) * bandSec).toFixed(4)),
            strength: Math.max(0, Math.min(1, diff / Math.max(1e-9, peakEnv))),
        });
    }

    // 密集 onset の統合 (ONSET_MERGE_SEC 以内は最強を採用)
    const merged: StemOnset[] = [];
    for (const o of onsets) {
        const last = merged[merged.length - 1];
        if (last && o.timeSec - last.timeSec < ONSET_MERGE_SEC) {
            if (o.strength > last.strength) {
                merged[merged.length - 1] = o;
            }
        } else {
            merged.push(o);
        }
    }
    return merged;
}

/**
 * onset 列の間隔ヒストグラムから BPM と拍位相を推定する。
 * - BPM は [BPM_MIN, BPM_MAX] を 0.5 刻みで精査し「整数拍に近い onset 間隔」
 *   のスコアが最大の候補を採用する
 * - 位相は最頻出の拍内位相 (50ms 分解能) を offsetSec とする
 * - confidence は「最頻位相に投票した onset の割合」
 */
export function estimateBeatGrid(
    onsets: StemOnset[],
    durationSec: number,
): { bpm: number; offsetSec: number; confidence: number } {
    if (onsets.length < 4 || !Number.isFinite(durationSec) || durationSec <= 0) {
        return { bpm: 0, offsetSec: 0, confidence: 0 };
    }
    const intervals: number[] = [];
    for (let i = 1; i < onsets.length; i++) {
        const d = onsets[i].timeSec - onsets[i - 1].timeSec;
        if (d > 0.05) intervals.push(d);
    }
    if (intervals.length === 0) {
        return { bpm: 0, offsetSec: 0, confidence: 0 };
    }

    let bestBpm = 0;
    let bestScore = 0;
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 0.5) {
        const beatSec = 60 / bpm;
        let score = 0;
        for (const d of intervals) {
            const beats = d / beatSec;
            const err = Math.abs(beats - Math.round(beats));
            if (err < 0.08) {
                // 整数拍に近い間隔ほど高スコア (長い間隔ほど信頼できる)
                score += (1 - err / 0.08) * Math.min(4, Math.max(1, Math.round(beats)));
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestBpm = bpm;
        }
    }
    if (bestBpm <= 0 || bestScore <= 0) {
        return { bpm: 0, offsetSec: 0, confidence: 0 };
    }

    // 拍位相: 推定 BPM のグリッドに対する onset 残差の最頻位相を採用 (50ms 分解能)
    const beatSec = 60 / bestBpm;
    const phaseVotes = new Map<number, number>();
    for (const o of onsets) {
        const phase = ((o.timeSec % beatSec) + beatSec) % beatSec;
        const key = Math.round(phase * 20) / 20;
        phaseVotes.set(key, (phaseVotes.get(key) ?? 0) + 1);
    }
    let bestPhase = 0;
    let bestVotes = 0;
    for (const [phase, votes] of phaseVotes) {
        if (votes > bestVotes) {
            bestVotes = votes;
            bestPhase = phase;
        }
    }
    const confidence = Math.max(0, Math.min(1, bestVotes / Math.max(1, onsets.length)));
    return {
        bpm: Number(bestBpm.toFixed(1)),
        offsetSec: Number(bestPhase.toFixed(3)),
        confidence,
    };
}

/**
 * ボーカル包絡から発声区間を抽出する。
 * - 正規化包絡がしきい値以上のバンドを「発声中」とみなす
 * - 1 バンド以内の隙間は結合、300ms 未満の区間は除去して実用的な区間列へ整える
 */
export function extractVocalSegments(
    env: number[],
    bandSec: number,
    envThreshold: number = VOCAL_ENV_THRESHOLD,
): StemVocalSegment[] {
    if (env.length === 0 || bandSec <= 0) return [];
    const MIN_SEG_BANDS = Math.max(1, Math.round(0.3 / bandSec));
    const GAP_MERGE_BANDS = Math.max(1, Math.round(0.2 / bandSec));

    const raw: Array<{ start: number; end: number }> = [];
    let cur: { start: number; end: number } | null = null;
    for (let i = 0; i < env.length; i++) {
        const active = env[i] >= envThreshold;
        if (active && !cur) {
            cur = { start: i, end: i };
        } else if (active && cur) {
            cur.end = i;
        } else if (!active && cur) {
            raw.push(cur);
            cur = null;
        }
    }
    if (cur) raw.push(cur);

    const joined: Array<{ start: number; end: number }> = [];
    for (const seg of raw) {
        const last = joined[joined.length - 1];
        if (last && seg.start - last.end <= GAP_MERGE_BANDS) {
            last.end = seg.end;
        } else {
            joined.push({ ...seg });
        }
    }

    return joined
        .filter((s) => s.end - s.start + 1 >= MIN_SEG_BANDS)
        .map((s) => {
            let sum = 0;
            for (let i = s.start; i <= s.end; i++) sum += env[i];
            return {
                startSec: Number((s.start * bandSec).toFixed(3)),
                endSec: Number(((s.end + 1) * bandSec).toFixed(3)),
                meanEnergy: Number((sum / (s.end - s.start + 1)).toFixed(3)),
            };
        });
}

/** 時刻 t を含む / 直前の包絡インデックス (範囲外はクランプ、無効時は -1) */
function envIndexAt(envLen: number, bandSec: number, t: number): number {
    if (envLen === 0 || bandSec <= 0) return -1;
    return Math.max(0, Math.min(envLen - 1, Math.floor(t / bandSec)));
}

/** 包絡の線形補間値 (バンド中心時刻をノードとする) */
function envValueAt(env: number[], bandSec: number, t: number): number {
    if (env.length === 0 || bandSec <= 0 || !Number.isFinite(t) || t < 0) return 0;
    const pos = t / bandSec - 0.5;
    const i0 = Math.floor(pos);
    if (i0 < 0) return env[0];
    if (i0 >= env.length - 1) return env[env.length - 1];
    const frac = pos - i0;
    return env[i0] * (1 - frac) + env[i0 + 1] * frac;
}

/**
 * StemAnalysis 全体を構築する (純粋関数)。
 * drums → onset / 拍グリッド、各 stem → 正規化包絡、vocals → 発声区間。
 */
export function buildStemAnalysis(
    stems: Record<StemKind, StemBuffers>,
    sampleRate: number,
    durationSec: number,
    bandSec: number = DEFAULT_BAND_SEC,
): StemAnalysis {
    const safeBand = Number.isFinite(bandSec) && bandSec > 0 ? bandSec : DEFAULT_BAND_SEC;
    const energy = {} as Record<StemKind, number[]>;
    for (const kind of STEM_KINDS) {
        const buf = stems[kind];
        energy[kind] = buf
            ? normalizeEnvelope(computeEnvelope(buf.left, buf.right, sampleRate, safeBand))
            : [];
    }
    const onsets = detectOnsets(energy.drums, safeBand);
    const grid = estimateBeatGrid(onsets, durationSec);
    return {
        version: 1,
        sampleRate,
        durationSec: Number.isFinite(durationSec) ? durationSec : 0,
        proposedBpm: grid.bpm,
        beatConfidence: Number(grid.confidence.toFixed(3)),
        beatOffsetSec: grid.offsetSec,
        drumOnsets: onsets,
        energy,
        bandSec: safeBand,
        vocalSegments: extractVocalSegments(energy.vocals, safeBand),
    };
}

//==============================================================================
// 時刻参照 (プレビュー / 書き出し / AI で共有する決定論的純関数)
//==============================================================================

/** ドラム onset パルスの減衰率 */
const DRUM_PULSE_DECAY = 9;

/**
 * 指定時刻の stem 強化シグナルを StemAnalysis から決定論的に合成する。
 * プレビュー / 停止中シーク / オフライン書き出し / WebMCP の全経路で
 * この関数 1 つを共有し、描画の完全一致を保証する。
 */
export function stemSignalsAtTime(analysis: StemAnalysis | null | undefined, t: number) {
    const empty = { drumPulse: 0, timeSinceDrumOnset: 0, vocalEnergy: 0, vocalActive: false, bassEnergy: 0 };
    if (!analysis || !Number.isFinite(t) || t < 0) return empty;

    // 直近 onset を二分探索
    const onsets = analysis.drumOnsets;
    let lo = 0;
    let hi = onsets.length - 1;
    let lastIdx = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (onsets[mid].timeSec <= t) {
            lastIdx = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    let drumPulse = 0;
    let timeSince = t;
    if (lastIdx >= 0) {
        const onset = onsets[lastIdx];
        timeSince = t - onset.timeSec;
        drumPulse = Math.max(0, Math.min(1, onset.strength * Math.exp(-timeSince * DRUM_PULSE_DECAY)));
    }

    const vocalEnergy = Math.max(0, Math.min(1, envValueAt(analysis.energy.vocals, analysis.bandSec, t)));
    const bassEnergy = Math.max(0, Math.min(1, envValueAt(analysis.energy.bass, analysis.bandSec, t)));
    const vi = envIndexAt(analysis.energy.vocals.length, analysis.bandSec, t);
    const vocalActive = vi >= 0 && analysis.energy.vocals[vi] >= VOCAL_ENV_THRESHOLD;

    return {
        drumPulse,
        timeSinceDrumOnset: Number(timeSince.toFixed(4)),
        vocalEnergy,
        vocalActive,
        bassEnergy,
    };
}