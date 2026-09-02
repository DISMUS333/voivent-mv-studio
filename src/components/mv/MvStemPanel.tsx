//==============================================================================
// ステム分離パネル (MV ワークスペースの機能モーダル)。
// 分離実行 / 進捗 / 解析サマリ / stem 試聴 / WAV 保存を提供する。
// 分離 PCM は Worker 内にのみ存在するため、WAV 保存時のみ都度生成する。
//==============================================================================
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    IconClose,
    IconDownload,
    IconPlay,
    IconPause,
    IconAlertTriangle,
    IconSpectrum,
    IconZap,
} from '../Icons';
import { useTheme } from '../../hooks/useTheme';
import { withAlpha } from '../../theme';
import { useI18n } from '../../i18n';
import { useStemSeparation, type UseStemSeparationResult } from './stemAnalysis/useStemSeparation';
import { STEM_KINDS, type StemKind } from './stemAnalysis/types';
import type { StemAnalysis } from './stemAnalysis/types';



interface MvStemPanelProps {
    isOpen: boolean;
    onClose: () => void;
    audioBuffer: AudioBuffer | null;
    /** 親 (MvWorkspace) から渡される共通の stemState (WebMCP と同一ソース) */
    stemState?: UseStemSeparationResult;
    /** 解析完了時にワークスペースへ通知 (シグナル強化の有効化) */
    onAnalysisReady?: (a: StemAnalysis | null) => void;
}

export const MvStemPanel: React.FC<MvStemPanelProps> = ({
    isOpen,
    onClose,
    audioBuffer,
    stemState: passedStemState,
    onAnalysisReady,
}) => {
    const { theme } = useTheme();
    const { t } = useI18n();
    const internalStemState = useStemSeparation(passedStemState ? null : audioBuffer);
    const stem = passedStemState ?? internalStemState;
    const [playingKind, setPlayingKind] = useState<StemKind | null>(null);
    const [loadingKind, setLoadingKind] = useState<StemKind | null>(null);
    const [currentPreviewTime, setCurrentPreviewTime] = useState(0);
    const [previewDuration, setPreviewDuration] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    /** ステムごとのピーク配列 (分離完了後にバックグラウンドで取得) */
    const [stemPeaks, setStemPeaks] = useState<Partial<Record<StemKind, Float32Array>>>({});

    // 解析完了をワークスペースへ通知 (シグナル強化のトリガー)
    useEffect(() => {
        if (stem.phase === 'ready') onAnalysisReady?.(stem.analysis);
    }, [stem.phase, stem.analysis, onAnalysisReady]);

    // 分離完了時にすべてのステムのピークをバックグラウンドで取得 (WAV 生成なし・数KB)
    useEffect(() => {
        if (stem.phase !== 'ready' || stem.isPcmReleased) return;
        let cancelled = false;
        const fetchAll = async () => {
            const results: Partial<Record<StemKind, Float32Array>> = {};
            for (const kind of STEM_KINDS) {
                try {
                    const peaks = await stem.getPeaks(kind, 600);
                    if (!cancelled) results[kind] = peaks;
                } catch { /* PCM 解放済み等は無視 */ }
            }
            if (!cancelled) setStemPeaks(results);
        };
        void fetchAll();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stem.phase, stem.isPcmReleased]);

    // パネル閉じ / アンマウント時に再生を停止
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const stopPreview = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current = null;
        }
        setPlayingKind(null);
        setLoadingKind(null);
        setCurrentPreviewTime(0);
    };

    const handleSeek = (timeSec: number) => {
        const clamped = Math.max(0, Math.min(previewDuration || audioBuffer?.duration || 0, timeSec));
        if (audioRef.current) {
            audioRef.current.currentTime = clamped;
        }
        setCurrentPreviewTime(clamped);
    };

    const handlePreview = async (kind: StemKind) => {
        if (!audioBuffer) return;
        if (playingKind === kind) {
            stopPreview();
            return;
        }
        stopPreview();
        setLoadingKind(kind);
        try {
            const wav = await stem.exportWav(kind);
            const blob = new Blob([wav], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const el = new Audio(url);
            el.ontimeupdate = () => {
                setCurrentPreviewTime(el.currentTime);
            };
            el.onloadedmetadata = () => {
                if (el.duration && isFinite(el.duration)) {
                    setPreviewDuration(el.duration);
                }
            };
            el.onended = () => {
                setPlayingKind(null);
                setCurrentPreviewTime(0);
                URL.revokeObjectURL(url);
                if (audioRef.current === el) audioRef.current = null;
            };
            el.onerror = (e) => {
                console.error('[stem:preview] Audio playback error:', e);
                setPlayingKind(null);
                setLoadingKind(null);
                setCurrentPreviewTime(0);
                URL.revokeObjectURL(url);
            };
            audioRef.current = el;
            setLoadingKind(null);
            setPlayingKind(kind);
            setPreviewDuration(audioBuffer.duration);
            setCurrentPreviewTime(0);
            await el.play();
        } catch (err) {
            console.error('[stem:preview] Play failed:', err);
            setLoadingKind(null);
            setPlayingKind(null);
            setCurrentPreviewTime(0);
        }
    };

    const handleSaveWav = async (kind: StemKind) => {
        try {
            const wav = await stem.exportWav(kind);
            const blob = new Blob([wav], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `stem_${kind}.wav`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } catch { /* 保存失敗は静かに無視 */ }
    };

    const getStemLabel = (kind: StemKind) => {
        if (kind === 'vocals') return t.stemVocals;
        if (kind === 'drums') return t.stemDrums;
        if (kind === 'bass') return t.stemBass;
        return t.stemOther;
    };

    const getStemRoleLabel = (kind: StemKind) => {
        if (kind === 'drums') return t.stemDrumsRole;
        if (kind === 'vocals') return t.stemVocalsRole;
        if (kind === 'bass') return t.stemBassRole;
        return t.stemOtherRole;
    };

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: withAlpha(theme.bgApp, 0.7),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div style={{
                width: 420, maxHeight: '80vh', overflow: 'auto',
                background: theme.bgPanel, border: `1px solid ${theme.borderLight}`, borderRadius: 10,
                padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <IconSpectrum size={14} color={theme.accent} />
                        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.05em' }}>STEM SEPARATION</span>
                    </div>
                    <button onClick={onClose} title={t.stemCloseHint} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', padding: 2 }}>
                        <IconClose size={12} color={theme.textMuted} />
                    </button>
                </div>

                {!audioBuffer && (
                    <div style={{ fontSize: 10.5, color: theme.textMuted, fontWeight: 700 }}>
                        {t.stemNoAudio}
                    </div>
                )}

                {audioBuffer && stem.phase === 'idle' && (
                    <>
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 7,
                            background: withAlpha(theme.warning, 0.08),
                            border: `1px solid ${withAlpha(theme.warning, 0.28)}`,
                            borderRadius: 6, padding: '7px 9px',
                        }}>
                            <IconAlertTriangle size={13} color={theme.warning} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <div style={{ fontSize: 9.5, lineHeight: 1.4, color: theme.warning, fontWeight: 900 }}>
                                    {t.stemResourceWarning}
                                </div>
                                <div style={{ fontSize: 8.5, lineHeight: 1.4, color: theme.textMuted, fontWeight: 700 }}>
                                    {t.stemResourceWarningDetails}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                if (window.confirm(t.stemStartConfirm)) void stem.run();
                            }}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                background: theme.accent, color: theme.bgApp,
                                border: 'none', borderRadius: 6, padding: '8px 12px',
                                fontSize: 11, fontWeight: 900, cursor: 'pointer',
                            }}
                        >
                            <IconZap size={12} color={theme.bgApp} />
                            <span>{t.stemStartSeparation}</span>
                        </button>
                    </>
                )}

                {stem.phase === 'loading-model' && (
                    stem.buildingSession ? (
                        <div>
                            <div style={{ fontSize: 10.5, fontWeight: 800, color: theme.textMain, marginBottom: 4 }}>
                                {t.stemEnginePreparing}
                            </div>
                            <ProgressBar value={undefined} theme={theme} indeterminate />
                        </div>
                    ) : (
                        <div>
                            <div style={{ fontSize: 10.5, fontWeight: 800, color: theme.textMain, marginBottom: 4 }}>
                                {t.stemModelDownloading(Math.round(stem.modelProgress * 100))}
                            </div>
                            <ProgressBar value={stem.modelProgress} theme={theme} />
                        </div>
                    )
                )}

                {stem.phase === 'separating' && (
                    <div>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: theme.textMain, marginBottom: 4 }}>
                            {t.stemSeparating(Math.round(stem.separateProgress * 100))}
                        </div>
                        <ProgressBar value={stem.separateProgress} theme={theme} />
                    </div>
                )}

                {stem.phase === 'error' && (
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: theme.danger }}>
                        {t.stemError(stem.errorText || '')}
                    </div>
                )}

                {stem.phase === 'ready' && stem.analysis && (
                    <>
                        <div style={{
                            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
                            fontSize: 10, fontWeight: 800, color: theme.textMain,
                        }}>
                            <MetricCard label={t.stemEstimatedBpm} value={stem.analysis.proposedBpm > 0 ? `${stem.analysis.proposedBpm}` : 'N/A'} theme={theme} />
                            <MetricCard label={t.stemBeatConfidence} value={`${Math.round(stem.analysis.beatConfidence * 100)}%`} theme={theme} />
                            <MetricCard label={t.stemOnsetCount} value={`${stem.analysis.drumOnsets.length}`} theme={theme} />
                            <MetricCard label={t.stemVocalSegments} value={`${stem.analysis.vocalSegments.length}`} theme={theme} />
                            {stem.elapsedSec != null && <MetricCard label={t.stemProcTime} value={`${stem.elapsedSec}s`} theme={theme} />}
                            {stem.backend && <MetricCard label="backend" value={stem.backend} theme={theme} />}
                        </div>

                        {stem.analysis.proposedBpm > 0 && Math.abs(stem.analysis.proposedBpm - (audioBuffer ? 0 : 0)) < 0 && null}

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {STEM_KINDS.map((kind) => (
                                <div key={kind} style={{
                                    display: 'flex', flexDirection: 'column', gap: 4,
                                    background: theme.bgControl, border: `1px solid ${theme.border}`,
                                    borderRadius: 5, padding: '5px 8px',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ width: 64, fontWeight: 900, fontSize: 10, color: theme.textMain }}>
                                            {getStemLabel(kind)}
                                        </span>
                                        {stem.isPcmReleased ? (
                                            <span style={{ fontSize: 9, color: theme.textMuted, flex: 1 }}>
                                                {t.stemMemoryReleased}
                                            </span>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => void handlePreview(kind)}
                                                    title={playingKind === kind ? t.stemPreviewStop : t.playTitle}
                                                    style={{
                                                        background: playingKind === kind ? withAlpha(theme.accentInfo, 0.2) : 'none',
                                                        border: `1px solid ${playingKind === kind ? theme.accentInfo : theme.borderLight}`,
                                                        borderRadius: 4,
                                                        color: theme.accentInfo,
                                                        cursor: 'pointer',
                                                        padding: '2px 6px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                        transition: 'all 0.15s ease',
                                                    }}
                                                >
                                                    {loadingKind === kind ? (
                                                        <span style={{ fontSize: 9, fontWeight: 800 }}>{t.stemPreviewGenerating}</span>
                                                    ) : playingKind === kind ? (
                                                        <>
                                                            <IconPause size={10} color={theme.accentInfo} />
                                                            <span style={{ fontSize: 9, fontWeight: 900 }}>{t.stemPreviewStop}</span>
                                                        </>
                                                    ) : (
                                                        <IconPlay size={10} color={theme.accentInfo} />
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => void handleSaveWav(kind)}
                                                    title={t.stemSaveWav}
                                                    style={{ background: 'none', border: `1px solid ${theme.borderLight}`, borderRadius: 4, color: theme.textMain, cursor: 'pointer', padding: '2px 6px', display: 'flex', alignItems: 'center' }}
                                                >
                                                    <IconDownload size={10} color={theme.textMain} />
                                                </button>
                                            </>
                                        )}
                                        <span style={{ fontSize: 9, color: theme.textMuted, marginLeft: 'auto' }}>
                                            {getStemRoleLabel(kind)}
                                        </span>
                                    </div>
                                    {/* ミニ波形キャンバス */}
                                    {stemPeaks[kind] && (
                                        <StemWaveform
                                            peaks={stemPeaks[kind]!}
                                            duration={audioBuffer?.duration ?? 0}
                                            currentTime={playingKind === kind ? currentPreviewTime : -1}
                                            accentColor={theme.accentInfo}
                                            bgColor={theme.bgInset}
                                            waveColor={kind === 'vocals' ? theme.accentSecondary
                                                : kind === 'drums' ? theme.accent
                                                : kind === 'bass' ? theme.warning
                                                : theme.textSubtle}
                                            onSeek={(t) => {
                                                if (playingKind === kind) handleSeek(t);
                                                else void handlePreview(kind).then(() => handleSeek(t));
                                            }}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* 🎵 試聴再生中のタイムライン・シークバー */}
                        {playingKind && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                background: withAlpha(theme.accentInfo, 0.08),
                                border: `1px solid ${withAlpha(theme.accentInfo, 0.35)}`,
                                borderRadius: 6,
                                padding: '8px 10px',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: 10, fontWeight: 900, color: theme.accentInfo }}>
                                        {t.stemPlaying(getStemLabel(playingKind))}
                                    </span>
                                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: theme.textMain, fontWeight: 800 }}>
                                        {formatTime(currentPreviewTime)} / {formatTime(previewDuration || audioBuffer?.duration || 0)}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <button
                                        onClick={() => handleSeek(Math.max(0, currentPreviewTime - 5))}
                                        title={t.stemRewind5s}
                                        style={{
                                            background: theme.bgControl,
                                            border: `1px solid ${theme.border}`,
                                            borderRadius: 3,
                                            color: theme.textMain,
                                            fontSize: 9,
                                            fontWeight: 800,
                                            padding: '2px 6px',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        -5s
                                    </button>
                                    <input
                                        type="range"
                                        min={0}
                                        max={previewDuration || audioBuffer?.duration || 100}
                                        step={0.1}
                                        value={currentPreviewTime}
                                        onChange={(e) => handleSeek(Number(e.target.value))}
                                        style={{
                                            flex: 1,
                                            cursor: 'pointer',
                                            accentColor: theme.accentInfo,
                                            height: 4,
                                        }}
                                    />
                                    <button
                                        onClick={() => handleSeek(Math.min(previewDuration || audioBuffer?.duration || 100, currentPreviewTime + 5))}
                                        title={t.stemForward5s}
                                        style={{
                                            background: theme.bgControl,
                                            border: `1px solid ${theme.border}`,
                                            borderRadius: 3,
                                            color: theme.textMain,
                                            fontSize: 9,
                                            fontWeight: 800,
                                            padding: '2px 6px',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        +5s
                                    </button>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 6 }}>
                            {!stem.isPcmReleased ? (
                                <button
                                    onClick={stem.releasePcm}
                                    title={t.stemReleaseMemoryHint}
                                    style={{
                                        flex: 1, background: theme.bgControl, color: theme.textMain,
                                        border: `1px solid ${theme.border}`, borderRadius: 5,
                                        padding: '6px 8px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
                                    }}
                                >
                                    {t.stemReleaseMemory}
                                </button>
                            ) : (
                                <div style={{
                                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: withAlpha(theme.success, 0.12), color: theme.success,
                                    border: `1px solid ${withAlpha(theme.success, 0.3)}`, borderRadius: 5,
                                    padding: '6px 8px', fontSize: 10, fontWeight: 800,
                                }}>
                                    {t.stemMemoryReleasedDone}
                                </div>
                            )}
                            <button
                                onClick={() => void stem.force()}
                                style={{
                                    flex: 1, background: theme.bgControl, color: theme.textMain,
                                    border: `1px solid ${theme.border}`, borderRadius: 5,
                                    padding: '6px 8px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
                                }}
                            >
                                {t.stemReseparate}
                            </button>
                        </div>

                        <div style={{ fontSize: 9, color: theme.textMuted, lineHeight: 1.5 }}>
                            {t.stemAnalysisUsageNote}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

function ProgressBar({ value, theme, indeterminate = false }: { value?: number; theme: any; indeterminate?: boolean }) {
    // indeterminate: 進捗不定 (セッション構築等)。バーが行き来するアニメーション
    const fillStyle: React.CSSProperties = indeterminate
        ? {
            height: '100%', width: '35%', borderRadius: 3, background: theme.accent,
            animation: 'stemIndeterminate 1.1s ease-in-out infinite alternate',
        }
        : {
            height: '100%', width: `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%`,
            background: theme.accent, transition: 'width 0.2s ease',
        };
    return (
        <div style={{ height: 6, background: theme.bgControl, borderRadius: 3, overflow: 'hidden' }}>
            <div style={fillStyle} />
        </div>
    );
}

function MetricCard({ label, value, theme }: { label: string; value: string; theme: any }) {
    return (
        <div style={{
            background: theme.bgControl, border: `1px solid ${theme.border}`,
            borderRadius: 5, padding: '5px 8px',
        }}>
            <div style={{ fontSize: 8.5, color: theme.textMuted, fontWeight: 800, letterSpacing: '0.04em' }}>{label}</div>
            <div style={{ fontSize: 12, fontWeight: 900, color: theme.textMain }}>{value}</div>
        </div>
    );
}

function formatTime(sec: number): string {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ミニ波形キャンバス (PCM ピーク配列を canvas に描画)
// ─────────────────────────────────────────────────────────────────────────────

interface StemWaveformProps {
    peaks: Float32Array;
    duration: number;          // 曲の全長 (sec)
    currentTime: number;       // 再生ヘッド位置 (sec)。-1 の時は非表示
    accentColor: string;
    bgColor: string;
    waveColor: string;
    onSeek: (timeSec: number) => void;
}

const StemWaveform: React.FC<StemWaveformProps> = ({
    peaks, duration, currentTime, accentColor, bgColor, waveColor, onSeek,
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const W = 340;
    const H = 36;

    // peaks 変化や currentTime 変化時に canvas を再描画
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, W, H);

        // 背景
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, W, H);

        const n = peaks.length;
        if (n === 0) return;

        // 再生場所までの左側 (流れた分を少し明るく)
        const headX = currentTime >= 0 && duration > 0
            ? Math.round((currentTime / duration) * W)
            : -1;

        // 複数のピーク点が同じ画素へ入るため、画素列ごとに最大値を採用する。
        // 点を順番に描くと、後続の小さい値が先行する大きい値を上書きしてしまう。
        const pixelPeaks = new Float32Array(W);
        for (let i = 0; i < n; i++) {
            const x = Math.min(W - 1, Math.floor((i * W) / n));
            if (peaks[i] > pixelPeaks[x]) pixelPeaks[x] = peaks[i];
        }
        for (let x = 0; x < W; x++) {
            const barH = Math.max(2, Math.round(pixelPeaks[x] * H * 0.92));
            const y = Math.round((H - barH) / 2);
            const played = headX >= 0 && x < headX;
            ctx.fillStyle = played ? accentColor : waveColor;
            ctx.globalAlpha = played ? 0.9 : 0.45;
            ctx.fillRect(x, y, 1, barH);
        }
        ctx.globalAlpha = 1;

        // 再生ヘッド
        if (headX >= 0) {
            ctx.fillStyle = accentColor;
            ctx.fillRect(headX - 1, 0, 2, H);
        }
    }, [peaks, duration, currentTime, accentColor, bgColor, waveColor]);

    useEffect(() => { draw(); }, [draw]);

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        onSeek(ratio * duration);
    };

    return (
        <canvas
            ref={canvasRef}
            width={W}
            height={H}
            onClick={handleClick}
            style={{
                width: '100%',
                height: H,
                borderRadius: 3,
                cursor: 'pointer',
                display: 'block',
            }}
            title="クリックで試聴開始位置を指定"
        />
    );
};
