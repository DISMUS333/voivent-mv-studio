import { describe, it, expect, vi } from 'vitest';
import {
    base64ToUint8Array,
    uint8ArrayToBase64,
    parseWavInfo,
    createWavChunk,
    transcribeLongAudio,
} from './asrChunker';

/** テスト用ダミー WAV (16bit mono 44.1kHz, 1秒 = 88200バイト) を作成 */
function makeMockWav(durationSec: number, sampleRate = 44100): Uint8Array {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = (bitsPerSample / 8) * numChannels;
    const dataSize = Math.floor(durationSec * sampleRate * bytesPerSample);
    const bufferSize = 44 + dataSize;
    const buf = new Uint8Array(bufferSize);
    const view = new DataView(buf.buffer);

    const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    return buf;
}

describe('asrChunker utilities', () => {
    it('Base64 相互変換が可逆であること', () => {
        const original = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 0]);
        const b64 = uint8ArrayToBase64(original);
        const restored = base64ToUint8Array(b64);
        expect(restored).toEqual(original);
    });

    it('parseWavInfo で WAV ヘッダが正確に解析されること', () => {
        const wav = makeMockWav(2.5, 48000);
        const info = parseWavInfo(wav);
        expect(info).not.toBeNull();
        expect(info?.sampleRate).toBe(48000);
        expect(info?.numChannels).toBe(1);
        expect(info?.bitsPerSample).toBe(16);
        expect(info?.durationSec).toBeCloseTo(2.5, 1);
    });

    it('createWavChunk で部分 PCM から独立した有効な WAV が生成されること', () => {
        const wav = makeMockWav(10, 44100);
        const info = parseWavInfo(wav)!;
        const pcm = wav.subarray(info.dataOffset, info.dataOffset + info.dataLength);

        // 0s ~ 5s のチャンク
        const chunk = createWavChunk(
            pcm,
            info.sampleRate,
            info.numChannels,
            info.bitsPerSample,
            0,
            5 * 44100 * 2
        );

        const chunkInfo = parseWavInfo(chunk);
        expect(chunkInfo).not.toBeNull();
        expect(chunkInfo?.durationSec).toBeCloseTo(5.0, 1);
    });

    it('transcribeLongAudio が長時間音声を 25 秒チャンクに分割して時間オフセットを合成すること', async () => {
        const wav60s = makeMockWav(60, 44100);
        const b64 = uint8ArrayToBase64(wav60s);

        const requestedUrls: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                requestedUrls.push(url);
                return {
                    ok: true,
                    json: async () => [{ text: 'フレーズ', time: 1.5, duration: 3.0 }],
                };
            })
        );

        const lyrics = await transcribeLongAudio(b64, 'ja', 25);
        // 60秒は 25s, 25s, 10s の 3 チャンク
        expect(lyrics.length).toBe(3);
        expect(lyrics[0].time).toBe(1.5);
        expect(lyrics[1].time).toBe(26.5); // 1.5 + 25s
        expect(lyrics[2].time).toBe(51.5); // 1.5 + 50s

        vi.unstubAllGlobals();
    });
});
