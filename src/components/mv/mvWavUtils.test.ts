//==============================================================================
// mvWavUtils（WAV ヘッダ sampleRate 抽出）の単体テスト。
// MV 動画エクスポートの「音割れ」対策: AudioContext と WAV の sampleRate が
// 一致していないと decodeAudioData がリサンプル補間 → 過渡ノイズの温床。
// 本テストではその抽出ロジックが WAV 仕様通りに動くことを担保する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { audioBufferToWavBase64, readWavSampleRate } from './mvWavUtils';

function makeAudioBuffer(samples: number[]): AudioBuffer {
    return {
        duration: samples.length / 8000,
        sampleRate: 8000,
        length: samples.length,
        numberOfChannels: 1,
        getChannelData: () => Float32Array.from(samples),
    } as unknown as AudioBuffer;
}

/**
 * テスト用の WAV 風バイト列を生成する。
 * RIFF/WAVE/fmt ヘッダ部分は本物の WAV 仕様に従い、それ以降はダミー PCM データ。
 */
function makeWavBytes(sampleRate: number, channels = 2, bitsPerSample = 16): Uint8Array {
    const dataSize = 64; // ダミー
    const buf = new Uint8Array(44 + dataSize);
    // "RIFF"
    buf[0] = 0x52; buf[1] = 0x49; buf[2] = 0x46; buf[3] = 0x46;
    // chunkSize (4 byte LE) = 36 + dataSize
    const cs = 36 + dataSize;
    buf[4] = cs & 0xff;
    buf[5] = (cs >> 8) & 0xff;
    buf[6] = (cs >> 16) & 0xff;
    buf[7] = (cs >> 24) & 0xff;
    // "WAVE"
    buf[8] = 0x57; buf[9] = 0x41; buf[10] = 0x56; buf[11] = 0x45;
    // "fmt "
    buf[12] = 0x66; buf[13] = 0x6d; buf[14] = 0x74; buf[15] = 0x20;
    // fmtSize = 16
    buf[16] = 16; buf[17] = 0; buf[18] = 0; buf[19] = 0;
    // audioFormat = 1 (PCM)
    buf[20] = 1; buf[21] = 0;
    // numChannels
    buf[22] = channels; buf[23] = 0;
    // sampleRate (LE 4 byte) ← ここが検証対象
    buf[24] = sampleRate & 0xff;
    buf[25] = (sampleRate >> 8) & 0xff;
    buf[26] = (sampleRate >> 16) & 0xff;
    buf[27] = (sampleRate >> 24) & 0xff;
    // byteRate
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    buf[28] = byteRate & 0xff;
    buf[29] = (byteRate >> 8) & 0xff;
    buf[30] = (byteRate >> 16) & 0xff;
    buf[31] = (byteRate >> 24) & 0xff;
    // blockAlign
    buf[32] = channels * (bitsPerSample / 8); buf[33] = 0;
    // bitsPerSample
    buf[34] = bitsPerSample; buf[35] = 0;
    // "data"
    buf[36] = 0x64; buf[37] = 0x61; buf[38] = 0x74; buf[39] = 0x61;
    // dataSize
    buf[40] = dataSize & 0xff;
    buf[41] = (dataSize >> 8) & 0xff;
    buf[42] = (dataSize >> 16) & 0xff;
    buf[43] = (dataSize >> 24) & 0xff;
    return buf;
}

describe('mvWavUtils / readWavSampleRate', () => {
    it('48000Hz の sampleRate を正しく抽出する', () => {
        const bytes = makeWavBytes(48000);
        expect(readWavSampleRate(bytes)).toBe(48000);
    });

    it('44100Hz の sampleRate を正しく抽出する', () => {
        const bytes = makeWavBytes(44100);
        expect(readWavSampleRate(bytes)).toBe(44100);
    });

    it('32000Hz の sampleRate を正しく抽出する', () => {
        const bytes = makeWavBytes(32000);
        expect(readWavSampleRate(bytes)).toBe(32000);
    });

    it('96000Hz（ハイレゾ）も正しく抽出する', () => {
        const bytes = makeWavBytes(96000);
        expect(readWavSampleRate(bytes)).toBe(96000);
    });

    it('RIFF マジックが欠けたバイト列は null', () => {
        const bytes = makeWavBytes(48000);
        bytes[0] = 0x00; // "R" を破壊
        expect(readWavSampleRate(bytes)).toBeNull();
    });

    it('WAVE マジックが欠けたバイト列は null', () => {
        const bytes = makeWavBytes(48000);
        bytes[8] = 0x00; // "W" を破壊
        expect(readWavSampleRate(bytes)).toBeNull();
    });

    it('短すぎるバイト列は null（クラッシュ防止）', () => {
        expect(readWavSampleRate(new Uint8Array(10))).toBeNull();
    });

    it('null / undefined 入力はクラッシュせず null', () => {
        // @ts-expect-error 意図的に不正型
        expect(readWavSampleRate(null)).toBeNull();
        // @ts-expect-error 意図的に不正型
        expect(readWavSampleRate(undefined)).toBeNull();
    });

    it('sampleRate=0 は不正値として null', () => {
        const bytes = makeWavBytes(0);
        expect(readWavSampleRate(bytes)).toBeNull();
    });

    it('極端に大きな sampleRate（>384000）は不正値として null', () => {
        const bytes = makeWavBytes(1_000_000);
        expect(readWavSampleRate(bytes)).toBeNull();
    });
});

describe('mvWavUtils / audioBufferToWavBase64', () => {
    it('エクスポート用ゲインを PCM データへ適用する', () => {
        const b64 = audioBufferToWavBase64(makeAudioBuffer([0.5, -0.5]), 0, 0.00025, 0.5);
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const view = new DataView(bytes.buffer);

        expect(view.getInt16(44, true)).toBe(8191);
        expect(view.getInt16(46, true)).toBe(-8192);
    });

    it('不正なゲインは既定値へ戻る', () => {
        const b64 = audioBufferToWavBase64(makeAudioBuffer([0.5]), 0, 0.000125, Number.NaN);
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        expect(new DataView(bytes.buffer).getInt16(44, true)).toBe(16383);
    });
});
