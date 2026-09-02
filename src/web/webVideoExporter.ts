//==============================================================================
// WebCodecs による Web 版 MV 動画エクスポート (H.264/AAC → MP4)。
//
// デスクトップ版の AVFoundation エクスポート契約 (startNativeMvExport /
// appendNativeMvFrames / finishNativeMvExport / cancelNativeMvExport) を
// ブラウザだけで再現する。mux には mediabunny (純 TS・ゼロ依存) を使用し、
// 音声の AudioData 変換は mediabunny が内部で行う。
//
// 設計:
//  - MvExportModal は無変更: nativeShim が同一契約を提供し、エイリアス差し替え
//    だけで Web 版 MP4 エクスポートが成立する
//  - start 時に音声 WAV をデコードして先に全投入 (公式推奨: データフットプリント
//    の小さい音声を先に追加し、packet buffering のメモリを平準化)
//  - JPEG フレームは createImageBitmap → canvas → VideoFrame (マイクロ秒) →
//    mediabunny VideoSample (秒単位タイムスタンプ) へ変換。index/fps でスナップ保証
//  - H.264 (avc) 非対応環境では WebM (VP9/VP8 + Opus) へ自動フォールバック
//  - リークガード: ImageBitmap は全経路で close()。VideoFrame は所有権を VideoSample
//    へ移管する (sample はフレームを参照保持するため先行 close は禁止)。エンコード後の
//    sample.close() が基盤フレームも解放し、mediabunny の add() との二重 close も安全
//==============================================================================
import {
    AudioBufferSource,
    BufferTarget,
    Mp4OutputFormat,
    Output,
    VideoSample,
    VideoSampleSource,
    WebMOutputFormat,
    getFirstEncodableAudioCodec,
    getFirstEncodableVideoCodec,
} from 'mediabunny';
import { stripBase64Prefix } from './downloadUtils';

/** 動画トラックの想定フレームレート (タイムスタンプのスナップ保証に使用) */
const TRACK_FRAME_RATE = 30;

/** 音声トラックのターゲットビットレート (bps) */
const AUDIO_BITRATE_BPS = 192_000;

//==============================================================================
// 内部ユーティリティ
//==============================================================================

/** 例外値から安全なメッセージ文字列を取り出す */
function toErrorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}

/** Base64 → Uint8Array (data URL プレフィックス対応・スタックオーバーフロー回避) */
function base64ToUint8(b64: string): Uint8Array {
    const binary = atob(stripBase64Prefix(b64));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * WAV Base64 を OfflineAudioContext でデコードし AudioBuffer へ。
 * ヘッダ先頭 44 バイトからサンプルレートを読み取り、WAV 実データを
 * そのまま decodeAudioData に渡す。失敗時は null (映像のみで続行)。
 */
async function decodeWavToAudioBuffer(wavBase64: string): Promise<AudioBuffer | null> {
    try {
        const bytes = base64ToUint8(wavBase64);
        if (bytes.length < 44) return null;
        const wavCopy = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(wavCopy).set(bytes);

        const AudioCtxCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtxCtor) {
            const ctx = new AudioCtxCtor();
            try {
                return await ctx.decodeAudioData(wavCopy);
            } finally {
                void ctx.close().catch(() => {});
            }
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const sampleRate = view.getUint32(24, true);
        const safeRate = Math.max(3000, Math.min(768_000, sampleRate));
        const OfflineCtor: typeof OfflineAudioContext =
            window.OfflineAudioContext ||
            (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
                .webkitOfflineAudioContext;
        if (!OfflineCtor) return null;
        const probeCtx = new OfflineCtor(2, 44100 * 10, safeRate);
        return await probeCtx.decodeAudioData(wavCopy);
    } catch (e) {
        console.warn('[webVideoExporter] Audio decode failed, exporting video without audio:', e);
        return null;
    }
}

/** ImageBitmap を安全に破棄する (二重 close 等の例外を無視) */
export function safeCloseBitmap(bitmap: ImageBitmap | null): void {
    try {
        bitmap?.close();
    } catch {
        // noop
    }
}

/**
 * JPEG Base64 フレームを mediabunny VideoSample へ変換する。
 * createImageBitmap → canvas 描画 → VideoFrame (マイクロ秒) → VideoSample (秒)。
 * ImageBitmap は全経路で close() する。VideoFrame の所有権は戻り値の VideoSample へ
 * 移管する (VideoSample はフレームを参照保持し、sample.close() 時に基盤フレームも
 * 解放する)。ここで先行 close() すると、mediabunny がエンコード時に内部フレームから
 * VideoFrame を再構築する時点で "The VideoFrame has been closed" により失敗する。
 */
export async function jpegBase64ToVideoSample(
    jpegBase64: string,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    timestampSec: number,
    durationSec: number,
): Promise<VideoSample> {
    const bytes = base64ToUint8(jpegBase64);
    const bitmap = await createImageBitmap(
        new Blob([bytes.buffer as ArrayBuffer], { type: 'image/jpeg' }),
    );
    try {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally {
        safeCloseBitmap(bitmap);
    }

    // VideoFrame は現在のキャンバス状態をキャプチャする。所有権は直後に生成する
    // VideoSample へ移管する (mediabunny はエンコード時に sample 内部のフレームから
    // VideoFrame を再構築するため、ここで close してはならない)
    const frame = new VideoFrame(canvas, {
        timestamp: Math.round(timestampSec * 1_000_000),
        duration: Math.round(durationSec * 1_000_000),
    });
    try {
        return new VideoSample(frame, { timestamp: timestampSec, duration: durationSec });
    } catch (e) {
        // VideoSample 構築に失敗した場合のみ、所有権移管前に解放する (リークガード)
        frame.close();
        throw e;
    }
}

//==============================================================================
// エクスポートセッション
//==============================================================================

/** アクティブなエクスポートセッションの状態 */
interface ExportSession {
    output: Output;
    videoSource: VideoSampleSource;
    audioSource: AudioBufferSource | null;
    decodedAudio: AudioBuffer | null;
    /** JPEG → VideoSample 変換専用のオフスクリーン作業キャンバス */
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
    fps: number;
    /** start 時に指定された出力ファイル名 (拡張子は finish 時に正規化) */
    outputFilename: string;
    /** 次に受け入れるフレームインデックス (重複・逆順検出用) */
    expectedFrameIndex: number;
    /** タイムライン上の録画開始時刻 (秒) */
    startSec: number;
    /** 最後に accept したフレームのタイムスタンプ (秒) */
    lastTimestamp: number;
}

let session: ExportSession | null = null;

//==============================================================================
// 契約実装: startNativeMvExport 相当
//==============================================================================

/**
 * エクスポートを開始する (startNativeMvExport 契約)。
 *
 * コーデック能力を実行時に検出し、H.264 が使えるなら MP4 (+AAC/MP3)、
 * 使えなければ WebM (VP9/VP8 + Opus) へ自動フォールバックする。
 *
 * @returns 成功時は出力コンテナのサブタイプ名 ('mp4' | 'webm')、失敗時は false
 *          (デスクトップ契約の boolean 互換 + WebM フォールバック情報)
 */
export async function startWebMvExport(
    width: number,
    height: number,
    fps: number,
    bitrateBps: number,
    filename: string,
    audioWavBase64?: string,
): Promise<string | false> {
    // 前セッションが残っていれば安全に破棄 (二重 start ガード)
    if (session) {
        console.warn('[webVideoExporter] start called while a session is active — cancelling previous session');
        await cancelWebMvExport();
    }
    // WebCodecs / createImageBitmap の存在確認 (非対応ブラウザは明確に失敗)
    if (typeof VideoFrame === 'undefined' || typeof createImageBitmap !== 'function') {
        console.error('[webVideoExporter] WebCodecs is not available in this browser');
        return false;
    }

    const effectiveFps = fps > 0 ? fps : TRACK_FRAME_RATE;

    try {
        // ── コーデック能力検出 ──────────────────────────────────────────
        // 映像: H.264 (avc) → VP9 → VP8 の順にフォールバック
        const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width, height });
        if (!videoCodec) {
            console.error('[webVideoExporter] No encodable video codec (avc/vp9/vp8) available');
            return false;
        }
        const containerIsMp4 = videoCodec === 'avc';
        // 音声: MP4 は AAC → MP3、WebM は Opus (Vorbis はエンコーダ非搭載が多い)
        const audioCodec = audioWavBase64
            ? await getFirstEncodableAudioCodec(containerIsMp4 ? ['aac', 'mp3', 'opus'] : ['opus'])
            : null;

        // ── 出力構成 (トラック追加は start 前に全て行う) ────────────────
        const output = new Output({
            format: containerIsMp4
                ? new Mp4OutputFormat({ fastStart: 'in-memory' })
                : new WebMOutputFormat(),
            target: new BufferTarget(),
        });
        const videoSource = new VideoSampleSource({
            codec: videoCodec,
            bitrate: bitrateBps,
            keyFrameInterval: 2,
        });
        output.addVideoTrack(videoSource, { frameRate: effectiveFps });

        // 音声 WAV はここで 1 回だけデコードする
        let decodedAudio: AudioBuffer | null = null;
        if (audioWavBase64 && audioCodec) {
            decodedAudio = await decodeWavToAudioBuffer(audioWavBase64);
        }

        let audioSource: AudioBufferSource | null = null;
        if (decodedAudio && audioCodec) {
            audioSource = new AudioBufferSource({
                codec: audioCodec,
                bitrate: AUDIO_BITRATE_BPS,
            });
            output.addAudioTrack(audioSource);
        }

        await output.start();

        // ── セッション登録 (音声投入はビデオフレームと競合しないよう finish 時に行う) ──
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;

        session = {
            output,
            videoSource,
            audioSource,
            decodedAudio,
            canvas,
            ctx,
            width,
            height,
            fps: effectiveFps,
            outputFilename: filename || 'mv_export',
            expectedFrameIndex: 0,
            startSec: 0,
            lastTimestamp: -1,
        };

        console.info(
            `[webVideoExporter] export started: ${width}x${height} @${effectiveFps}fps ` +
            `video=${videoCodec} audio=${audioCodec ?? 'none'} container=${containerIsMp4 ? 'mp4' : 'webm'}`,
        );
        return containerIsMp4 ? 'mp4' : 'webm';
    } catch (e) {
        console.error('[webVideoExporter] start failed:', toErrorMessage(e));
        session = null;
        return false;
    }
}

//==============================================================================
// 契約実装: appendNativeMvFrames 相当
//==============================================================================

/**
 * バッチレンダリング済みの JPEG Base64 フレームを受け入れる
 * (appendNativeMvFrames 契約)。
 *
 * 各フレームは VideoSample (秒単位タイムスタンプ) へ変換され、
 * backpressure 保証のため 1 件ずつ await しながらエンコーダへ送られる。
 *
 * @param frames JPEG Base64 (data URL でも可) の配列
 * @param startFrameIndex 先頭フレームのグローバルインデックス
 */
export async function appendWebMvFrames(
    frames: string[],
    startFrameIndex: number,
): Promise<boolean> {
    if (!session) {
        console.warn('[webVideoExporter] append called without an active session');
        return false;
    }
    if (frames.length === 0) return true;

    try {
        const frameDuration = 1 / session.fps;
        for (let i = 0; i < frames.length; i++) {
            const globalIndex = startFrameIndex + i;
            if (globalIndex !== session.expectedFrameIndex) {
                throw new Error(
                    `Unexpected frame index ${globalIndex} (expected ${session.expectedFrameIndex})`,
                );
            }
            const timestamp = session.startSec + globalIndex * frameDuration;
            const sample = await jpegBase64ToVideoSample(
                frames[i],
                session.canvas,
                session.ctx,
                timestamp,
                frameDuration,
            );
            try {
                await session.videoSource.add(sample);
            } finally {
                // add() 完了後に sample を解放 (基盤 VideoFrame も同時に解放される)。
                // mediabunny の add() も内部で close するが、実物の二重 close は安全な no-op
                sample.close();
            }
            session.expectedFrameIndex = globalIndex + 1;
            session.lastTimestamp = timestamp;
        }
        return true;
    } catch (e) {
        console.error('[webVideoExporter] append failed:', toErrorMessage(e));
        // 失敗したセッションは破棄して以降の append を弾く
        session = null;
        return false;
    }
}

//==============================================================================
// 契約実装: finishNativeMvExport 相当
//==============================================================================


/**
 * エクスポートを完了し、最終動画をブラウザダウンロードへ保存する
 * (finishNativeMvExport 契約・保存先パスの代わりにファイル名を返す)。
 */
export async function finishWebMvExport(): Promise<string | false> {
    if (!session) {
        console.warn('[webVideoExporter] finish called without an active session');
        return false;
    }
    const activeSession = session;
    session = null;

    try {
        if (activeSession.audioSource && activeSession.decodedAudio) {
            try {
                await activeSession.audioSource.add(activeSession.decodedAudio);
                activeSession.audioSource.close();
            } catch (ae) {
                console.warn('[webVideoExporter] Audio track encoding failed, outputting video only:', ae);
            }
        }
        await activeSession.videoSource.close();
        await activeSession.output.finalize();

        const target = activeSession.output.target as BufferTarget;
        if (!target.buffer) {
            throw new Error('Muxer produced no output buffer');
        }

        // MIME タイプは MP4 / WebM をコンテナから判定
        const container = activeSession.output.format;
        const mime = container instanceof Mp4OutputFormat ? 'video/mp4' : 'video/webm';
        const ext = container instanceof Mp4OutputFormat ? 'mp4' : 'webm';

        const blob = new Blob([target.buffer], { type: mime });
        // 拡張子をコンテナ種別に合わせて正規化 (WebM フォールバック時は .webm へ)
        const baseName = activeSession.outputFilename.replace(/\.(mp4|webm)$/i, '');
        const filename = `${baseName}.${ext}`;
        downloadBlob(blob, filename);
        console.info(`[webVideoExporter] export finished: ${filename} (${blob.size} bytes)`);
        return filename;
    } catch (e) {
        console.error('[webVideoExporter] finish failed:', toErrorMessage(e));
        return false;
    }
}


//==============================================================================
// 契約実装: cancelNativeMvExport 相当
//==============================================================================

/** エクスポートを中断し、内部リソース (エンコーダ・muxer) を解放する */
export async function cancelWebMvExport(): Promise<boolean> {
    if (!session) return false;
    const activeSession = session;
    session = null;
    try {
        await activeSession.output.cancel();
        console.info('[webVideoExporter] export cancelled');
        return true;
    } catch (e) {
        console.warn('[webVideoExporter] cancel failed:', toErrorMessage(e));
        return false;
    }
}

//==============================================================================
// ダウンロード
//==============================================================================

/** Blob をブラウザダウンロードへ保存する (成功時ファイル名・失敗時 false) */
export function downloadBlob(blob: Blob, filename: string): string | false {
    try {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        // revoke はダウンロード開始を待ってから (即 revoke すると Safari で失敗する)
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return filename;
    } catch (e) {
        console.error('[webVideoExporter] download failed:', toErrorMessage(e));
        return false;
    }
}

//==============================================================================
// テスト用ヘルパー (アプリケーション本体からは使用しない)
//==============================================================================

/** テスト用: アクティブセッションへ VideoSample を直接注入する */
export async function __injectVideoSampleForTest(sample: VideoSample): Promise<void> {
    if (!session) throw new Error('no active export session');
    await session.videoSource.add(sample);
    session.lastTimestamp = sample.timestamp;
}

/** テスト用: アクティブセッションの状態スナップショットを取得する */
export function __getSessionStateForTest(): {
    fps: number;
    width: number;
    height: number;
    expectedFrameIndex: number;
    startSec: number;
    lastTimestamp: number;
} | null {
    if (!session) return null;
    return {
        fps: session.fps,
        width: session.width,
        height: session.height,
        expectedFrameIndex: session.expectedFrameIndex,
        startSec: session.startSec,
        lastTimestamp: session.lastTimestamp,
    };
}

