//==============================================================================
// asrChunker.ts - 長時間音声の 25 秒チャンク分割 ＆ 並列 Workers AI ASR 送信
//
// Whisper モデルは 30 秒以内の音声チャンクを最適に推論する設計のため、
// 30 秒を超える音声は 20〜25 秒の小さな WAV に分割して並列送信し、
// 各チャンクの開始秒数オフセットを合成してタイムライン全体の歌詞を生成する。
//==============================================================================

export interface AsrLyricItem {
    text: string;
    time: number;
    duration: number;
}

/** Base64 文字列を Uint8Array へデコード */
export function base64ToUint8Array(b64: string): Uint8Array {
    const cleanB64 = b64.replace(/^data:audio\/[a-z0-9]+;base64,/, '').trim();
    const binStr = atob(cleanB64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
}

/** Uint8Array を Base64 文字列へエンコード */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as any);
    }
    return btoa(binary);
}

/** WAV ヘッダーからサンプルレート・チャンネル数・データ範囲を解析 */
export function parseWavInfo(bytes: Uint8Array): {
    sampleRate: number;
    numChannels: number;
    bitsPerSample: number;
    dataOffset: number;
    dataLength: number;
    durationSec: number;
} | null {
    if (bytes.length < 44) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const format = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (magic !== 'RIFF' || format !== 'WAVE') return null;

    let offset = 12;
    let sampleRate = 44100;
    let numChannels = 1;
    let bitsPerSample = 16;
    let dataOffset = 44;
    let dataLength = 0;

    while (offset < bytes.length - 8) {
        const chunkId = String.fromCharCode(
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3]
        );
        const chunkSize = view.getUint32(offset + 4, true);

        if (chunkId === 'fmt ') {
            numChannels = view.getUint16(offset + 8 + 2, true);
            sampleRate = view.getUint32(offset + 8 + 4, true);
            bitsPerSample = view.getUint16(offset + 8 + 14, true);
        } else if (chunkId === 'data') {
            dataOffset = offset + 8;
            dataLength = chunkSize;
            break;
        }

        offset += 8 + chunkSize;
    }

    const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8);
    const durationSec = bytesPerSecond > 0 ? dataLength / bytesPerSecond : 0;

    return {
        sampleRate,
        numChannels,
        bitsPerSample,
        dataOffset,
        dataLength,
        durationSec,
    };
}

/** 任意の PCM 範囲から新しい 16bit WAV ファイルバイナリを構築 */
export function createWavChunk(
    sourcePcm: Uint8Array,
    sampleRate: number,
    numChannels: number,
    bitsPerSample: number,
    startByte: number,
    endByte: number
): Uint8Array {
    const pcmChunk = sourcePcm.subarray(startByte, endByte);
    const bytesPerSample = (bitsPerSample / 8) * numChannels;
    const dataSize = pcmChunk.length;
    const bufferSize = 44 + dataSize;

    const out = new Uint8Array(bufferSize);
    const view = new DataView(out.buffer);

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

    out.set(pcmChunk, 44);
    return out;
}

/** 単一チャンクを /api/transcribe へ送信 */
async function transcribeSingleChunk(
    chunkBase64: string,
    language: string
): Promise<AsrLyricItem[]> {
    const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audioBase64: chunkBase64, language }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        console.warn('[Web ASR Chunker] Single chunk error:', res.status, err);
        return [];
    }

    const data = (await res.json()) as AsrLyricItem[];
    return Array.isArray(data) ? data : [];
}

/** 長時間音声をチャンク分割して並列転送＆合成 */
export async function transcribeLongAudio(
    base64Wav: string,
    language = 'ja',
    chunkDurationSec = 25
): Promise<AsrLyricItem[]> {
    const bytes = base64ToUint8Array(base64Wav);
    const wavInfo = parseWavInfo(bytes);

    // WAV 解析不可または 28 秒未満ならそのまま 1 発送信
    if (!wavInfo || wavInfo.durationSec <= 28) {
        return transcribeSingleChunk(base64Wav, language);
    }

    const { sampleRate, numChannels, bitsPerSample, dataOffset, dataLength, durationSec } = wavInfo;
    const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8);
    const pcmData = bytes.subarray(dataOffset, dataOffset + dataLength);

    const chunkTasks: Array<{ startSec: number; endSec: number; chunkB64: string }> = [];
    let currentSec = 0;

    while (currentSec < durationSec) {
        const nextSec = Math.min(durationSec, currentSec + chunkDurationSec);
        const startByte = Math.floor(currentSec * bytesPerSecond);
        // フレーム境界（チャンネル数 * サンプルバイト）に揃える
        const frameAlign = numChannels * (bitsPerSample / 8);
        const alignedStartByte = startByte - (startByte % frameAlign);
        const rawEndByte = Math.min(pcmData.length, Math.ceil(nextSec * bytesPerSecond));
        const alignedEndByte = rawEndByte - (rawEndByte % frameAlign);

        const chunkWavBytes = createWavChunk(
            pcmData,
            sampleRate,
            numChannels,
            bitsPerSample,
            alignedStartByte,
            alignedEndByte
        );

        chunkTasks.push({
            startSec: currentSec,
            endSec: nextSec,
            chunkB64: uint8ArrayToBase64(chunkWavBytes),
        });

        currentSec = nextSec;
    }

    console.log(`[Web ASR Chunker] Splitting ${durationSec.toFixed(1)}s audio into ${chunkTasks.length} chunks...`);

    // チャンクを並列処理 (最大 3 並列でレートリミットを回避)
    const allLyrics: AsrLyricItem[] = [];
    const BATCH_SIZE = 3;

    for (let i = 0; i < chunkTasks.length; i += BATCH_SIZE) {
        const batch = chunkTasks.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(async (task) => {
                const lyrics = await transcribeSingleChunk(task.chunkB64, language);
                // チャンク開始秒数をオフセット加算
                return lyrics.map((item) => ({
                    ...item,
                    time: Number((item.time + task.startSec).toFixed(2)),
                }));
            })
        );

        for (const res of batchResults) {
            allLyrics.push(...res);
        }
    }

    // 時間順にソート
    allLyrics.sort((a, b) => a.time - b.time);
    return allLyrics;
}
