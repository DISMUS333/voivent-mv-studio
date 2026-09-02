//==============================================================================
// Web 版 MV エクスポートのデスクトップ契約アダプタ。
//
// webVideoExporter の実装を、デスクトップ native.ts と完全に同じ引数順・
// 戻り値契約で公開する。nativeShim からこの関数へ委譲することで、
// MvExportModal 側は無変更のまま Web ブラウザで MP4/WebM エクスポートが成立する。
//
// 注意: このファイル名は `native` で終わらないため、vite.config.web.ts の
// NATIVE_ALIAS_FIND (/^(?:\.\/|\.\.\/)*native$/) にはマッチしない。
//==============================================================================
import {
    appendWebMvFrames,
    cancelWebMvExport,
    finishWebMvExport,
    startWebMvExport,
} from './webVideoExporter';

/** startNativeMvExport と同一契約。成功時はコンテナ種別 ('mp4' | 'webm')、失敗時 false */
export function webStartNativeMvExport(
    width: number,
    height: number,
    fps: number,
    bitrateBps: number,
    filename: string,
    audioWavBase64?: string,
): Promise<string | false> {
    return startWebMvExport(width, height, fps, bitrateBps, filename, audioWavBase64);
}

/** appendNativeMvFrames と同一契約 (JPEG Base64 バッチ + 開始フレーム索引) */
export function webAppendNativeMvFrames(
    frames: string[],
    startFrameIndex: number,
): Promise<boolean> {
    return appendWebMvFrames(frames, startFrameIndex);
}

/** finishNativeMvExport と同一契約。成功時はダウンロードしたファイル名、失敗時 false */
export function webFinishNativeMvExport(): Promise<string | false> {
    return finishWebMvExport();
}

/** cancelNativeMvExport と同一契約 */
export function webCancelNativeMvExport(): Promise<boolean> {
    return cancelWebMvExport();
}
