//==============================================================================
// MV 用リアルタイムオーディオシグナル生成フック。
// ネイティブの実測 FFT スペクトラム (getTrackSpectrum) をポーリングし、
// low / mid / high / peak を実音声から算出する。未接続時は従来の擬似値へフォールバック。
// 複数トラック選択時は各トラックのスペクトラムを合成（最大値結合）する。
// リップシンク用に getTrackViseme も並列ポーリングし、最大 strength の viseme を採用。
//==============================================================================
import { useEffect, useRef, useState } from 'react';
import { native } from '../../native';
import type { VisemeKind } from '../../native';
import type { AudioSignals } from './types';
import type { LyricItem } from './types';
import { mergeVisemeWithLyrics } from './lyricsToViseme';

interface UseMvAudioSignalsArgs {
    status: {
        isPlaying: boolean;
        isSessionPlaying: boolean;
        playbackPosition: number;
        sessionPosition: number;
        audioInputPeak?: number;
    } | null;
    bpm: number;
    /** 解析対象トラック番号リスト（空 or 未指定時は 0 番） */
    trackIndices?: number[];
    /**
     * 歌詞フレーズ（AI 歌詞自動配置 / LRC 読込結果）。指定すると現在時刻の
     * 文字を 50音 → viseme に変換し、C++ 側フォルマント推定結果より優先する。
     * これにより「喋ってない時に口が動く」「無音区間なのに口パクする」事故を防止。
     */
    lyrics?: LyricItem[];
}

/**
 * MV タイムライン表示位置を決定する純粋関数。
 *
 * - 再生中: エンジンのセッション位置に常に追従（0 を含む。巻き戻し直後のホールド残骸を防ぐ）
 * - 停止中: エンジンが有効な位置を返しているならそれを採用（停止位置での静止画プレビュー /
 *   スクラブ反映）。エンジンが停止時に 0 等を返す場合のみ、最後に再生していた位置へホールドする。
 * - ホールド源はセッション位置のみ。クリップ試聴位置へフォールバックすると
 *   セッション時間軸とズレた位置でシーンが固まる旧バグを踏み替えるため行わない。
 */
export function resolveMvTimelineSec(
    _isPlaying: boolean,
    reportedSessionSec: number,
    lastHeldSec: number,
): number {
    const valid = (v: number): number =>
        typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : NaN;

    const reported = valid(reportedSessionSec);
    if (!Number.isNaN(reported)) {
        return reported;
    }
    const held = valid(lastHeldSec);
    return !Number.isNaN(held) ? held : 0;
}

/** dB 値 (-60..0) を 0..1 へ正規化 */
function dbToNorm(db: number): number {
    if (!Number.isFinite(db)) return 0;
    return Math.max(0, Math.min(1, (db + 60) / 60));
}

/** トラック番号リストを正規化する（重複排除・範囲外除去・空時は [0]） */
export function normalizeTrackIndices(indices: number[] | undefined): number[] {
    if (!indices || indices.length === 0) return [0];
    const uniq = Array.from(new Set(indices.filter((i) => Number.isInteger(i) && i >= 0)));
    return uniq.length > 0 ? uniq : [0];
}

/** 複数トラックのスペクトラムを帯域ごとに最大値結合する */
function mergeSpectra(list: number[][]): number[] {
    if (list.length === 1) return list[0];
    const maxLen = Math.max(...list.map((s) => s.length));
    const out = new Array<number>(maxLen).fill(0);
    for (const spec of list) {
        for (let i = 0; i < spec.length; i++) {
            if (spec[i] > out[i]) out[i] = spec[i];
        }
    }
    return out;
}

/**
 * 複数トラックの viseme スナップショットを統合する。
 * 最も開口量 (visemeStrength) の大きいトラックを「話しているトラック」とみなし、
 * その viseme を採用する。全てが未接続/無音なら "sil" + 0.0 を返す。
 */
function mergeVisemes(
    list: Array<{ viseme: VisemeKind; visemeStrength: number; pitchHz: number; spectrumValid: boolean }>,
): { viseme: VisemeKind; visemeStrength: number; pitchHz: number; spectrumValid: boolean } {
    let best = { viseme: 'sil' as VisemeKind, visemeStrength: 0, pitchHz: 0, spectrumValid: false };
    for (const v of list) {
        if (v.visemeStrength > best.visemeStrength) {
            best = v;
        }
    }
    return best;
}

export function useMvAudioSignals({ status, bpm, trackIndices, lyrics }: UseMvAudioSignalsArgs): AudioSignals {
    const [spectrum, setSpectrum] = useState<number[]>([]);
    const spectrumRef = useRef<number[]>([]);
    /**
     * 最新の viseme スナップショット（統合結果）。MV モードの SVG キャラクターが
     * customScript 内で audio.viseme / audio.visemeStrength として参照する元ネタ。
     */
    const visemeRef = useRef<{ viseme: VisemeKind; visemeStrength: number; pitchHz: number; spectrumValid: boolean }>({
        viseme: 'sil',
        visemeStrength: 0,
        pitchHz: 0,
        spectrumValid: false,
    });
    const rafRef = useRef<number>(0);
    const lastPollRef = useRef<number>(0);
    /** 最後に「再生中」として観測したセッション位置（停止中のホールド用） */
    const lastLiveSessionPosRef = useRef<number>(0);

    // 選択トラックの正規化結果（配列参照安定化のため join 文字列で比較）
    const trackKey = normalizeTrackIndices(trackIndices).join(',');
    const tracksRef = useRef<number[]>(normalizeTrackIndices(trackIndices));
    tracksRef.current = normalizeTrackIndices(trackIndices);

    // 歌詞参照を ref に保持（毎レンダーで lyrics 配列参照を差し替え可能にする）
    const lyricsRef = useRef<LyricItem[] | undefined>(lyrics);
    lyricsRef.current = lyrics;

    // 実測 FFT スペクトラム + viseme の定期ポーリング（約30fps、軽量）
    useEffect(() => {
        let active = true;

        const poll = async () => {
            if (!active) return;
            const now = performance.now();
            if (now - lastPollRef.current >= 33) {
                lastPollRef.current = now;
                try {
                    const targets = tracksRef.current;
                    // スペクトラムと viseme を並列取得（getTrackViseme は軽量 JSON）
                    const [specResults, visResults] = await Promise.all([
                        Promise.all(
                            targets.map(async (idx) => {
                                try {
                                    const arr = await native.getTrackSpectrum(idx);
                                    return Array.isArray(arr) ? arr : [];
                                } catch {
                                    return [];
                                }
                            }),
                        ),
                        Promise.all(
                            targets.map(async (idx) => {
                                try {
                                    const snap = await native.getTrackViseme(idx);
                                    // 型ガード: 不正な応答は "sil" として扱う
                                    if (snap && typeof snap === 'object' && typeof snap.viseme === 'string') {
                                        return snap;
                                    }
                                    return null;
                                } catch {
                                    return null;
                                }
                            }),
                        ),
                    ]);
                    if (!active) return;

                    // スペクトラム統合
                    const valid = specResults.filter((arr) => arr.length > 0);
                    if (valid.length > 0) {
                        const merged = mergeSpectra(valid).map(dbToNorm);
                        spectrumRef.current = merged;
                        setSpectrum(merged);
                    }

                    // viseme 統合（最大 strength 採用）
                    const validVisemes = visResults.filter(
                        (v): v is NonNullable<typeof v> => v != null,
                    );
                    if (validVisemes.length > 0) {
                        visemeRef.current = mergeVisemes(validVisemes);
                    }
                } catch {
                    /* ネイティブ未応答時は無視してフォールバック */
                }
            }
            rafRef.current = requestAnimationFrame(poll);
        };
        rafRef.current = requestAnimationFrame(poll);

        return () => {
            active = false;
            cancelAnimationFrame(rafRef.current);
        };
    }, [trackKey]);

    // セッション再生中はセッション位置へ追従し、停止中は最後の位置で画面を固定する。
    // （旧実装は停止時に 0 へフォールバックしたため、一時停止すると歌詞・シーン・
    //   Phaser 演出がすべて 0 秒地点へ飛んで見えなくなる問題があった。
    //   さらに旧々実装のようなクリップ試聴位置へのフォールバックは行わない）
    const isPlaying = Boolean(status?.isPlaying || status?.isSessionPlaying);
    const reportedSessionSec = status?.sessionPosition ?? NaN;
    const timeSec = resolveMvTimelineSec(isPlaying, reportedSessionSec, lastLiveSessionPosRef.current);
    if (isPlaying) {
        // 再生中の実位置を記憶し、停止中のホールド値として使う
        if (Number.isFinite(reportedSessionSec) && reportedSessionSec >= 0) {
            lastLiveSessionPosRef.current = reportedSessionSec;
        }
    }

    // 実測スペクトラムから帯域エネルギーを算出（48バンド対数分割を想定）
    const spec = spectrumRef.current;
    let low = 0, mid = 0, high = 0, peak = 0;
    if (spec.length >= 8) {
        const n = spec.length;
        const bandAvg = (a: number, b: number) => {
            let s = 0;
            for (let i = a; i < b; i++) s += spec[i];
            return s / Math.max(1, b - a);
        };
        low = bandAvg(0, Math.floor(n * 0.25));
        mid = bandAvg(Math.floor(n * 0.25), Math.floor(n * 0.65));
        high = bandAvg(Math.floor(n * 0.65), n);
        peak = Math.max(...spec);
    }

    // フォールバック：スペクトラム未取得時は従来の近似値を使用
    const fallbackPeak = status?.audioInputPeak && status.audioInputPeak > 0
        ? Math.min(1.0, status.audioInputPeak)
        : (isPlaying ? 0.65 : 0.0);

    // viseme の最終決定:
    //  1. 歌詞フレーズ区間内 → 50音ベース歌詞 viseme（時間精度高・無音誤検知ゼロ）
    //  2. 歌詞外 → C++ 側フォルマント推定結果
    //  3. どちらも sil → 0
    const mergedViseme = mergeVisemeWithLyrics(
        visemeRef.current.viseme,
        visemeRef.current.visemeStrength,
        lyricsRef.current,
        timeSec,
    );

    return {
        peak: spec.length >= 8 ? peak : fallbackPeak,
        low: spec.length >= 8 ? low : Math.min(1.0, fallbackPeak * 1.25),
        mid: spec.length >= 8 ? mid : Math.min(1.0, fallbackPeak * 0.9),
        high: spec.length >= 8 ? high : Math.min(1.0, fallbackPeak * 0.75),
        beat: isPlaying ? ((timeSec * (bpm / 60)) % 1) : 0,
        isPlaying,
        timeSeconds: timeSec,
        bpm,
        spectrum: spec.length > 0 ? spec : undefined,
        // リップシンク用 viseme: 歌詞優先 → C++ 統合結果の順で決定
        viseme: mergedViseme.viseme,
        visemeStrength: mergedViseme.visemeStrength,
    };
}