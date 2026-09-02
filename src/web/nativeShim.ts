//==============================================================================
// Web ビルド用のネイティブブリッジ Shim。
//
// 背景:
//  - デスクトップ版の native.ts は import 時に window.__JUCE__ (JUCE WebView
//    interop) へアクセスするため、通常ブラウザでは import した瞬間にクラッシュする
//  - Web 版 (vite.config.web.ts) では resolve.alias により `**/native` の import
//    をこのファイルへ差し替えることで、MV コンポーネント群を無変更で再利用する
//
// 委譲先:
//  - トランスポート (再生/停止/シーク) → WebAudioEngine (Web Audio API)
//  - スペクトラム → AnalyserNode の実測 FFT (dB 配列、デスクトップと同じ契約)
//  - GIF 保存 → ブラウザダウンロード
//  - MV 動画エクスポート → WebCodecs + mediabunny (webMvExportBridge 経由)
//  - 対応外機能 (ASR 等) は明確に失敗を返す
//==============================================================================
import { getWebAudioEngine } from './webAudioEngine';
import { downloadBase64 } from './downloadUtils';
import {
    webAppendNativeMvFrames,
    webCancelNativeMvExport,
    webFinishNativeMvExport,
    webStartNativeMvExport,
} from './webMvExportBridge';
import { transcribeLongAudio } from './asrChunker';
import type {
    VisemeKind,
    MvSceneUpdatedDispatcher,
    MvSceneUpdatedPayload,
} from '../types';

export type {
    VisemeKind,
    MvSceneUpdatedDispatcher,
    MvSceneUpdatedPayload,
};

export const isJuce = false;

export function buildWebNativeApi(): Record<string | symbol, unknown> {
    const engine = () => getWebAudioEngine();
    return {
        // ── トランスポート (MvWorkspace / usePhrasePreview / WebMCP から利用) ──
        setSessionPosition: (sec: number) => Promise.resolve(engine().seek(sec)),
        startSessionPlayback: () => Promise.resolve(engine().play()),
        stopSessionPlayback: () => Promise.resolve(engine().pause()),
        getStatus: () => Promise.resolve(engine().getStatus()),

        // ── リアルタイムシグナル (useMvAudioSignals から 30fps ポーリング) ──
        getTrackSpectrum: (_trackIndex: number) =>
            Promise.resolve(engine().getSpectrumDb()),
        getTrackViseme: (_trackIndex: number) =>
            Promise.resolve({
                viseme: 'sil' as const,
                visemeStrength: 0,
                pitchHz: 0,
                time: engine().position(),
                playing: engine().isPlaying(),
                spectrumValid: true,
            }),

        // ── 保存系 (GIF エクスポートはブラウザダウンロードで成立させる) ──
        saveExportedVideo: (base64Data: string, filename: string) =>
            Promise.resolve(downloadBase64(base64Data, filename)),

        // ── 音声レンダリング (読み込み済み AudioBuffer を WAV Base64 化) ──
        renderSessionAudioForMV: (startSec?: number, endSec?: number) =>
            Promise.resolve(engine().renderWavBase64(startSec, endSec)),

        // ── 設定の C++ 同期 (Web 版は localStorage のみで成立済みのため no-op) ──
        setMvConfig: (_jsonStr: string) => Promise.resolve(true),

        // ── MV 動画エクスポート (WebCodecs + mediabunny による MP4/WebM 出力) ──
        // デスクトップ AVFoundation エクスポートと同一契約をブラウザで再現する。
        startNativeMvExport: (
            width: number,
            height: number,
            fps: number,
            bitrateBps: number,
            filename: string,
            audioWavBase64?: string,
        ) => webStartNativeMvExport(width, height, fps, bitrateBps, filename, audioWavBase64),
        appendNativeMvFrames: (frames: string[], startFrameIndex: number) =>
            webAppendNativeMvFrames(frames, startFrameIndex),
        finishNativeMvExport: () => webFinishNativeMvExport(),
        cancelNativeMvExport: () => webCancelNativeMvExport(),

        // ── ボーカル ASR (Cloudflare Workers AI @cf/openai/whisper-large-v3-turbo チャンク並列転送) ──
        runVocalAsr: async (base64Wav: string, lang?: string) => {
            try {
                const lyrics = await transcribeLongAudio(base64Wav, lang || 'ja');
                return JSON.stringify(lyrics);
            } catch (err) {
                console.error('[Web ASR] Fetch error:', err);
                return '[]';
            }
        },

        // ── 対応外機能: デスクトップ専用 (Finder表示など) ──
        revealInFinder: () => Promise.resolve(false),
        openExternalUrl: (url: string) => {
            if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
            return Promise.resolve(true);
        },
    };
}

/**
 * unknown なメンバへのアクセスにも安全な no-op を返すプロキシ。
 * Web グラフに将来新しいコンポーネントが入っても import 時クラッシュしない。
 */
export const native = new Proxy(
    buildWebNativeApi(),
    {
        get(target, prop) {
            if (prop in target) return target[prop];
            // 既知の失敗系 API 以外は「未対応」として false を返す
            return (..._args: unknown[]) => Promise.resolve(false);
        },
    },
) as Record<string, (...args: unknown[]) => Promise<unknown>>;
