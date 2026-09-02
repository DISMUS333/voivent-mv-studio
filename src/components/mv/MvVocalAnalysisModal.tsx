//==============================================================================
// MvVocalAnalysisModal.tsx - AI ボーカル文字起こし＆タイミング解析モーダル
//==============================================================================

import { useI18n } from '../../i18n';
import React, { useState, useEffect, useRef } from 'react';
import {
    IconSparkles,
    IconClose,
    IconMic,
    IconTimer,
    IconCheck,
} from '../Icons';
import { native } from '../../native';
import { ensureLyricIds, type LyricItem } from './types';

export interface MvVocalAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    tracks: Array<{ name: string; color?: string; isMidi?: boolean; clips?: unknown[] }>;
    initialSelectedTrackIndices: number[];
    totalDurationSec: number;
    loopRange?: { startSec: number; endSec: number; enabled: boolean };
    onApplyLyrics: (newLyrics: LyricItem[], mode: 'replace' | 'append') => void;
    /** 選択トラックの変更通知（MVオーディオ反応と同期） */
    onChangeSelectedTracks?: (indices: number[]) => void;
    /** Stem 分離パネルを開くコールバック */
    onOpenStemPanel?: () => void;
    /** 分離済みボーカル音声が存在するか */
    hasVocalStem?: boolean;
}

export const MvVocalAnalysisModal: React.FC<MvVocalAnalysisModalProps> = ({
    isOpen,
    onClose,
    tracks,
    initialSelectedTrackIndices,
    totalDurationSec,
    loopRange,
    onApplyLyrics,
    onChangeSelectedTracks,
    onOpenStemPanel,
    hasVocalStem = false,
}) => {
    const { t } = useI18n();
    // トラック選択（空なら全トラック対象）
    const [selectedTracks, setSelectedTracks] = useState<number[]>([]);

    // 範囲選択 ('all' | 'custom' | 'loop')
    const [rangeMode, setRangeMode] = useState<'all' | 'custom' | 'loop'>('all');
    const [customStartSec, setCustomStartSec] = useState<number>(0);
    const [customEndSec, setCustomEndSec] = useState<number>(Math.max(10, Math.ceil(totalDurationSec || 60)));

    // 言語選択
    const [lang, setLang] = useState<string>('ja');

    // 配置モード ('replace' | 'append')
    const [placementMode, setPlacementMode] = useState<'replace' | 'append'>('replace');

    // 実行状態
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [progressStep, setProgressStep] = useState<number>(1);
    const [progressPercent, setProgressPercent] = useState<number>(0);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [elapsedSec, setElapsedSec] = useState<number>(0);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const timerRef = useRef<number | null>(null);

    // モーダル開閉時の初期化（開いた瞬間のみ初期化し、親の毎フレーム再描画でのリセットを防ぐ）
    useEffect(() => {
        if (isOpen) {
            setSelectedTracks(
                initialSelectedTrackIndices.length > 0
                    ? [...initialSelectedTrackIndices]
                    : tracks.map((_, i) => i)
            );
            setCustomStartSec(0);
            setCustomEndSec(Math.max(10, Math.ceil(totalDurationSec || 60)));
            if (loopRange?.enabled && loopRange.endSec > loopRange.startSec) {
                setRangeMode('loop');
            } else {
                setRangeMode('all');
            }
            setIsRunning(false);
            setProgressPercent(0);
            setProgressStep(1);
            setElapsedSec(0);
            setErrorMessage(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // 経過時間タイマー
    useEffect(() => {
        if (isRunning) {
            const start = Date.now();
            timerRef.current = window.setInterval(() => {
                setElapsedSec(Number(((Date.now() - start) / 1000).toFixed(1)));
            }, 100);
        } else if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isRunning]);

    if (!isOpen) return null;

    // トラックトグル
    const toggleTrack = (idx: number) => {
        if (selectedTracks.includes(idx)) {
            setSelectedTracks(selectedTracks.filter((i) => i !== idx));
        } else {
            setSelectedTracks([...selectedTracks, idx].sort((a, b) => a - b));
        }
    };

    const selectAllTracks = () => {
        setSelectedTracks(tracks.map((_, i) => i));
    };

    const clearAllTracks = () => {
        setSelectedTracks([]);
    };

    // 解析実行
    const handleRunAnalysis = async () => {
        setErrorMessage(null);
        setIsRunning(true);
        setProgressStep(1);
        setProgressPercent(15);
        setStatusMessage(t.vaStatusExtract);

        let startSec = 0;
        let endSec = -1;

        if (rangeMode === 'loop' && loopRange?.enabled) {
            startSec = Math.max(0, loopRange.startSec);
            endSec = Math.max(startSec + 0.5, loopRange.endSec);
        } else if (rangeMode === 'custom') {
            startSec = Math.max(0, customStartSec);
            endSec = Math.max(startSec + 0.5, customEndSec);
        } else {
            startSec = 0;
            endSec = totalDurationSec > 0 ? totalDurationSec : -1;
        }

        try {
            // Step 1: 音声レンダリング
            await new Promise((r) => setTimeout(r, 200));
            setProgressPercent(35);
            const b64Result = await native.renderSessionAudioForMV(
                startSec,
                endSec,
                selectedTracks.length > 0 ? selectedTracks : undefined
            );

            if (!b64Result) {
                throw new Error(t.vaErrExtract);
            }

            // Step 2: AI ASR 推論
            setProgressStep(2);
            setProgressPercent(60);
            setStatusMessage(t.vaStatusAsr);

            const jsonStr = await native.runVocalAsr(b64Result as string, lang);

            // Step 3: 結果解析と歌詞配置
            setProgressStep(3);
            setProgressPercent(90);
            setStatusMessage(t.vaStatusMerge);

            let items: Array<{ text: string; time: number; duration: number }> = [];
            try {
                items = JSON.parse(jsonStr) as typeof items;
            } catch {
                throw new Error(t.vaErrJson);
            }

            if (!Array.isArray(items) || items.length === 0) {
                throw new Error(t.vaErrNoLyrics);
            }

            // startSec のオフセットを補正してタイムライン絶対時間に合わせる
            // バグ修正: ensureLyricIds() で安定 ID を採番（同じ time/text の重複でも UI 編集が破綻しない）
            const generatedLyrics: LyricItem[] = ensureLyricIds(items.map((seg) => ({
                text: seg.text,
                time: Number((seg.time + startSec).toFixed(2)),
                duration: Number(Math.max(0.5, seg.duration).toFixed(2)),
            })));

            setProgressPercent(100);
            setStatusMessage(t.vaStatusDone(generatedLyrics.length));

            await new Promise((r) => setTimeout(r, 400));
            onChangeSelectedTracks?.(selectedTracks);
            onApplyLyrics(generatedLyrics, placementMode);
            onClose();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setErrorMessage(msg);
            setIsRunning(false);
        }
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(8, 12, 20, 0.82)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget && !isRunning) onClose();
            }}
        >
            <div
                style={{
                    width: 520,
                    maxHeight: '90vh',
                    backgroundColor: '#111827',
                    border: '1px solid #374151',
                    borderRadius: 8,
                    boxShadow: '0 20px 45px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    color: '#e2e8f0',
                    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                    pointerEvents: 'auto',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div
                    style={{
                        padding: '12px 16px',
                        backgroundColor: '#1e293b',
                        borderBottom: '1px solid #334155',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                            style={{
                                width: 26,
                                height: 26,
                                borderRadius: 5,
                                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                                border: '1px solid #6366f1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <IconSparkles size={14} color="#818cf8" />
                        </div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 900, color: '#f8fafc', letterSpacing: '0.02em' }}>
                                {t.vaTitle}
                            </div>
                            <div style={{ fontSize: 10, color: '#94a3b8' }}>
                                {t.vaSubtitle}
                            </div>
                        </div>
                    </div>
                    {!isRunning && (
                        <button
                            onClick={onClose}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#94a3b8',
                                cursor: 'pointer',
                                padding: 4,
                                borderRadius: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <IconClose size={14} color="#94a3b8" />
                        </button>
                    )}
                </div>

                {/* ボディ */}
                <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {isRunning ? (
                        /* 進行中ゲージ表示 */
                        <div style={{ padding: '24px 8px', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#818cf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <IconSparkles size={14} color="#818cf8" />
                                <span>{t.vaProcessing}</span>
                            </div>

                            {/* プログレスバー */}
                            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', fontWeight: 800 }}>
                                    <span>{statusMessage}</span>
                                    <span style={{ color: '#38bdf8' }}>{progressPercent}%</span>
                                </div>
                                <div
                                    style={{
                                        width: '100%',
                                        height: 8,
                                        backgroundColor: '#1e293b',
                                        borderRadius: 4,
                                        overflow: 'hidden',
                                        border: '1px solid #334155',
                                    }}
                                >
                                    <div
                                        style={{
                                            width: `${progressPercent}%`,
                                            height: '100%',
                                            background: 'linear-gradient(90deg, #6366f1, #38bdf8)',
                                            borderRadius: 4,
                                            transition: 'width 0.3s ease',
                                            boxShadow: '0 0 10px rgba(56, 189, 248, 0.5)',
                                        }}
                                    />
                                </div>
                            </div>

                            {/* ステップインジケーター */}
                            <div
                                style={{
                                    display: 'flex',
                                    gap: 8,
                                    width: '100%',
                                    backgroundColor: '#0f172a',
                                    padding: '10px 12px',
                                    borderRadius: 6,
                                    border: '1px solid #1e293b',
                                }}
                            >
                                <div style={{ flex: 1, fontSize: 9.5, color: progressStep >= 1 ? '#38bdf8' : '#64748b', fontWeight: progressStep === 1 ? 900 : 700 }}>
                                    {t.vaStep1}
                                </div>
                                <div style={{ flex: 1, fontSize: 9.5, color: progressStep >= 2 ? '#818cf8' : '#64748b', fontWeight: progressStep === 2 ? 900 : 700 }}>
                                    {t.vaStep2}
                                </div>
                                <div style={{ flex: 1, fontSize: 9.5, color: progressStep >= 3 ? '#a855f7' : '#64748b', fontWeight: progressStep === 3 ? 900 : 700 }}>
                                    {t.vaStep3}
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#64748b' }}>
                                <IconTimer size={11} color="#64748b" />
                                <span>{t.vaElapsed(elapsedSec)}</span>
                            </div>
                        </div>
                    ) : (
                        /* 設定画面 */
                        <>
                            {/* エラーメッセージ */}
                            {errorMessage && (
                                <div
                                    style={{
                                        padding: '8px 12px',
                                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                        border: '1px solid #ef4444',
                                        borderRadius: 6,
                                        fontSize: 11,
                                        color: '#fca5a5',
                                        lineHeight: 1.4,
                                    }}
                                >
                                    {errorMessage}
                                </div>
                            )}

                            {/* 1. 対象トラック選択 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: 11, fontWeight: 900, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <IconMic size={12} color="#38bdf8" />
                                        <span>{t.vaTracksLabel}</span>
                                    </span>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <button
                                            onClick={selectAllTracks}
                                            style={{ fontSize: 9, padding: '2px 6px', background: '#1e293b', border: '1px solid #475569', borderRadius: 3, color: '#94a3b8', cursor: 'pointer' }}
                                        >
                                            {t.vaSelectAll}
                                        </button>
                                        <button
                                            onClick={clearAllTracks}
                                            style={{ fontSize: 9, padding: '2px 6px', background: '#1e293b', border: '1px solid #475569', borderRadius: 3, color: '#94a3b8', cursor: 'pointer' }}
                                        >
                                            {t.vaClearAll}
                                        </button>
                                    </div>
                                </div>

                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                                        gap: 6,
                                        maxHeight: 130,
                                        overflowY: 'auto',
                                        backgroundColor: '#0f172a',
                                        padding: 8,
                                        borderRadius: 6,
                                        border: '1px solid #1e293b',
                                    }}
                                >
                                    {tracks.map((tr, idx) => {
                                        const isSelected = selectedTracks.includes(idx);
                                        return (
                                            <button
                                                key={idx}
                                                onClick={() => toggleTrack(idx)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 6,
                                                    padding: '5px 8px',
                                                    borderRadius: 4,
                                                    backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.15)' : '#1e293b',
                                                    border: `1px solid ${isSelected ? '#38bdf8' : '#334155'}`,
                                                    color: isSelected ? '#ffffff' : '#94a3b8',
                                                    fontSize: 10,
                                                    fontWeight: isSelected ? 800 : 500,
                                                    cursor: 'pointer',
                                                    textAlign: 'left',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: 12,
                                                        height: 12,
                                                        borderRadius: 2,
                                                        backgroundColor: isSelected ? '#38bdf8' : '#334155',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    {isSelected && <IconCheck size={9} color="#0f172a" />}
                                                </div>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    T{idx + 1}: {tr.name || `Track ${idx + 1}`}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div style={{ fontSize: 9, color: '#64748b' }}>
                                    {t.vaTrackMixNote}
                                </div>

                                {/* 💡 Stem 分離ボーカル状態バナー (ベクター SVG アイコンのみ使用) */}
                                {hasVocalStem ? (
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: 8,
                                            padding: '8px 10px',
                                            borderRadius: 6,
                                            backgroundColor: 'rgba(16, 185, 129, 0.08)',
                                            border: '1px solid rgba(16, 185, 129, 0.3)',
                                        }}
                                    >
                                        <div style={{ marginTop: 1, flexShrink: 0 }}>
                                            <IconCheck size={13} color="#10b981" />
                                        </div>
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            <div style={{ fontSize: 9.5, fontWeight: 900, color: '#34d399' }}>
                                                {t.vaVocalStemActive}
                                            </div>
                                            <div style={{ fontSize: 8.5, color: '#94a3b8', lineHeight: 1.45 }}>
                                                {t.vaVocalStemActiveDesc}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: 8,
                                            padding: '8px 10px',
                                            borderRadius: 6,
                                            backgroundColor: 'rgba(56, 189, 248, 0.05)',
                                            border: '1px solid rgba(56, 189, 248, 0.2)',
                                        }}
                                    >
                                        <div style={{ marginTop: 1, flexShrink: 0 }}>
                                            <IconSparkles size={13} color="#38bdf8" />
                                        </div>
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <div style={{ fontSize: 9.5, fontWeight: 800, color: '#38bdf8' }}>
                                                {t.vaStemBannerTitle}
                                            </div>
                                            <div style={{ fontSize: 8.5, color: '#94a3b8', lineHeight: 1.45 }}>
                                                {t.vaStemBannerDesc}
                                            </div>
                                            {onOpenStemPanel && (
                                                <div style={{ marginTop: 2 }}>
                                                    <button
                                                        onClick={() => {
                                                            onClose();
                                                            onOpenStemPanel();
                                                        }}
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: 4,
                                                            padding: '3px 8px',
                                                            borderRadius: 4,
                                                            backgroundColor: '#0284c7',
                                                            border: '1px solid #38bdf8',
                                                            color: '#e7edf4',
                                                            fontSize: 9,
                                                            fontWeight: 800,
                                                            cursor: 'pointer',
                                                            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
                                                            transition: 'background 0.12s ease',
                                                        }}
                                                    >
                                                        <IconSparkles size={10} color="#e7edf4" />
                                                        <span>{t.vaStemBannerAction}</span>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 2. 解析範囲選択 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 900, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <IconTimer size={12} color="#38bdf8" />
                                    <span>{t.vaRangeLabel}</span>
                                </span>

                                <div style={{ display: 'flex', gap: 8 }}>
                                    <label
                                        style={{
                                            flex: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            padding: '6px 10px',
                                            borderRadius: 4,
                                            backgroundColor: rangeMode === 'all' ? 'rgba(99, 102, 241, 0.15)' : '#0f172a',
                                            border: `1px solid ${rangeMode === 'all' ? '#6366f1' : '#1e293b'}`,
                                            fontSize: 10,
                                            fontWeight: 800,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="rangeMode"
                                            checked={rangeMode === 'all'}
                                            onChange={() => setRangeMode('all')}
                                            style={{ accentColor: '#6366f1' }}
                                        />
                                        <span>{t.vaWholeSong(totalDurationSec.toFixed(1))}</span>
                                    </label>

                                    {loopRange?.enabled && (
                                        <label
                                            style={{
                                                flex: 1,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                padding: '6px 10px',
                                                borderRadius: 4,
                                                backgroundColor: rangeMode === 'loop' ? 'rgba(99, 102, 241, 0.15)' : '#0f172a',
                                                border: `1px solid ${rangeMode === 'loop' ? '#6366f1' : '#1e293b'}`,
                                                fontSize: 10,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <input
                                                type="radio"
                                                name="rangeMode"
                                                checked={rangeMode === 'loop'}
                                                onChange={() => setRangeMode('loop')}
                                                style={{ accentColor: '#6366f1' }}
                                            />
                                            <span>{t.vaLoopRange(loopRange.startSec.toFixed(1), loopRange.endSec.toFixed(1))}</span>
                                        </label>
                                    )}

                                    <label
                                        style={{
                                            flex: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            padding: '6px 10px',
                                            borderRadius: 4,
                                            backgroundColor: rangeMode === 'custom' ? 'rgba(99, 102, 241, 0.15)' : '#0f172a',
                                            border: `1px solid ${rangeMode === 'custom' ? '#6366f1' : '#1e293b'}`,
                                            fontSize: 10,
                                            fontWeight: 800,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="rangeMode"
                                            checked={rangeMode === 'custom'}
                                            onChange={() => setRangeMode('custom')}
                                            style={{ accentColor: '#6366f1' }}
                                        />
                                        <span>{t.vaCustomRange}</span>
                                    </label>
                                </div>

                                {rangeMode === 'custom' && (
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            backgroundColor: '#0f172a',
                                            padding: '6px 10px',
                                            borderRadius: 4,
                                            border: '1px solid #1e293b',
                                            fontSize: 10,
                                        }}
                                    >
                                        <span>{t.vaStartLabel}</span>
                                        <input
                                            type="number"
                                            min={0}
                                            max={customEndSec - 0.5}
                                            step={0.5}
                                            value={customStartSec}
                                            onChange={(e) => setCustomStartSec(Math.max(0, parseFloat(e.target.value) || 0))}
                                            style={{
                                                width: 60,
                                                padding: '2px 6px',
                                                backgroundColor: '#1e293b',
                                                border: '1px solid #475569',
                                                borderRadius: 3,
                                                color: '#f8fafc',
                                                fontSize: 10,
                                                textAlign: 'center',
                                            }}
                                        />
                                        <span>{t.vaRangeSep}</span>
                                        <input
                                            type="number"
                                            min={customStartSec + 0.5}
                                            step={0.5}
                                            value={customEndSec}
                                            onChange={(e) => setCustomEndSec(Math.max(customStartSec + 0.5, parseFloat(e.target.value) || 10))}
                                            style={{
                                                width: 60,
                                                padding: '2px 6px',
                                                backgroundColor: '#1e293b',
                                                border: '1px solid #475569',
                                                borderRadius: 3,
                                                color: '#f8fafc',
                                                fontSize: 10,
                                                textAlign: 'center',
                                            }}
                                        />
                                        <span>{t.vaSecUnit}</span>
                                    </div>
                                )}
                            </div>

                            {/* 3. 言語 & 配置オプション */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8' }}>{t.vaLanguageLabel}</span>
                                    <select
                                        value={lang}
                                        onChange={(e) => setLang(e.target.value)}
                                        style={{
                                            padding: '5px 8px',
                                            backgroundColor: '#0f172a',
                                            border: '1px solid #334155',
                                            borderRadius: 4,
                                            color: '#f8fafc',
                                            fontSize: 10,
                                            fontWeight: 700,
                                        }}
                                    >
                                        <option value="ja">日本語 (Japanese)</option>
                                        <option value="en">English (英語)</option>
                                        <option value="zh">中文 (中国語)</option>
                                        <option value="ko">한국어 (韓国語)</option>
                                        <option value="fr">Français (フランス語)</option>
                                        <option value="de">Deutsch (ドイツ語)</option>
                                    </select>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8' }}>{t.vaExistingLyricsLabel}</span>
                                    <select
                                        value={placementMode}
                                        onChange={(e) => setPlacementMode(e.target.value as 'replace' | 'append')}
                                        style={{
                                            padding: '5px 8px',
                                            backgroundColor: '#0f172a',
                                            border: '1px solid #334155',
                                            borderRadius: 4,
                                            color: '#f8fafc',
                                            fontSize: 10,
                                            fontWeight: 700,
                                        }}
                                    >
                                        <option value="replace">{t.vaModeReplace}</option>
                                        <option value="append">{t.vaModeAppend}</option>
                                    </select>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* フッター */}
                <div
                    style={{
                        padding: '12px 16px',
                        backgroundColor: '#1e293b',
                        borderTop: '1px solid #334155',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 8,
                    }}
                >
                    {!isRunning ? (
                        <>
                            <button
                                onClick={onClose}
                                style={{
                                    padding: '6px 14px',
                                    backgroundColor: '#334155',
                                    border: 'none',
                                    borderRadius: 4,
                                    color: '#cbd5e1',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                {t.vaCancel}
                            </button>
                            <button
                                onClick={() => { void handleRunAnalysis(); }}
                                disabled={selectedTracks.length === 0}
                                style={{
                                    padding: '6px 18px',
                                    background: selectedTracks.length === 0 ? '#475569' : 'linear-gradient(135deg, #4338ca, #6366f1)',
                                    border: 'none',
                                    borderRadius: 4,
                                    color: '#e7edf4',
                                    fontSize: 11,
                                    fontWeight: 900,
                                    cursor: selectedTracks.length === 0 ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    boxShadow: selectedTracks.length === 0 ? 'none' : '0 2px 10px rgba(99, 102, 241, 0.4)',
                                }}
                            >
                                <IconSparkles size={12} color="#e7edf4" />
                                <span>{t.vaStartBtn}</span>
                            </button>
                        </>
                    ) : (
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>
                            {t.vaWaitNote}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};
