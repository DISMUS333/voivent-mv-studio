//==============================================================================
// MV アニメーション純粋ロジック集。
// - キーフレーム補間（イージング付き）
// - カラオケ式歌詞進行
// - 解析データ（ピッチ/振幅）からの歌詞タイミング自動生成
// UI に依存しないため単体テスト可能。
//==============================================================================
import type {
    KeyframeProperty,
    LyricItem,
    MvKeyframe,
} from './types';

//==============================================================================
// キーフレーム補間
//==============================================================================

/** イージング関数 */
export function applyEasing(p: number, easing?: MvKeyframe['easing']): number {
    const x = Math.max(0, Math.min(1, p));
    switch (easing) {
        case 'easeIn':
            return x * x;
        case 'easeOut':
            return 1 - (1 - x) * (1 - x);
        case 'easeInOut':
            return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
        default:
            return x;
    }
}

/**
 * シーン内相対進行度 progress(0-1) におけるキーフレーム値を補間する。
 * キーフレーム列は t 昇順にソートして使用する。
 * @returns 補間値。キーフレーム未定義時は undefined
 */
export function evaluateKeyframes(
    frames: MvKeyframe[] | undefined,
    progress: number,
): number | undefined {
    if (!frames || frames.length === 0) return undefined;
    if (frames.length === 1) return frames[0].value;

    const sorted = [...frames].sort((a, b) => a.t - b.t);
    const p = Math.max(0, Math.min(1, progress));

    // 先頭より前 / 末尾より後は端の値でクランプ
    if (p <= sorted[0].t) return sorted[0].value;
    if (p >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].value;

    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (p >= a.t && p <= b.t) {
            const span = b.t - a.t;
            const local = span > 0 ? (p - a.t) / span : 0;
            return a.value + (b.value - a.value) * applyEasing(local, a.easing);
        }
        if (p > b.t) continue;
    }
    return sorted[sorted.length - 1].value;
}

/** CSS transform/filter 文字列を生成する */
export function keyframeTransformCss(
    values: Partial<Record<KeyframeProperty, number>>,
): string {
    const parts: string[] = [];
    if (values.scale !== undefined) parts.push(`scale(${values.scale})`);
    if (values.rotateDeg !== undefined) parts.push(`rotate(${values.rotateDeg}deg)`);
    if (values.translateXPct !== undefined) parts.push(`translateX(${values.translateXPct}%)`);
    if (values.translateYPct !== undefined) parts.push(`translateY(${values.translateYPct}%)`);
    const filterParts: string[] = [];
    if (values.blurPx !== undefined && values.blurPx > 0.01) filterParts.push(`blur(${values.blurPx}px)`);
    if (values.brightness !== undefined && values.brightness !== 1) filterParts.push(`brightness(${values.brightness})`);
    return [
        parts.join(' '),
        filterParts.join(' '),
    ].filter(Boolean).join(' ');
}

//==============================================================================
// カラオケ進行
//==============================================================================

/**
 * 歌詞フレーズ内のカラオケ塗りつぶし進行度を計算する。
 * @param timeSec 現在時刻
 * @param lyric 対象歌詞
 * @returns 0〜1 の進行度（フレーズ開始前は 0、終了後は 1）
 */
export function karaokeProgress(timeSec: number, lyric: LyricItem): number {
    const dur = Math.max(0.05, lyric.duration ?? 4.0);
    const elapsed = timeSec - lyric.time;
    if (elapsed <= 0) return 0;
    if (elapsed >= dur) return 1;
    return elapsed / dur;
}

//==============================================================================
// 解析データからの歌詞タイミング自動生成
//==============================================================================

/** 自動生成の入力となる解析データ */
export interface TimingAutoGenInput {
    /** 振幅ピーク配列 [min,max] ペア（Analysis.peaks 相当） */
    peaks: Array<[number, number]>;
    /** peaks の総秒数（解析全体の長さ） */
    durationSec: number;
    /** 分割するフレーズ数 */
    phraseCount: number;
    /** 各フレーズのテキスト（不足時は「フレーズ n」） */
    texts?: string[];
    /** フレーズ間の最小ギャップ秒数 */
    minGapSec?: number;
}

import { getDict } from '../../i18n';

/** 振幅エンベロープから最もエネルギーの高い区間を phraseCount 個選び、歌詞タイミングを生成する */
export function generateLyricTimings(input: TimingAutoGenInput): LyricItem[] {
    const { peaks, durationSec, phraseCount } = input;
    const count = Math.max(1, Math.floor(phraseCount));

    if (!peaks || peaks.length === 0 || durationSec <= 0) {
        // データなし時は等間隔フォールバック
        const step = durationSec > 0 ? durationSec / count : 4;
        return Array.from({ length: count }, (_, i) => ({
            time: Number((i * step).toFixed(2)),
            text: input.texts?.[i] ?? getDict().phraseN(i + 1),
            duration: Number(step.toFixed(2)),
        }));
    }

    // エネルギー配列化
    const energy = peaks.map(([mn, mx]) => Math.max(Math.abs(mn), Math.abs(mx)));

    // 候補区間（各フレーズ長 = 全体/phraseCount を基準にスライド走査）
    const baseLen = Math.max(1, Math.floor(peaks.length / count));
    const candidates: Array<{ startIdx: number; score: number }> = [];
    for (let s = 0; s + baseLen <= energy.length; s++) {
        let sum = 0;
        for (let i = s; i < s + baseLen; i++) sum += energy[i];
        candidates.push({ startIdx: s, score: sum });
    }
    // スコア降順に候補を選び、重なり禁止（minGap 相当のインデックス距離）で確定
    candidates.sort((a, b) => b.score - a.score);
    const chosen: Array<{ startIdx: number; endIdx: number }> = [];
    const minDist = Math.max(1, Math.floor(baseLen * 0.8));
    for (const c of candidates) {
        if (chosen.every((ch) => c.startIdx + baseLen <= ch.startIdx - minDist || c.startIdx >= ch.endIdx + minDist)) {
            chosen.push({ startIdx: c.startIdx, endIdx: c.startIdx + baseLen });
        }
        if (chosen.length >= count) break;
    }
    // 要求フレーズ数に満たない場合は等間隔で補完する
    if (chosen.length < count) {
        const stepIdx = Math.floor(peaks.length / count);
        for (let i = 0; i < count && chosen.length < count; i++) {
            const s = i * stepIdx;
            if (chosen.every((ch) => s + baseLen <= ch.startIdx || s >= ch.endIdx)) {
                chosen.push({ startIdx: s, endIdx: Math.min(peaks.length, s + baseLen) });
            }
        }
        let cursor = 0;
        while (chosen.length < count) {
            chosen.push({ startIdx: cursor, endIdx: Math.min(peaks.length, cursor + baseLen) });
            cursor += baseLen;
        }
    }
    chosen.sort((a, b) => a.startIdx - b.startIdx);

    const secPerPeak = durationSec / peaks.length;
    return chosen.map((c, i) => {
        const time = Number((c.startIdx * secPerPeak).toFixed(2));
        const end = Number((c.endIdx * secPerPeak).toFixed(2));
        return {
            time,
            text: input.texts?.[i] ?? getDict().phraseN(i + 1),
            duration: Number(Math.max(0.5, end - time).toFixed(2)),
        };
    });
}
