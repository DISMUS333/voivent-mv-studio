//==============================================================================
// MV 動画エクスポート: WAV ヘッダ解析ユーティリティ。
//
// 背景:
//  - `renderSessionAudioForMV` から返る base64 WAV は C++ コアの
//    サンプルレート (例: 48000 / 44100) で生成される
//  - 一方で `new AudioContext()` を引数なしで生成すると、デバイス既定
//    (多くの JUCE 環境で 48000) になるが、稀に 44100 のケースもある
//  - 両者が一致しないと `decodeAudioData` がリサンプル補間し、
//    結果として「バリバリ」した過渡ノイズ = 音割れ知覚の原因になる
//
// 対策:
//  - WAV ヘッダから sampleRate フィールドを直接読み取り、
//    AudioContext 生成時に明示する
//==============================================================================

/**
 * WAV (RIFF) ヘッダからサンプルレートを抽出する。
 * 認識できない / 不正なバイト列なら null を返す。
 *
 * 仕様 (PCM WAV):
 *   オフセット 0  : "RIFF"        (4 byte)
 *   オフセット 4  : chunkSize     (4 byte LE)
 *   オフセット 8  : "WAVE"        (4 byte)
 *   オフセット 12 : "fmt "        (4 byte)
 *   オフセット 16 : fmtSize       (4 byte LE, 通常 16)
 *   オフセット 20 : audioFormat   (2 byte LE, PCM=1)
 *   オフセット 22 : numChannels   (2 byte LE)
 *   オフセット 24 : sampleRate    (4 byte LE)  ← ここ
 */
export function readWavSampleRate(bytes: Uint8Array): number | null {
    if (!bytes || bytes.length < 28) return null;
    // "RIFF" ... "WAVE"
    if (
        bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 || // RIFF
        bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45 // WAVE
    ) {
        return null;
    }
    // sampleRate: リトルエンディアン 4 byte at offset 24
    const b0 = bytes[24] ?? 0;
    const b1 = bytes[25] ?? 0;
    const b2 = bytes[26] ?? 0;
    const b3 = bytes[27] ?? 0;
    const sr = (b0) | (b1 << 8) | (b2 << 16) | (b3 << 24);
    if (!Number.isFinite(sr) || sr <= 0 || sr > 384000) return null;
    return sr;
}

/**
 * AudioBuffer (またはその指定時間区間) から 16bit PCM WAV の Base64 文字列を生成する。
 * 外部持ち込み音源 (WAV/MP3/M4A) をネイティブ動画エクスポートへ渡すために使用。
 */
export function audioBufferToWavBase64(
    buffer: AudioBuffer,
    startSec = 0,
    endSec?: number,
    gain = 1.0,
): string {
    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;
    const safeGain = Number.isFinite(gain) ? Math.max(0, Math.min(2, gain)) : 1.0;
    const s0 = Math.max(0, Math.min(buffer.duration, startSec));
    const s1 = endSec !== undefined ? Math.max(s0, Math.min(buffer.duration, endSec)) : buffer.duration;

    const startSample = Math.floor(s0 * sampleRate);
    const endSample = Math.floor(s1 * sampleRate);
    const numSamples = Math.max(0, endSample - startSample);

    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    // RIFF chunk descriptor
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, 'WAVE');

    // "fmt " sub-chunk
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // BitsPerSample

    // "data" sub-chunk
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // チャンネルデータをインターリーブして 16-bit PCM 整数へ変換
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const sampleIdx = startSample + i;
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, (channels[ch][sampleIdx] ?? 0) * safeGain));
            const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, intSample, true);
            offset += 2;
        }
    }

    // Base64 へ変換
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize) as any);
    }
    return btoa(binary);
}

function writeAscii(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}
