//==============================================================================
// MV シーンタイムライン AUDIO レーン用の波形ピーク生成ユーティリティ。
// デスクトップ版ではセッションミックスダウン WAV (Base64) を解析して
// 「楽曲全体」の波形を表示する。Web 版 (initialAudioBuffer 由来) と同じ
// [min, max] ピーク形式に正規化する。
//==============================================================================
import type { Analysis } from '../../types';

/** パース済み PCM16 WAV (チャンネル平均済みモノラル) */
export interface ParsedWavPcm16 {
    sampleRate: number;
    numChannels: number;
    /** -1.0..1.0 に正規化したモノラル平均サンプル列 */
    samples: Float32Array;
}

/**
 * PCM16 WAV バイト列をチャンク走査で解析し、モノラル平均サンプル列へ変換する。
 * (AudioContext に依存しないためテスト・同期解析が可能)
 * @returns 非対応形式 / 破損ヘッダ時は null
 */
export function parseWavPcm16Mono(bytes: Uint8Array): ParsedWavPcm16 | null {
    if (!bytes || bytes.length < 44)
        return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 'RIFF' / 'WAVE' 検証
    const tag = (i: number) => String.fromCharCode(view.getUint8(i));
    if (tag(0) + tag(1) + tag(2) + tag(3) !== 'RIFF')
        return null;
    if (tag(8) + tag(9) + tag(10) + tag(11) !== 'WAVE')
        return null;

    // チャンク走査 (fmt / data の前に他チャンクが挟まる場合も許容)
    let offset = 12;
    let audioFormat = 0;
    let numChannels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataOffset = -1;
    let dataLength = 0;
    while (offset + 8 <= view.byteLength) {
        const id = tag(offset) + tag(offset + 1) + tag(offset + 2) + tag(offset + 3);
        const size = view.getUint32(offset + 4, true);
        const body = offset + 8;
        if (id === 'fmt ' && size >= 16) {
            audioFormat = view.getUint16(body, true);
            numChannels = view.getUint16(body + 2, true);
            sampleRate = view.getUint32(body + 4, true);
            bitsPerSample = view.getUint16(body + 14, true);
        } else if (id === 'data') {
            dataOffset = body;
            dataLength = Math.min(size, view.byteLength - body);
        }
        if (size <= 0)
            break; // 破損防御
        offset = body + size + (size % 2); // ワード境界パディング
    }

    if (dataOffset < 0 || audioFormat !== 1 || bitsPerSample !== 16)
        return null;
    if (numChannels <= 0 || sampleRate <= 0)
        return null;
    const frameCount = Math.floor(dataLength / (2 * numChannels));
    if (frameCount <= 0)
        return null;

    const samples = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
        let acc = 0;
        for (let ch = 0; ch < numChannels; ch++) {
            acc += view.getInt16(dataOffset + (i * numChannels + ch) * 2, true);
        }
        samples[i] = acc / numChannels / 32768;
    }
    return { sampleRate, numChannels, samples };
}

/** ピーク配列を「実音あり」と判定する最小振幅 */
export const WAVEFORM_SILENCE_THRESHOLD = 0.005;

/** ピーク配列がしきい値を超える振幅を 1 つでも持つか */
export function hasMeaningfulAmplitude(peaks: Array<[number, number]> | null | undefined): boolean {
    if (!peaks || peaks.length === 0)
        return false;
    for (let i = 0; i < peaks.length; i++) {
        const p = peaks[i];
        if (Math.abs(p[0]) > WAVEFORM_SILENCE_THRESHOLD || Math.abs(p[1]) > WAVEFORM_SILENCE_THRESHOLD)
            return true;
    }
    return false;
}

/**
 * モノラルサンプル列の先頭 usableSamples 分を bins 個の [min, max] ピークへ分割する。
 */
export function computePeaksFromSamples(
    samples: Float32Array,
    usableSamples: number,
    bins: number,
): Array<[number, number]> {
    const peaks: Array<[number, number]> = [];
    if (!samples || samples.length === 0 || bins <= 0)
        return peaks;
    const usable = Math.max(1, Math.min(usableSamples, samples.length));
    const block = Math.max(1, Math.floor(usable / bins));
    for (let b = 0; b < bins; b++) {
        const s = b * block;
        if (s >= usable) {
            peaks.push([0, 0]);
            continue;
        }
        const e = Math.min(usable, s + block);
        let mn = 1;
        let mx = -1;
        for (let j = s; j < e; j++) {
            const v = samples[j];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        // サンプルを 1 つも読めなかったブロックは無音扱い
        peaks.push(mn > mx ? [0, 0] : [mn, mx]);
    }
    return peaks;
}

/**
 * ミックスダウン WAV バイト列からタイムライン表示用ピークを生成する。
 * WAV 末尾には FX 残響テールが含まれるため、timelineDurationSec 以下の
 * 先頭領域だけを切り出して時間軸と 1:1 に対応させる。
 */
export function computeTimelinePeaksFromWav(
    bytes: Uint8Array,
    timelineDurationSec: number,
    bins = 1024,
): Array<[number, number]> | null {
    const parsed = parseWavPcm16Mono(bytes);
    if (!parsed || parsed.samples.length === 0)
        return null;
    const wavDuration = parsed.samples.length / parsed.sampleRate;
    if (wavDuration <= 0)
        return null;
    const usableDuration = timelineDurationSec > 0 ? Math.min(timelineDurationSec, wavDuration) : wavDuration;
    const usableSamples = Math.max(1, Math.floor(parsed.samples.length * (usableDuration / wavDuration)));
    return computePeaksFromSamples(parsed.samples, usableSamples, bins);
}

/**
 * AUDIO レーンに表示する解析データの優先選択。
 * ミックスダウン波形を最優先とし、無音 (実音なし) の場合は
 * 従来のボイス/クリップ解析へフォールバックする。
 */
export function pickTimelineWaveformAnalysis(
    mixdown: Analysis | null | undefined,
    legacy: Analysis | null | undefined,
): Analysis | null {
    if (mixdown && hasMeaningfulAmplitude(mixdown.peaks))
        return mixdown;
    if (legacy && hasMeaningfulAmplitude(legacy.peaks))
        return legacy;
    return mixdown ?? legacy ?? null;
}