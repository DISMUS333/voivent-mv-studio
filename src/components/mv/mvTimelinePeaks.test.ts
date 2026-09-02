import { describe, expect, it } from 'vitest';
import type { Analysis } from '../../types';
import {
    computePeaksFromSamples,
    computeTimelinePeaksFromWav,
    hasMeaningfulAmplitude,
    parseWavPcm16Mono,
    pickTimelineWaveformAnalysis,
    WAVEFORM_SILENCE_THRESHOLD,
} from './mvTimelinePeaks';

/** 正弦波 + 16bit PCM WAV バイト列を生成するテストヘルパー */
function makeWavBytes(opts: {
    sampleRate?: number;
    channels?: number;
    durationSec?: number;
    amplitude?: number;
    freqHz?: number;
} = {}): Uint8Array {
    const sampleRate = opts.sampleRate ?? 44100;
    const channels = opts.channels ?? 2;
    const durationSec = opts.durationSec ?? 1;
    const amplitude = opts.amplitude ?? 0.5;
    const freqHz = opts.freqHz ?? 440;
    const frames = Math.floor(sampleRate * durationSec);
    const dataSize = frames * channels * 2;

    const bytes = new Uint8Array(44 + dataSize);
    const view = new DataView(bytes.buffer);
    const wstr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    wstr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    wstr(8, 'WAVE');
    wstr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true); // byte rate
    view.setUint16(32, channels * 2, true); // block align
    view.setUint16(34, 16, true);
    wstr(36, 'data');
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < frames; i++) {
        const v = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * freqHz * i) / sampleRate));
        for (let ch = 0; ch < channels; ch++) {
            view.setInt16(44 + (i * channels + ch) * 2, v, true);
        }
    }
    return bytes;
}

describe('parseWavPcm16Mono', () => {
    it('ステレオ PCM16 WAV をモノラル平均 Float32Array へ変換する', () => {
        const parsed = parseWavPcm16Mono(makeWavBytes({ channels: 2, amplitude: 0.5 }));
        expect(parsed).not.toBeNull();
        expect(parsed!.sampleRate).toBe(44100);
        expect(parsed!.numChannels).toBe(2);
        expect(parsed!.samples.length).toBe(44100);
        // 正弦波の最大振幅がおおよそ amplitude に一致
        let maxAbs = 0;
        for (const v of parsed!.samples) maxAbs = Math.max(maxAbs, Math.abs(v));
        expect(maxAbs).toBeGreaterThan(0.45);
        expect(maxAbs).toBeLessThan(0.55);
    });

    it('非PCM形式や破損ヘッダでは null を返す', () => {
        expect(parseWavPcm16Mono(new Uint8Array(10))).toBeNull();
        const notWave = makeWavBytes();
        notWave[0] = 0x00; // RIFF 破損
        expect(parseWavPcm16Mono(notWave)).toBeNull();
    });
});

describe('computeTimelinePeaksFromWav', () => {
    it('ミックスダウン WAV からタイムライン長に切り出したピークを生成する', () => {
        // 2 秒 WAV (末尾 1 秒は FX テール相当)
        const bytes = makeWavBytes({ durationSec: 2 });
        const peaks = computeTimelinePeaksFromWav(bytes, 1.0, 512);
        expect(peaks).not.toBeNull();
        expect(peaks!.length).toBe(512);
        // 実音領域から有意な振幅が得られる
        expect(hasMeaningfulAmplitude(peaks)).toBe(true);
    });

    it('無音 WAV では全ビンがほぼゼロになる', () => {
        const bytes = makeWavBytes({ durationSec: 1, amplitude: 0 });
        const peaks = computeTimelinePeaksFromWav(bytes, 1.0, 64);
        expect(peaks).not.toBeNull();
        expect(hasMeaningfulAmplitude(peaks)).toBe(false);
    });
});

describe('hasMeaningfulAmplitude', () => {
    it('しきい値超のピークを検出する', () => {
        expect(hasMeaningfulAmplitude([[0, 0.2]])).toBe(true);
        expect(hasMeaningfulAmplitude([[-0.004, 0.004]])).toBe(false);
        expect(hasMeaningfulAmplitude([])).toBe(false);
        expect(hasMeaningfulAmplitude(null)).toBe(false);
        expect(WAVEFORM_SILENCE_THRESHOLD).toBeGreaterThan(0);
    });
});

describe('computePeaksFromSamples', () => {
    it('サンプル列を bins 個の min/max ペアへ分割する', () => {
        const samples = new Float32Array(1000);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 10);
        const peaks = computePeaksFromSamples(samples, samples.length, 10);
        expect(peaks.length).toBe(10);
        for (const [mn, mx] of peaks) {
            expect(mn).toBeLessThanOrEqual(mx);
        }
        // 全体の最小/最大が含まれる
        const allMin = Math.min(...peaks.map((p) => p[0]));
        const allMax = Math.max(...peaks.map((p) => p[1]));
        expect(allMin).toBeLessThan(0);
        expect(allMax).toBeGreaterThan(0);
    });

    it('usableSamples で再生長を制限できる', () => {
        const samples = new Float32Array(2000);
        for (let i = 0; i < 1000; i++) samples[i] = 0.8; // 前半のみ実音
        const peaks = computePeaksFromSamples(samples, 1000, 4);
        expect(peaks.length).toBe(4);
        for (const [mn, mx] of peaks) {
            expect(Math.max(Math.abs(mn), Math.abs(mx))).toBeGreaterThan(0.5);
        }
    });
});

describe('pickTimelineWaveformAnalysis', () => {
    it('実音ありのミックスダウンを最優先する', () => {
        const mixdown: Analysis = { duration: 10, peaks: [[-0.5, 0.5]], pitch: [], pitchTimes: [], attackTimes: [], notes: [] };
        const legacy: Analysis = { duration: 10, peaks: [[0, 0]], pitch: [], pitchTimes: [], attackTimes: [], notes: [] };
        expect(pickTimelineWaveformAnalysis(mixdown, legacy)).toBe(mixdown);
    });

    it('ミックスダウンが無音なら実音ありのレガシー解析へフォールバックする', () => {
        const silentMix: Analysis = { duration: 10, peaks: [[0, 0]], pitch: [], pitchTimes: [], attackTimes: [], notes: [] };
        const legacy: Analysis = { duration: 10, peaks: [[-0.4, 0.4]], pitch: [], pitchTimes: [], attackTimes: [], notes: [] };
        expect(pickTimelineWaveformAnalysis(silentMix, legacy)).toBe(legacy);
    });

    it('両方無音なら null にはせずミックスダウンを返す (レーン形式を維持)', () => {
        const silentMix: Analysis = { duration: 10, peaks: [[0, 0]], pitch: [], pitchTimes: [], attackTimes: [], notes: [] };
        const silentLegacy: Analysis = { duration: 10, peaks: [[0, 0]], pitch: [], pitchTimes: [], attackTimes: [], notes: [] };
        expect(pickTimelineWaveformAnalysis(silentMix, silentLegacy)).toBe(silentMix);
        expect(pickTimelineWaveformAnalysis(silentMix, null)).toBe(silentMix);
    });
});