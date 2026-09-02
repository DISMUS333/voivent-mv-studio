//==============================================================================
// Voice to MIDI（鼻歌メロディ抽出・スケール吸着）計算エンジン
// 純粋関数として実装し、単体テストおよび高速リアルタイム処理を可能にする
//==============================================================================

import { noteName } from '../../lib/music';
import type { ExtractedMidiNote, MusicalScale, VoiceToMidiSettings } from './types';

// スケール別インターバル定義 (半音オフセット)
const SCALE_INTERVALS: Record<MusicalScale, number[]> = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    pentatonic_major: [0, 2, 4, 7, 9],
    pentatonic_minor: [0, 3, 5, 7, 10],
};

/** 周波数 (Hz) を最も近い MIDI ノート番号へ変換する */
export function hzToMidiNote(hz: number): number {
    if (hz <= 0 || !Number.isFinite(hz)) return -1;
    const midi = Math.round(69 + 12 * Math.log2(hz / 440));
    return Math.max(0, Math.min(127, midi));
}

/** 指定スケールにピッチをスナップ（最近傍の構成音へ吸着）する */
export function snapToScale(midiNote: number, scale: MusicalScale, rootKey: number): number {
    if (midiNote < 0) return midiNote;
    if (scale === 'chromatic') return midiNote;

    const intervals = SCALE_INTERVALS[scale] || SCALE_INTERVALS.chromatic;
    const noteClass = ((midiNote % 12) + 12) % 12;
    const octave = Math.floor(midiNote / 12);

    let bestClass = intervals[0];
    let minDiff = 999;

    for (const interval of intervals) {
        const targetClass = (rootKey + interval) % 12;
        const diff = Math.min(
            Math.abs(noteClass - targetClass),
            12 - Math.abs(noteClass - targetClass)
        );
        if (diff < minDiff) {
            minDiff = diff;
            bestClass = targetClass;
        }
    }

    const snapped = octave * 12 + bestClass;
    return Math.max(0, Math.min(127, snapped));
}

/** メディアンフィルタ（ピッチの細かい揺れ・しゃくりをならす） */
function medianFilter(values: number[], windowSize: number): number[] {
    if (windowSize <= 1 || values.length === 0) return [...values];
    const half = Math.floor(windowSize / 2);
    const result: number[] = new Array(values.length);

    for (let i = 0; i < values.length; ++i) {
        const window: number[] = [];
        for (let w = -half; w <= half; ++w) {
            const idx = i + w;
            if (idx >= 0 && idx < values.length && values[idx] > 0) {
                window.push(values[idx]);
            }
        }
        if (window.length > 0) {
            window.sort((a, b) => a - b);
            result[i] = window[Math.floor(window.length / 2)];
        } else {
            result[i] = values[i];
        }
    }
    return result;
}

/**
 * 録音音声の解析データ（ピッチ配列・時間配列・RMS音量）から
 * 安定した MIDI ノート群をインテリジェントに抽出する
 */
export function extractMidiNotesFromVoice(
    pitchHzArray: number[],
    pitchTimesSec: number[],
    rmsArray: number[],
    settings: VoiceToMidiSettings
): ExtractedMidiNote[] {
    const len = Math.min(pitchHzArray.length, pitchTimesSec.length);
    if (len === 0) return [];

    // 1. ノイズゲート適用（音量が閾値未満のフレームはピッチを 0 化して無視）
    const gatedPitch = pitchHzArray.slice(0, len).map((hz, idx) => {
        const rms = rmsArray[idx] ?? 0.1;
        return rms < settings.noiseGateThreshold ? 0 : hz;
    });

    // 2. ピッチ平滑化（メディアンフィルタ）
    const smoothedPitch = medianFilter(gatedPitch, settings.pitchSmoothing);

    // 3. MIDI ノート化 ＆ スケール吸着
    const midiFrames = smoothedPitch.map((hz) => {
        const rawMidi = hzToMidiNote(hz);
        if (rawMidi < 0) return -1;
        return snapToScale(rawMidi, settings.scale, settings.rootKey);
    });

    // 4. 連続区間の検出とノートイベント化
    const notes: ExtractedMidiNote[] = [];
    let curMidi = -1;
    let curStart = 0;
    let curEnd = 0;
    let sumRms = 0;
    let frameCount = 0;

    const commitCurrentNote = () => {
        if (curMidi >= 0) {
            const duration = Math.max(0, curEnd - curStart);
            if (duration >= settings.minNoteDurationSec) {
                const avgRms = frameCount > 0 ? sumRms / frameCount : 0.2;
                // RMSからベロシティを計算 (1 - 127)
                const rawVel = Math.round(avgRms * 127 * settings.velocitySensitivity);
                const velocity = Math.max(20, Math.min(127, rawVel));

                notes.push({
                    id: `vnote_${notes.length}_${curMidi}_${curStart.toFixed(2)}`,
                    midi: curMidi,
                    noteName: noteName(curMidi),
                    startSeconds: curStart,
                    endSeconds: curEnd,
                    duration,
                    velocity,
                    confidence: Math.min(1.0, duration / 0.2),
                });
            }
        }
        curMidi = -1;
        frameCount = 0;
        sumRms = 0;
    };

    for (let i = 0; i < len; ++i) {
        const midi = midiFrames[i];
        const t = pitchTimesSec[i];
        const rms = rmsArray[i] ?? 0.1;

        if (midi <= 0) {
            commitCurrentNote();
            continue;
        }

        if (midi === curMidi) {
            curEnd = t;
            sumRms += rms;
            frameCount++;
        } else {
            commitCurrentNote();
            curMidi = midi;
            curStart = t;
            curEnd = t + (pitchTimesSec[1] - pitchTimesSec[0] || 0.02);
            sumRms = rms;
            frameCount = 1;
        }
    }
    commitCurrentNote();

    return notes;
}
