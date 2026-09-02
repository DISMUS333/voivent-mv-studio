//==============================================================================
// MV 動画エクスポート設定モーダル。
// macOS AVFoundation（AVAssetWriter + AVMutableComposition）による
// 決定論的オフラインレンダリング（コマ落ち0・音ズレ0）で高品質 MP4 を生成する。
//==============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { IconClose, IconDownload, IconVideo } from '../Icons';
import { native } from '../../native';
import { formatTime } from '../../lib/music';
import { useI18n } from '../../i18n';
import { buildOfflineSignals } from './mvOfflineRender';
import { preloadAssets, renderFrameToCanvas } from './mvFrameRenderer';
import {
    getBitratePresets,
    getResolutionPresets,
    aspectDiagramBox,
    aspectLabel,
} from './mvExportPresets';
import { audioBufferToWavBase64 } from './mvWavUtils';
import type { Analysis } from '../../types';
import type {
    LyricGlobalStyle,
    LyricItem,
    MvImageAsset,
    MvScene,
} from './types';

interface MvExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** セッション全体の長さ（秒） */
    sessionDuration: number;
    /** 録画対象のサンドボックス DOM ホスト（後方互換） */
    sandboxHostRef?: React.MutableRefObject<HTMLDivElement | null>;
    /**
     * Phaser 4 の WebGL canvas ノード（オプション）。
     */
    phaserCanvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
    /** ファイル名に使用するタイトル */
    title?: string;
    /** 選択中の解像度プリセット ID（プレビューフレームと双方向同期・親管理） */
    selectedResolutionId: string;
    /** 解像度プリセット選択変更（選択即座にプレビューフレームへ反映） */
    onSelectResolution: (id: string) => void;
    /** テンポ BPM */
    bpm?: number;
    /** 歌詞リスト */
    lyrics?: LyricItem[];
    /** シーン一覧 */
    scenes?: MvScene[];
    /** 素材ライブラリ */
    assets?: MvImageAsset[];
    /** 歌詞スタイル */
    lyricStyle?: LyricGlobalStyle;
    /** グローバル CSS */
    globalCss?: string;
    /** 音声解析データ */
    analysis?: Analysis | null;
    /** 外部持ち込み音源の AudioBuffer (存在時はこの音源を WAV エンコードして動画に結合) */
    importedAudioBuffer?: AudioBuffer | null;
    /** 外部持ち込み音源のエクスポート用マスターゲイン (0.0〜2.0) */
    audioGain?: number;
}

export const MvExportModal: React.FC<MvExportModalProps> = ({
    isOpen,
    onClose,
    sessionDuration,
    phaserCanvasRef,
    title = 'Voivent_MV',
    selectedResolutionId,
    onSelectResolution,
    bpm = 120,
    lyrics = [],
    scenes = [],
    assets = [],
    lyricStyle,
    globalCss = '',
    analysis = null,
    importedAudioBuffer = null,
    audioGain = 1.0,
}) => {
    const { t } = useI18n();
    const selectedResolution = selectedResolutionId;
    const setSelectedResolution = onSelectResolution;
    const [selectedBitrate, setSelectedBitrate] = useState(getBitratePresets()[1].id);
    const [rangeType, setRangeType] = useState<'all' | 'custom'>('all');
    const [startSec, setStartSec] = useState(0);
    const [endSec, setEndSec] = useState(Math.ceil(sessionDuration));
    const [isExporting, setIsExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('');
    const [savedPath, setSavedPath] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const isCancelledRef = useRef(false);

    // モーダルが開かれたら前回の完了状態やエラーをリセット
    useEffect(() => {
        if (isOpen) {
            setIsExporting(false);
            setProgress(0);
            setStatusText('');
            setSavedPath(null);
            setErrorMessage(null);
            isCancelledRef.current = false;
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const resetExportState = () => {
        setIsExporting(false);
        setProgress(0);
        setStatusText('');
        setSavedPath(null);
        setErrorMessage(null);
    };

    /**
     * 決定論的オフラインレンダリング ＋ macOS AVFoundation エクスポート
     */
    const executeExport = async () => {
        if (isExporting) return;

        const preset = getResolutionPresets().find((p) => p.id === selectedResolution) ?? getResolutionPresets()[0];
        const bitratePreset = getBitratePresets().find((b) => b.id === selectedBitrate) ?? getBitratePresets()[1];
        const s0 = rangeType === 'all' ? 0 : Math.max(0, startSec);
        const s1 = rangeType === 'all'
            ? Math.max(0.1, sessionDuration)
            : Math.max(s0 + 0.1, endSec);
        const fps = 30;
        const totalFrames = Math.max(1, Math.ceil((s1 - s0) * fps));

        setIsExporting(true);
        setProgress(0);
        setSavedPath(null);
        setErrorMessage(null);
        isCancelledRef.current = false;

        try {
            // ── Step 1: 音声レンダリング（セッション WAV Base64 生成） ──
            let audioWavBase64 = '';
            if (importedAudioBuffer) {
                setStatusText(t.exStatusPrepareAudio);
                try {
                    audioWavBase64 = audioBufferToWavBase64(importedAudioBuffer, s0, s1, audioGain);
                } catch (e) {
                    console.warn('[MvExportModal] Failed to encode imported audio to WAV:', e);
                }
            } else {
                setStatusText(t.exStatusRenderAudio);
                try {
                    const wavRes = await native.renderSessionAudioForMV(s0, s1);
                    if (typeof wavRes === 'string') {
                        audioWavBase64 = wavRes;
                    }
                } catch (e) {
                    console.warn('[MvExportModal] Audio pre-render failed, exporting video without audio:', e);
                }
            }

            if (isCancelledRef.current) return;

            // ── Step 1.5: 背景素材の事前デコード ──
            // 初回フレームで data URL デコードが間に合わず背景が真っ黒に
            // なる問題の対策。フレームループ前に全素材を暖気しておく。
            if (assets.length > 0) {
                setStatusText(t.exStatusDecodeAssets);
                await preloadAssets(assets);
                if (isCancelledRef.current) return;
            }

            // ── Step 2: ネイティブ AVFoundation エクスポート開始 ──
            setStatusText(t.exStatusInitEncoder);
            const safeTitle = (title || 'Voivent_Session').replace(/[\s\\/:*?"<>|]+/g, '_');
            const outFilename = `${safeTitle}_${preset.id}.mp4`;

            const startOk = await native.startNativeMvExport(
                preset.width,
                preset.height,
                fps,
                bitratePreset.bps,
                outFilename,
                audioWavBase64,
            );

            if (!startOk) {
                throw new Error(t.exErrLauncher);
            }

            // ── Step 3: 決定論的フレームレンダリングループ ──
            const offCanvas = document.createElement('canvas');
            offCanvas.width = preset.width;
            offCanvas.height = preset.height;
            const offCtx = offCanvas.getContext('2d');
            if (!offCtx) {
                throw new Error(t.exErrCanvas2d);
            }

            const BATCH_SIZE = 12;
            let currentBatch: string[] = [];
            let batchStartIndex = 0;

            for (let i = 0; i < totalFrames; i++) {
                if (isCancelledRef.current) {
                    await native.cancelNativeMvExport();
                    setStatusText(t.exStatusAborted);
                    setIsExporting(false);
                    return;
                }

                const frameT = s0 + i / fps;
                const signals = buildOfflineSignals(bpm, analysis, frameT, lyrics);

                await renderFrameToCanvas({
                    canvas: offCanvas,
                    ctx: offCtx,
                    width: preset.width,
                    height: preset.height,
                    timeSec: frameT,
                    scenes,
                    lyrics,
                    signals,
                    globalCss,
                    phaserCanvas: phaserCanvasRef?.current,
                    assets,
                    lyricStyle,
                    // 動画書き出しはライブ Phaser canvas に依存しない決定論的描画。
                    // 停止中の凍結フレーム連写（カーソル位置の静止動画化）や
                    // 未初期化・未知テーマ起因の黒動画を構造的に防止する。
                    isOfflineRender: true,
                });

                const frameB64 = offCanvas.toDataURL('image/jpeg', 0.95);
                currentBatch.push(frameB64);

                if (currentBatch.length >= BATCH_SIZE || i === totalFrames - 1) {
                    const appendOk = await native.appendNativeMvFrames(currentBatch, batchStartIndex);
                    if (!appendOk) {
                        throw new Error(t.exErrAppendFrame(batchStartIndex));
                    }
                    batchStartIndex += currentBatch.length;
                    currentBatch = [];

                    const pct = Math.round(((i + 1) / totalFrames) * 90);
                    setProgress(pct);
                    setStatusText(t.exStatusFrames(i + 1, totalFrames, pct));

                    // UI 更新の隙間を確保
                    await new Promise((r) => setTimeout(r, 0));
                }
            }

            // ── Step 4: ネイティブ完了・音声 Mux ──
            setStatusText(t.exStatusMux);
            setProgress(95);

            const resultPath = await native.finishNativeMvExport();
            if (typeof resultPath === 'string' && resultPath.length > 0) {
                setProgress(100);
                setSavedPath(resultPath);
                setStatusText(t.exStatusDone);
            } else {
                throw new Error(t.exErrFinalize);
            }
        } catch (err: unknown) {
            console.error('[MvExportModal] Export failed:', err);
            const msg = err instanceof Error ? err.message : t.exErrUnknown;
            setErrorMessage(msg);
            setStatusText(t.exStatusError);
            await native.cancelNativeMvExport().catch(() => { });
        } finally {
            setIsExporting(false);
        }
    };

    const handleCancel = async () => {
        if (isExporting) {
            isCancelledRef.current = true;
            await native.cancelNativeMvExport().catch(() => { });
            setIsExporting(false);
            setStatusText(t.exStatusCancelled);
        } else {
            onClose();
        }
    };

    const activePreset = getResolutionPresets().find((p) => p.id === selectedResolution) ?? getResolutionPresets()[0];
    const s0 = rangeType === 'all' ? 0 : Math.max(0, startSec);
    const s1 = rangeType === 'all' ? Math.max(0.1, sessionDuration) : Math.max(s0 + 0.1, endSec);
    const totalSec = Math.max(0.1, s1 - s0);

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.78)',
                backdropFilter: 'blur(10px)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget && !isExporting) onClose();
            }}
        >
            <div
                style={{
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: 14,
                    width: '100%',
                    maxWidth: 580,
                    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                {/* ヘッダー */}
                <div
                    style={{
                        padding: '16px 20px',
                        borderBottom: '1px solid #21262d',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <IconVideo size={20} color="#38bdf8" />
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: '#f0f6fc' }}>
                                {t.exTitle}
                            </div>
                            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 1 }}>
                                {t.exSubtitle}
                            </div>
                        </div>
                    </div>
                    {!isExporting && (
                        <button
                            onClick={onClose}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#8b949e',
                                cursor: 'pointer',
                                padding: 4,
                                display: 'flex',
                            }}
                        >
                            <IconClose size={18} />
                        </button>
                    )}
                </div>

                {/* 本文 */}
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18, maxHeight: 'calc(85vh - 120px)', overflowY: 'auto' }}>
                    {/* 解像度プリセット */}
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9', marginBottom: 8 }}>
                            {t.exResolution}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                            {getResolutionPresets().map((preset) => {
                                const isSel = preset.id === selectedResolution;
                                const dim = aspectDiagramBox(preset.width, preset.height, 16, 16);
                                return (
                                    <button
                                        key={preset.id}
                                        disabled={isExporting}
                                        onClick={() => setSelectedResolution(preset.id)}
                                        style={{
                                            background: isSel ? 'rgba(56, 189, 248, 0.12)' : '#161b22',
                                            border: `1px solid ${isSel ? '#38bdf8' : '#30363d'}`,
                                            borderRadius: 8,
                                            padding: '10px 12px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'flex-start',
                                            gap: 4,
                                            cursor: isExporting ? 'not-allowed' : 'pointer',
                                            textAlign: 'left',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: isSel ? '#38bdf8' : '#f0f6fc' }}>
                                                {preset.label}
                                            </span>
                                            <div
                                                style={{
                                                    width: dim.width,
                                                    height: dim.height,
                                                    border: `1px solid ${isSel ? '#38bdf8' : '#8b949e'}`,
                                                    borderRadius: 2,
                                                    background: isSel ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                                                }}
                                            />
                                        </div>
                                        <span style={{ fontSize: 10, color: '#8b949e' }}>
                                            {preset.width} × {preset.height} ({aspectLabel(preset.width, preset.height)})
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 画質（ビットレート） */}
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9', marginBottom: 8 }}>
                            {t.exBitrate}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                            {getBitratePresets().map((bp) => {
                                const isSel = bp.id === selectedBitrate;
                                return (
                                    <button
                                        key={bp.id}
                                        disabled={isExporting}
                                        onClick={() => setSelectedBitrate(bp.id)}
                                        style={{
                                            background: isSel ? 'rgba(56, 189, 248, 0.12)' : '#161b22',
                                            border: `1px solid ${isSel ? '#38bdf8' : '#30363d'}`,
                                            borderRadius: 8,
                                            padding: '8px 12px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'flex-start',
                                            gap: 2,
                                            cursor: isExporting ? 'not-allowed' : 'pointer',
                                            textAlign: 'left',
                                        }}
                                    >
                                        <span style={{ fontSize: 12, fontWeight: 700, color: isSel ? '#38bdf8' : '#f0f6fc' }}>
                                            {bp.label}
                                        </span>
                                        <span style={{ fontSize: 10, color: '#8b949e' }}>{bp.subLabel}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 書き出し範囲 */}
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9', marginBottom: 8 }}>
                            {t.exRange}
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#f0f6fc', cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    name="rangeType"
                                    checked={rangeType === 'all'}
                                    disabled={isExporting}
                                    onChange={() => setRangeType('all')}
                                />
                                {t.exFullRange(formatTime(sessionDuration))}
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#f0f6fc', cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    name="rangeType"
                                    checked={rangeType === 'custom'}
                                    disabled={isExporting}
                                    onChange={() => setRangeType('custom')}
                                />
                                {t.exPartialRange}
                            </label>
                        </div>
                        {rangeType === 'custom' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                    type="number"
                                    min={0}
                                    max={sessionDuration}
                                    step={0.1}
                                    value={startSec}
                                    disabled={isExporting}
                                    onChange={(e) => setStartSec(parseFloat(e.target.value) || 0)}
                                    style={{
                                        background: '#161b22',
                                        border: '1px solid #30363d',
                                        color: '#f0f6fc',
                                        borderRadius: 6,
                                        padding: '4px 8px',
                                        fontSize: 12,
                                        width: 80,
                                    }}
                                />
                                <span style={{ color: '#8b949e', fontSize: 12 }}>〜</span>
                                <input
                                    type="number"
                                    min={startSec + 0.1}
                                    max={sessionDuration}
                                    step={0.1}
                                    value={endSec}
                                    disabled={isExporting}
                                    onChange={(e) => setEndSec(parseFloat(e.target.value) || 1)}
                                    style={{
                                        background: '#161b22',
                                        border: '1px solid #30363d',
                                        color: '#f0f6fc',
                                        borderRadius: 6,
                                        padding: '4px 8px',
                                        fontSize: 12,
                                        width: 80,
                                    }}
                                />
                                <span style={{ color: '#8b949e', fontSize: 11 }}>
                                    {t.exDuration(formatTime(totalSec))}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* 進捗バー & ステータス表示 */}
                    {(isExporting || savedPath || errorMessage) && (
                        <div
                            style={{
                                background: '#161b22',
                                border: '1px solid #30363d',
                                borderRadius: 8,
                                padding: 12,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                <span style={{ color: errorMessage ? '#f87171' : savedPath ? '#4ade80' : '#38bdf8', fontWeight: 700 }}>
                                    {statusText}
                                </span>
                                <span style={{ color: '#8b949e' }}>{progress}%</span>
                            </div>
                            <div style={{ width: '100%', height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
                                <div
                                    style={{
                                        width: `${progress}%`,
                                        height: '100%',
                                        background: errorMessage ? '#ef4444' : savedPath ? '#22c55e' : '#38bdf8',
                                        transition: 'width 0.2s ease',
                                    }}
                                />
                            </div>
                            {savedPath && (
                                <div style={{ fontSize: 11, color: '#8b949e', wordBreak: 'break-all' }}>
                                    {t.exSaveTarget} <span style={{ color: '#f0f6fc', fontWeight: 600 }}>{savedPath}</span>
                                </div>
                            )}
                            {errorMessage && (
                                <div style={{ fontSize: 11, color: '#f87171' }}>
                                    {errorMessage}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* フッターアクション */}
                <div
                    style={{
                        padding: '14px 20px',
                        borderTop: '1px solid #21262d',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: '#090d13',
                    }}
                >
                    <div style={{ fontSize: 11, color: '#8b949e' }}>
                        {t.exFormat} <strong style={{ color: '#f0f6fc' }}>MP4 (H.264 / AAC)</strong> / {activePreset.width}×{activePreset.height}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button
                            onClick={handleCancel}
                            style={{
                                background: '#21262d',
                                border: '1px solid #30363d',
                                color: '#c9d1d9',
                                borderRadius: 6,
                                padding: '8px 14px',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            {t.exCancelOrClose(isExporting)}
                        </button>
                        {savedPath ? (
                            <>
                                <button
                                    onClick={() => native.revealInFinder(savedPath)}
                                    style={{
                                        background: '#238636',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        color: '#e7edf4',
                                        borderRadius: 6,
                                        padding: '8px 14px',
                                        fontSize: 12,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                    }}
                                >
                                    {t.exShowInFinder}
                                </button>
                                <button
                                    onClick={resetExportState}
                                    style={{
                                        background: '#1f6feb',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        color: '#e7edf4',
                                        borderRadius: 6,
                                        padding: '8px 14px',
                                        fontSize: 12,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                    }}
                                >
                                    {t.exExportAgain}
                                </button>
                            </>
                        ) : (
                            <button
                                disabled={isExporting}
                                onClick={executeExport}
                                style={{
                                    background: isExporting ? '#1f6feb88' : '#238636',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#e7edf4',
                                    borderRadius: 6,
                                    padding: '8px 16px',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: isExporting ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                }}
                            >
                                <IconDownload size={14} />
                                {t.exStartBtn(isExporting)}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
