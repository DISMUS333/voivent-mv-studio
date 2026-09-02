//==============================================================================
// BPM 自動検出（Web 版）。
// 解析ピーク波形からオンセット間隔の自己相関を取り、40〜240 BPM の範囲で
// 最も整合するテンポを推定する。完璧なビートトラッキングではなく、
// 「get_energy_map のバンド分割が曲に近い粒度になる」ための初期値供給が目的。
//
// 使い方:
//   const bpm = detectBpmFromPeaks(peaks, durationSec);
//   - 曲が静寂主体・極端に単調な場合は null を返す（UI は既定 120 のまま）
//   - UI は検出値を初期表示し、ユーザーは手動補正できる
//==============================================================================

/** 解析ピーク波形 (mvOfflineRender の OfflineAnalysisSource.peaks と同形式) */
export type BpmAnalysisSource = {
    peaks?: Array<[number, number]>;
    duration?: number;
};

/** 推定テンポの下限 / 上限 (BPM) */
const BPM_MIN = 40;
const BPM_MAX = 240;
/** サンプルレート換算後の解析窓 (秒)。冒頭だけでなく全体を対象にする */
const MIN_PEAKS = 32;
/** 自己相関のラグ範囲 (秒) → BPM 40..240 に相当 */
const MIN_LAG_SEC = 60 / BPM_MAX;   // 0.25
const MAX_LAG_SEC = 60 / BPM_MIN;   // 1.5

/**
 * オンセット包絡を構築する: 各ピークサンプルの振幅強度系列を返す。
 */
function buildOnsetEnvelope(peaks: Array<[number, number]>, samplesPerSec: number): Float32Array {
    const env = new Float32Array(peaks.length);
    for (let i = 0; i < peaks.length; i++) {
        const [neg, pos] = peaks[i];
        const amp = Math.max(Math.abs(neg), Math.abs(pos));
        // 振幅の急変 (差分) をオンセット強度とする (L1 近似)
        const prev = i > 0 ? Math.max(Math.abs(peaks[i - 1][0]), Math.abs(peaks[i - 1][1])) : 0;
        env[i] = Math.max(0, amp - prev * 0.85);
    }
    // サンプルレートが低い (≈20Hz) 場合の滑らかさのため 1 サンプル分の移動平均
    const out = new Float32Array(peaks.length);
    for (let i = 0; i < peaks.length; i++) {
        const a = env[Math.max(0, i - 1)];
        const b = env[i];
        const c = env[Math.min(peaks.length - 1, i + 1)];
        out[i] = (a + b + c) / 3;
    }
    void samplesPerSec;
    return out;
}

/**
 * 楽曲の BPM を推定する。
 * @returns 推定 BPM (丸めた整数)。判断材料が不足している場合は null
 */
export function detectBpmFromPeaks(
    analysis: BpmAnalysisSource | null | undefined,
): number | null {
    try {
        const peaks = analysis?.peaks;
        const duration = Number(analysis?.duration);
        if (!peaks || peaks.length < MIN_PEAKS || !Number.isFinite(duration) || duration <= 0) return null;

        const samplesPerSec = peaks.length / duration;
        const env = buildOnsetEnvelope(peaks, samplesPerSec);

        // 包絡の総エネルギーが極端に小さい (無音主体) 曲は判断しない
        let sum = 0;
        for (let i = 0; i < env.length; i++) sum += env[i];
        const mean = sum / env.length;
        if (mean < 1e-4) return null;

        const minLag = Math.max(1, Math.round(MIN_LAG_SEC * samplesPerSec));
        const maxLag = Math.min(env.length - 1, Math.round(MAX_LAG_SEC * samplesPerSec));

        // 自己相関: 各ラグで「オンセットが周期的に繰り返す度合い」を測る
        const scores = new Float64Array(maxLag + 1);
        for (let lag = minLag; lag <= maxLag; lag++) {
            let acc = 0;
            for (let i = 0; i + lag < env.length; i++) {
                acc += env[i] * env[i + lag];
            }
            // ラグが大きいほど積和サンプル数が減るため、平均化して公平化
            scores[lag] = acc / (env.length - lag);
        }
        // 最良ラグを探す (近傍 2 サンプルの平均で補間評価し、粗いサンプルレートでも
        // 倍音ラグ (例: 0.5s vs 0.75s) を誤らないようにする)
        let bestLag = -1;
        let bestScore = 0;
        for (let lag = minLag; lag <= maxLag; lag++) {
            const neighbor = ((scores[lag - 1] ?? 0) + scores[lag] + (scores[lag + 1] ?? 0)) / 3;
            if (neighbor > bestScore) { bestScore = neighbor; bestLag = lag; }
        }
        if (bestLag < 0 || scores[bestLag] <= mean * mean * 1.2) return null; // 周期性が弱い

        let bpm = 60 / (bestLag / samplesPerSec);
        // 極端な値は 2 倍 / 1/2 倍の折り畳みで 70..180 の歌いやすい帯域へ寄せる
        while (bpm < 70) bpm *= 2;
        while (bpm > 180) bpm /= 2;
        const rounded = Math.round(bpm);
        if (!Number.isFinite(rounded) || rounded < BPM_MIN || rounded > BPM_MAX) return null;
        return rounded;
    } catch {
        return null;
    }
}