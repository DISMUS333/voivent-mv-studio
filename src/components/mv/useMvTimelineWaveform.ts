//==============================================================================
// MV シーンタイムライン AUDIO レーン用のセッションミックスダウン波形フック。
// デスクトップ版ではボイス/クリップ単位の解析データはフルミックス波形に
// ならない (MIDI 中心プロジェクトでは無音ピークになる) ため、
// renderSessionAudioForMV (ミックスダウン WAV Base64) を解析して
// Web 版 (initialAudioBuffer) と同等の「楽曲全体」の波形を生成する。
// クリップ編集や BPM 変更をデバウンス検知して再計算する。
//==============================================================================
import { useEffect, useRef, useState } from 'react';
import type { Analysis } from '../../types';
import { native } from '../../native';
import { computeTimelinePeaksFromWav } from './mvTimelinePeaks';

/** 再計算デバウンス (ms)。ドラッグ中の連続再解析を抑える */
const RECALC_DEBOUNCE_MS = 900;
/** タイムライン長の監視分解能 (秒)。微小変化で再計算しない */
const DURATION_QUANTUM_SEC = 0.5;
/** 生成するピーク数 (computeAnalysisPeaks の既定と同一) */
const PEAK_BINS = 1024;

/**
 * セッション全体のミックスダウンからタイムライン波形 Analysis を生成する。
 * @param enabled 無効時は何もせず null を返す (Web 版で AudioBuffer を直接持つ場合など)
 * @param timelineDurationSec タイムライン表示長 (秒)。FX テール分のピークを切り捨てるために使用
 * @param sessionSignature セッション構成シグネチャ (クリップ構成や BPM の変化検知用)
 */
export function useMvTimelineWaveform(
    enabled: boolean,
    timelineDurationSec: number,
    sessionSignature: string,
): Analysis | null {
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const requestSeqRef = useRef(0);
    // 長さは量子化して依存に使う (0.1s 単位の再計算発火を防止)
    const durationKey = Math.max(0, Math.round(timelineDurationSec / DURATION_QUANTUM_SEC));

    useEffect(() => {
        if (!enabled) {
            setAnalysis(null);
            return;
        }
        let cancelled = false;
        const seq = ++requestSeqRef.current;
        const timer = window.setTimeout(() => {
            void (async () => {
                try {
                    const b64 = await native.renderSessionAudioForMV(0, -1);
                    if (cancelled || seq !== requestSeqRef.current)
                        return;
                    if (!b64 || typeof b64 !== 'string') {
                        setAnalysis(null);
                        return;
                    }
                    const binary = atob(b64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++)
                        bytes[i] = binary.charCodeAt(i);
                    const peaks = computeTimelinePeaksFromWav(bytes, timelineDurationSec, PEAK_BINS);
                    if (cancelled || seq !== requestSeqRef.current)
                        return;
                    if (!peaks) {
                        setAnalysis(null);
                        return;
                    }
                    setAnalysis({
                        duration: timelineDurationSec,
                        peaks,
                        pitch: [],
                        pitchTimes: [],
                        attackTimes: [],
                        notes: [],
                    });
                } catch {
                    if (!cancelled)
                        setAnalysis(null);
                }
            })();
        }, RECALC_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [enabled, durationKey, sessionSignature]);

    return analysis;
}