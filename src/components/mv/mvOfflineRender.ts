//==============================================================================
// MV オフライン描画エンジンの純粋関数群。
// リアルタイム再生に同期せず、指定時刻のオーディオシグナルを解析データから
// 再構築することで、フレームごとに決定的な高品質描画を実現する。
// リップシンク用 viseme は波形振幅から簡易推定する
// （C++ 側フォルマント推定と完全一致はしないが、GIF 出力の視覚的整合性は確保）。
//==============================================================================
import type { AudioSignals, VisemeKind } from './types';
import type { LyricItem } from './types';
import type { StemAnalysis } from './stemAnalysis/types';
import { withStemSignals } from './stemAnalysis/stemSignals';
import { lyricsVisemeAtTime } from './lyricsToViseme';

/** 解析データから参照する最小インターフェース（循環依存回避） */
export interface OfflineAnalysisSource {
    /** 波形ピーク対 [min, max] */
    peaks?: Array<[number, number]>;
    /** 解析全体の長さ（秒） */
    duration?: number;
}

/**
 * 指定時刻の波形振幅（0〜1）を解析ピーク配列から取得する。
 * - ピーク未取得・長さ不正時は 0 を返す
 * - 時刻が範囲外の場合はクランプする
 */
export function amplitudeAtTime(
    peaks: Array<[number, number]> | undefined,
    durationSec: number,
    t: number,
): number {
    if (!peaks || peaks.length === 0 || !Number.isFinite(durationSec) || durationSec <= 0) return 0;
    if (!Number.isFinite(t)) return 0;
    const clamped = Math.max(0, Math.min(durationSec, t));
    const idx = Math.floor((clamped / durationSec) * peaks.length);
    const pair = peaks[Math.max(0, Math.min(peaks.length - 1, idx))];
    if (!pair) return 0;
    return Math.max(Math.abs(pair[0]), Math.abs(pair[1]));
}

/**
 * BPM に同期した拍パルス（0〜1）を生成する。
 * 各拍の瞬間に 1.0 となり指数関数的に減衰する。
 */
export function beatPulseAtTime(bpm: number, t: number, decayRate = 6): number {
    if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(t) || t < 0) return 0;
    const beatPeriod = 60 / bpm;
    const phase = (t % beatPeriod) / beatPeriod;
    return Math.exp(-phase * decayRate);
}

/**
 * オフライン描画用のリップシンク viseme を簡易推定する。
 *
 * オフラインレンダラーは C++ フォルマント推定を参照できないため、波形振幅と
 * 時間位相から「有声/無声」と擬似母音を決定論的に生成する。GIF 出力時の
 * 視覚的な口パク再現が目的なので、厳密な母音分類は不要。
 *
 * ルール:
 *  - amp < 0.04  → "sil" (無音)
 *  - 位相 t * 4.7 (Hz) を 5 分割して a/i/u/e/o を巡回
 *  - amp に比例した strength を返す
 */
export function offlineVisemeAtTime(t: number, amp: number): { viseme: VisemeKind; visemeStrength: number } {
    if (!Number.isFinite(t) || !Number.isFinite(amp) || amp < 0.04) {
        return { viseme: 'sil', visemeStrength: 0 };
    }
    const seq: VisemeKind[] = ['a', 'i', 'u', 'e', 'o'];
    const periodSec = 0.32; // 1 母音あたりの滞在時間
    const idx = Math.floor(t / periodSec) % seq.length;
    const viseme = seq[idx] as VisemeKind;
    // 振幅が 0..1 でstrength は 0.25..1.0 にクランプ
    const strength = Math.max(0.25, Math.min(1.0, amp));
    return { viseme, visemeStrength: strength };
}

/**
 * オフライン描画用のリップシンク viseme を、歌詞データ込みで解決する。
 *
 * 優先順位 (lyricsToViseme と同じ厳格ポリシー):
 *  1. 歌詞が完全に無い → 振幅ベース擬似 viseme（後方互換）
 *  2. 歌詞があり、区間内 → 50音ベースの歌詞 viseme
 *  3. 歌詞があり、区間外 → 完全 sil（口を動かすな）
 */
export function offlineVisemeAtTimeWithLyrics(
    t: number,
    amp: number,
    lyrics: LyricItem[] | undefined,
): { viseme: VisemeKind; visemeStrength: number } {
    const hasAnyLyrics = Array.isArray(lyrics) && lyrics.length > 0
        && lyrics.some(l => (l.text ?? '').trim().length > 0);
    if (!hasAnyLyrics) {
        return offlineVisemeAtTime(t, amp);
    }
    const fromLyrics = lyricsVisemeAtTime(lyrics, t);
    if (fromLyrics) {
        return { viseme: fromLyrics.viseme, visemeStrength: fromLyrics.visemeStrength };
    }
    // 歌詞区間外 → 完全 sil
    return { viseme: 'sil', visemeStrength: 0 };
}

/**
 * オフライン描画用のオーディオシグナルを構築する。
 * リアルタイム入力の代わりに解析データ＋BPM から決定的に再現する。
 * リップシンク用 viseme は offlineVisemeAtTimeWithLyrics で歌詞優先生成。
 */
export function buildOfflineSignals(
    bpm: number,
    analysis: OfflineAnalysisSource | null | undefined,
    t: number,
    lyrics?: LyricItem[],
    /** stem 分離解析結果 (未分離時は null)。指定時のみ実測シグナルへ強化 */
    stemAnalysis?: StemAnalysis | null,
    /** stem 強化モード (既定 true。分離済みプロジェクトでのみ意味を持つ) */
    stemMode: boolean = true,
): AudioSignals {
    const amp = amplitudeAtTime(analysis?.peaks, analysis?.duration ?? 0, t);
    const beat = beatPulseAtTime(bpm, t);
    const { viseme, visemeStrength } = offlineVisemeAtTimeWithLyrics(t, amp, lyrics);
    const base: AudioSignals = {
        peak: amp,
        low: Math.min(1, amp * 1.1),
        mid: Math.min(1, amp * 0.8),
        high: Math.min(1, amp * 0.55),
        beat,
        isPlaying: true,
        timeSeconds: t,
        bpm,
        viseme,
        visemeStrength,
    };
    // 分離未実施時は base をそのまま返す (既存描画の完全な後方互換)
    return withStemSignals(base, stemAnalysis ?? null, stemMode);
}