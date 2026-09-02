//==============================================================================
// WebMCP レンダリングポート実装。
// get_mv_preview (AI の「目」) と render_mv_video (AI の「納品」) のホスト側
// 処理を MV ワークスペースから分離して提供する。
//
//  - プレビュー静止画: mvFrameRenderer の決定論的オフライン描画を 1 フレーム
//    実行し、縮小 JPEG 化する (エクスポート映像と同一の描画経路)
//  - 動画レンダリング: MvExportModal と同じ native エクスポート契約
//    (Web 版 = WebCodecs + mediabunny / デスクトップ = AVFoundation) を再利用
//==============================================================================
import type {
    EnergyAnalysisSource,
    WebMcpPreviewCapturePort,
    WebMcpVideoRenderPort,
} from './webMcpTools';
import type { MvProjectConfig } from './types';
import { renderFrameToCanvas, preloadAssets } from './mvFrameRenderer';
import { buildOfflineSignals } from './mvOfflineRender';
import { getResolutionPresets, DEFAULT_RESOLUTION_ID } from './mvExportPresets';
import { audioBufferToWavBase64 } from './mvWavUtils';
import { native } from '../../native';
import type { Mv3DFrameDiagnostics } from './mv3dOffline';

export interface WebMcpRenderPortDeps {
    getConfig: () => MvProjectConfig;
    getBpm: () => number;
    getAnalysis: () => EnergyAnalysisSource | null;
    /** ミックスダウン元のオーディオバッファ (Web 版は持ち込み音源)。未ロード時は null */
    getAudioBuffer: () => AudioBuffer | null;
    /** Web 版のマスターゲイン。ネイティブ経路ではホスト側が適用する */
    getAudioGain: () => number;
    getPhaserCanvas: () => HTMLCanvasElement | null;
    /** 静止画キャプチャ基準の再生位置 (秒) */
    getPlayheadSec: () => number;
    /** レンダリング排他制御 (エクスポートモーダル稼働中などは true) */
    isBusy: () => boolean;
    setBusy: (busy: boolean) => void;
}

/** プレビュー解像度プリセットを解決する */
function resolvePreset(config: MvProjectConfig) {
    const presets = getResolutionPresets();
    return presets.find((p) => p.id === (config.previewResolutionId || DEFAULT_RESOLUTION_ID)) ?? presets[0];
}

/** 指定時刻の 1 フレームをオフスクリーン Canvas へ決定論的描画する */
async function renderStillFrame(
    deps: WebMcpRenderPortDeps,
    width: number,
    height: number,
    timeSec: number,
): Promise<{ canvas: HTMLCanvasElement; threeD?: Mv3DFrameDiagnostics }> {
    const config = deps.getConfig();
    const analysis = deps.getAnalysis();
    const signals = buildOfflineSignals(deps.getBpm(), analysis, timeSec, config.lyrics);

    if ((config.assets?.length ?? 0) > 0) {
        await preloadAssets(config.assets ?? []);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Canvas 2D コンテキストを取得できませんでした');
    }

    let threeD: Mv3DFrameDiagnostics | undefined;
    await renderFrameToCanvas({
        canvas,
        ctx,
        width,
        height,
        timeSec,
        scenes: config.scenes,
        lyrics: config.lyrics,
        signals,
        globalCss: config.globalCss,
        phaserCanvas: deps.getPhaserCanvas(),
        assets: config.assets ?? [],
        lyricStyle: config.lyricStyle,
        // 静止画プレビューはユーザーが見ている画面 (ライブ Phaser canvas) を優先。
        // canvas 未接続・未初期化時は renderFrameToCanvas 内部で決定論的
        // フォールバック背景へ自動置換される。
        isOfflineRender: false,
        on3DFrameDiagnostics: (diagnostics) => { threeD = diagnostics; },
    });
    return { canvas, threeD };
}

/** メイン Canvas を maxWidth 以下へ縮小して JPEG data URL 化する */
function downscaleToJpeg(
    source: HTMLCanvasElement,
    maxWidth: number,
    quality = 0.82,
): { dataUrl: string; width: number; height: number } | null {
    const scale = Math.min(1, maxWidth / Math.max(1, source.width));
    const w = Math.max(1, Math.round(source.width * scale));
    const h = Math.max(1, Math.round(source.height * scale));
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const ctx = small.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    return { dataUrl: small.toDataURL('image/jpeg', quality), width: w, height: h };
}

/** get_mv_preview 用ポートを生成する */
export function createWebMcpPreviewCapturePort(deps: WebMcpRenderPortDeps): WebMcpPreviewCapturePort {
    return {
        isAvailable: () => !deps.isBusy(),
        captureJpeg: async (maxWidth = 512, timeSec?: number) => {
            try {
                const preset = resolvePreset(deps.getConfig());
                const still = await renderStillFrame(
                    deps,
                    preset.width,
                    preset.height,
                    Math.max(0, typeof timeSec === 'number' && Number.isFinite(timeSec) ? timeSec : deps.getPlayheadSec()),
                );
                const shot = downscaleToJpeg(still.canvas, maxWidth);
                return shot ? { ...shot, threeD: still.threeD } : null;
            } catch (e) {
                console.warn('[WebMcpRenderPorts] captureJpeg failed:', e);
                return null;
            }
        },
        captureFrames: async ({ startSec, endSec, fps, maxWidth }) => {
            try {
                const preset = resolvePreset(deps.getConfig());
                const frameCount = Math.max(1, Math.min(40, Math.ceil((endSec - startSec) * fps)));
                const frames: Array<{ dataUrl: string; width: number; height: number; timeSec: number; threeD?: Mv3DFrameDiagnostics }> = [];
                for (let i = 0; i < frameCount; i++) {
                    const timeSec = Math.min(endSec, startSec + i / fps);
                    const still = await renderStillFrame(deps, preset.width, preset.height, timeSec);
                    const shot = downscaleToJpeg(still.canvas, maxWidth);
                    if (shot) frames.push({ ...shot, timeSec, threeD: still.threeD });
                }
                return frames;
            } catch (e) {
                console.warn('[WebMcpRenderPorts] captureFrames failed:', e);
                return null;
            }
        },
    };
}

/** render_mv_video 用ポートを生成する */
export function createWebMcpVideoRenderPort(deps: WebMcpRenderPortDeps): WebMcpVideoRenderPort {
    return {
        isAvailable: () => !deps.isBusy(),
        renderVideo: async (opts) => {
            if (deps.isBusy()) {
                return { ok: false, error: '他のエクスポート処理が実行中です' };
            }
            deps.setBusy(true);
            try {
                const config = deps.getConfig();
                const { startSec, endSec, fps, width, height, bitrateBps, filename } = opts;
                const totalFrames = Math.max(1, Math.ceil((endSec - startSec) * fps));

                // ── 音声 WAV (Base64) ──
                let audioWavBase64 = '';
                const buffer = deps.getAudioBuffer();
                try {
                    if (buffer) {
                        audioWavBase64 = audioBufferToWavBase64(buffer, startSec, endSec, deps.getAudioGain());
                    } else {
                        const wavRes = await native.renderSessionAudioForMV(startSec, endSec);
                        if (typeof wavRes === 'string') audioWavBase64 = wavRes;
                    }
                } catch (e) {
                    console.warn('[WebMcpRenderPorts] audio encode failed, exporting without audio:', e);
                }

                // ── 素材の事前デコード ──
                if ((config.assets?.length ?? 0) > 0) {
                    await preloadAssets(config.assets ?? []);
                }

                // ── エンコーダ開始 (Web = WebCodecs / デスクトップ = OS 標準エンコーダ) ──
                const startOk = await native.startNativeMvExport(
                    width,
                    height,
                    fps,
                    bitrateBps,
                    filename,
                    audioWavBase64,
                );
                if (!startOk) {
                    return { ok: false, error: 'エンコーダの起動に失敗しました' };
                }

                // ── 決定論的フレームループ ──
                const offCanvas = document.createElement('canvas');
                offCanvas.width = width;
                offCanvas.height = height;
                const offCtx = offCanvas.getContext('2d');
                if (!offCtx) {
                    await native.cancelNativeMvExport().catch(() => { });
                    return { ok: false, error: 'Canvas 2D コンテキストを取得できませんでした' };
                }

                const BATCH_SIZE = 12;
                let batch: string[] = [];
                let batchStartIndex = 0;
                const analysis = deps.getAnalysis();

                for (let i = 0; i < totalFrames; i++) {
                    const frameT = startSec + i / fps;
                    const signals = buildOfflineSignals(deps.getBpm(), analysis, frameT, config.lyrics);
                    await renderFrameToCanvas({
                        canvas: offCanvas,
                        ctx: offCtx,
                        width,
                        height,
                        timeSec: frameT,
                        scenes: config.scenes,
                        lyrics: config.lyrics,
                        signals,
                        globalCss: config.globalCss,
                        phaserCanvas: deps.getPhaserCanvas(),
                        assets: config.assets ?? [],
                        lyricStyle: config.lyricStyle,
                        // 動画書き出しはライブ Phaser canvas に依存しない決定論的描画。
                        // 停止中の凍結フレーム連写や未初期化黒動画を構造的に防止する。
                        isOfflineRender: true,
                    });
                    batch.push(offCanvas.toDataURL('image/jpeg', 0.95));

                    if (batch.length >= BATCH_SIZE || i === totalFrames - 1) {
                        const appendOk = await native.appendNativeMvFrames(batch, batchStartIndex);
                        if (!appendOk) {
                            await native.cancelNativeMvExport().catch(() => { });
                            return { ok: false, error: `フレーム転送に失敗しました (index ${batchStartIndex})` };
                        }
                        batchStartIndex += batch.length;
                        batch = [];
                        // UI 更新の隙間を確保
                        await new Promise((r) => setTimeout(r, 0));
                    }
                }

                // ── 完了 (音声 Mux + 保存 / ダウンロード) ──
                const resultPath = await native.finishNativeMvExport();
                if (typeof resultPath === 'string' && resultPath.length > 0) {
                    return { ok: true, fileName: resultPath, frames: totalFrames, durationSec: endSec - startSec };
                }
                return { ok: false, error: '動画の保存に失敗しました' };
            } catch (err: unknown) {
                await native.cancelNativeMvExport().catch(() => { });
                const msg = err instanceof Error ? err.message : String(err);
                return { ok: false, error: msg };
            } finally {
                deps.setBusy(false);
            }
        },
    };
}
