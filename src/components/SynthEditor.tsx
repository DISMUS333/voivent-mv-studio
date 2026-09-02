//==============================================================================
// SYNTH1 風の声シンセサイザーエディタ（モーダル）。
// ADSR / フィルター / 膨大なプリセットブラウザ / ボイスライブラリ / MIDI 入力 / 波形サンプル編集をまとめる。
//==============================================================================
import React, { useEffect, useRef, useState } from 'react';
import type {
    Analysis,
    Status,
    SynthParams,
    SynthState,
    VoiceLibraryEntry,
} from '../types';
import { native } from '../native';
import { formatTime } from '../lib/music';
import { Knob } from './Knob';
import {
    IconAutoTrim,
    IconCheck,
    IconClose,
    IconEdit,
    IconNormalize,
    IconPlay,
    IconPlus,
    IconRecord,
    IconReverse,
    IconSave,
    IconScissorsCut,
    IconSearch,
    IconSliders,
    IconSpeaker,
    IconStop,
    IconSynth,
    IconTimer,
    IconUndo,
    IconWaveform,
    IconZap,
    IconSparkles,
    IconLoopCycle,
} from './Icons';

export function SynthEditor(props: {
    synth: SynthState;
    status?: Status | null;
    analysis?: Analysis | null;
    voices: VoiceLibraryEntry[];
    midiDevices: string[];
    selectedMidiDevice: string;
    midiRecording: boolean;
    midiNotes: unknown[];
    voiceName: string;
    hasVoice: boolean;
    isRecording?: boolean;
    isPlaying?: boolean;
    countInEnabled?: boolean;
    countInBeat?: number | null;
    onToggleCountIn?: () => void;
    onRecordToggle?: () => void;
    onPlayToggle?: () => void;
    onTrimVoice?: (startR: number, endR: number) => Promise<void>;
    onAutoTrimVoice?: () => Promise<void>;
    onNormalizeVoice?: (enable?: boolean) => Promise<void>;
    onSetVoiceGain?: (factor: number) => Promise<void>;
    onResetVoice?: () => Promise<void>;
    onReverseVoice?: () => Promise<void>;
    selectedVoiceIdx?: number;
    editingClipTarget?: { track: number; clip: number } | null;
    clipTrimStart?: number;
    clipSourceDuration?: number;
    clipVisibleDuration?: number;
    clipFadeIn?: number;
    clipFadeOut?: number;
    onApplyToTrackOrClip?: () => Promise<void>;
    onUpdateVoice?: (index: number) => Promise<void>;
    onSaveVoiceAs?: (name: string) => Promise<void>;
    onClose: () => void;
    onParamChange: (patch: Partial<SynthParams>) => void;
    onVoiceNameChange: (name: string) => void;
    onSaveVoice: () => void;
    onLoadVoice: (index: number) => void;
    onRenameVoice?: (index: number, newName: string) => void;
    onDeleteVoice: (index: number) => void;
    onMidiDeviceChange: (device: string) => void;
    onMidiRecordToggle: () => void;
}) {
    const {
        synth,
        status,
        analysis,
        voices,
        midiDevices,
        selectedMidiDevice,
        midiRecording,
        midiNotes,
        voiceName,
        hasVoice,
        selectedVoiceIdx = 0,
        editingClipTarget,
        clipTrimStart,
        clipSourceDuration,
        clipVisibleDuration,
        clipFadeIn,
        clipFadeOut,
        onApplyToTrackOrClip,
        onUpdateVoice,
        onSaveVoiceAs,
        isRecording = false,
        isPlaying = false,
        countInEnabled = false,
        countInBeat = null,
        onToggleCountIn,
        onRecordToggle,
        onPlayToggle,
        onClose,
        onParamChange,
        onVoiceNameChange,
        onSaveVoice,
        onLoadVoice,
        onRenameVoice,
        onDeleteVoice,
        onMidiDeviceChange,
        onMidiRecordToggle,
        onTrimVoice,
        onAutoTrimVoice,
        onNormalizeVoice,
        onSetVoiceGain,
        onResetVoice,
        onReverseVoice,
    } = props;

    // 🎚️ クリップのフェードイン/フェードアウト設定をプレビュー音声に自動同期
    useEffect(() => {
        native.setPreviewFade(clipFadeIn ?? 0, clipFadeOut ?? 0);
    }, [clipFadeIn, clipFadeOut]);

    // 波形トリミング用ステート (0.0 〜 1.0)
    const [trimStart, setTrimStart] = useState(0.0);
    const [trimEnd, setTrimEnd] = useState(1.0);
    const [isTrimming, setIsTrimming] = useState(false);

    useEffect(() => {
        if (!editingClipTarget || !clipSourceDuration || clipSourceDuration <= 0) return;
        const sourceStart = Math.max(0, Math.min(clipSourceDuration, clipTrimStart ?? 0));
        const visibleEnd = Math.max(sourceStart, Math.min(
            clipSourceDuration,
            sourceStart + Math.max(0, clipVisibleDuration ?? (clipSourceDuration - sourceStart)),
        ));
        setTrimStart(sourceStart / clipSourceDuration);
        setTrimEnd(Math.max(sourceStart / clipSourceDuration, visibleEnd / clipSourceDuration));
    }, [editingClipTarget?.track, editingClipTarget?.clip, clipTrimStart, clipSourceDuration, clipVisibleDuration]);

    // プレビューループ再生ステート
    const [isLoopPreview, setIsLoopPreview] = useState(false);
    const isLoopPreviewRef = useRef(isLoopPreview);
    isLoopPreviewRef.current = isLoopPreview;

    // 再生状態の監視：ループが有効で再生が終了したら自動で再再生
    const prevPlayingRef = useRef(isPlaying);
    useEffect(() => {
        if (prevPlayingRef.current && !isPlaying && isLoopPreviewRef.current) {
            const timer = setTimeout(() => {
                if (isLoopPreviewRef.current) {
                    onPlayToggle?.();
                }
            }, 60);
            return () => clearTimeout(timer);
        }
        prevPlayingRef.current = isPlaying;
    }, [isPlaying, onPlayToggle]);

    // 上書き保存・新規別名保存ステート
    const [saveToast, setSaveToast] = useState<string | null>(null);
    const [saveAsModalOpen, setSaveAsModalOpen] = useState(false);
    const [newSaveName, setNewSaveName] = useState('');

    // Synth1 風ブラウザ用ステート
    const [searchQuery, setSearchQuery] = useState('');
    const [editingVoiceIdx, setEditingVoiceIdx] = useState<number | null>(null);
    const [editVoiceText, setEditVoiceText] = useState('');

    const startRenameVoice = (idx: number, currentName: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingVoiceIdx(idx);
        setEditVoiceText(currentName);
    };

    const commitRenameVoice = (idx: number) => {
        if (onRenameVoice && editVoiceText.trim()) {
            onRenameVoice(idx, editVoiceText.trim());
        }
        setEditingVoiceIdx(null);
    };

    const [isNormalized, setIsNormalized] = useState(false);
    const [voiceGainPercent, setVoiceGainPercent] = useState(100);
    const [confirmDeleteVoiceIdx, setConfirmDeleteVoiceIdx] = useState<number | null>(null);

    // 波形のピークを調べてノーマライズ状態を自動同期（ピークが 0.85 以上ならノーマライズON判定）
    useEffect(() => {
        if (analysis?.peaks && analysis.peaks.length > 0) {
            let maxP = 0;
            for (const p of analysis.peaks) {
                maxP = Math.max(maxP, Math.abs(p[0]), Math.abs(p[1]));
            }
            if (maxP >= 0.85) {
                setIsNormalized(true);
            } else {
                setIsNormalized(false);
            }
        }
    }, [analysis]);

    // 検索フィルタリング
    const filteredVoices = voices
        .map((v, idx) => ({ ...v, originalIndex: idx }))
        .filter((v) => v.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(5, 7, 10, 0.8)',
                backdropFilter: 'blur(6px)',
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: 980,
                    maxHeight: '92vh',
                    overflowY: 'auto',
                    background: 'linear-gradient(145deg, #2b1f24 0%, #1e2430 50%, #141820 100%)',
                    border: '2px solid #576574',
                    borderRadius: 12,
                    boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                }}
            >
                {/* 追尾固定ヘッダー (Sticky Header) */}
                <div
                    style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 100,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 16px',
                        background: 'rgba(18, 24, 32, 0.96)',
                        backdropFilter: 'blur(12px)',
                        borderBottom: '1px solid #2e3848',
                        gap: 12,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', minWidth: 0 }}>
                        <div style={{ background: '#27ae60', color: '#ffffff', fontSize: 10.5, fontWeight: 900, padding: '3px 7px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <IconSynth size={12} color="#ffffff" />
                            <span>VOICE SYNTH</span>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#f1f2f6', letterSpacing: '0.3px', flexShrink: 0 }}>
                            ボイスエディタ
                        </span>

                        {/* 現在編集中の音源情報 */}
                        {selectedVoiceIdx >= 0 && voices[selectedVoiceIdx] ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#11151c', border: '1px solid #2e3848', borderRadius: 6, padding: '3px 8px', marginLeft: 4, overflow: 'hidden', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0, maxWidth: 240 }}>
                                <span style={{ fontSize: 10.5, color: '#747d8c', fontWeight: 700, flexShrink: 0 }}>編集中:</span>
                                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#2ecc71', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {selectedVoiceIdx < 10 ? `0${selectedVoiceIdx}` : selectedVoiceIdx}: {voices[selectedVoiceIdx].name}
                                </span>
                            </div>
                        ) : hasVoice ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#191512', border: '1px solid #e67e22', borderRadius: 6, padding: '3px 8px', marginLeft: 4, overflow: 'hidden', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 10.5, color: '#e67e22', fontWeight: 800, flexShrink: 0 }}>● 新規サンプリング音声 (未保存)</span>
                            </div>
                        ) : null}
                    </div>

                    {/* 音源の更新＆保存アクション */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {/* トラック/クリップに反映（ワンクリックでタイムラインを更新！） */}
                        {onApplyToTrackOrClip && (
                            <button
                                onClick={async () => {
                                    await onApplyToTrackOrClip();
                                    setSaveToast(editingClipTarget ? '既存クリップを上書き更新しました！' : 'トラックに音声を反映しました！');
                                    setTimeout(() => setSaveToast(null), 3000);
                                }}
                                style={{
                                    background: '#1c2822',
                                    color: '#2ecc71',
                                    border: '1px solid rgba(46, 204, 113, 0.55)',
                                    borderRadius: 6,
                                    padding: '6px 11px',
                                    fontSize: 11,
                                    fontWeight: 900,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    whiteSpace: 'nowrap',
                                    transition: 'all 0.15s ease',
                                }}
                                title={editingClipTarget ? '編集した音声を元のクリップに上書き反映します（重複作成しません）' : '編集した音声をトラックに反映します'}
                            >
                                <IconSparkles size={13} color="#2ecc71" />
                                <span>{editingClipTarget ? 'クリップ更新' : 'トラック反映'}</span>
                            </button>
                        )}

                        {/* 上書き保存 */}
                        <button
                            onClick={async () => {
                                if (onUpdateVoice) {
                                    await onUpdateVoice(selectedVoiceIdx);
                                    setSaveToast(`「${voices[selectedVoiceIdx]?.name || '現在の音源'}」を上書き保存しました！`);
                                    setTimeout(() => setSaveToast(null), 3000);
                                }
                            }}
                            style={{
                                background: 'linear-gradient(135deg, #1e3799 0%, #0c2461 100%)',
                                color: '#ffffff',
                                border: '1px solid #4b7bec',
                                borderRadius: 6,
                                padding: '6px 10px',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                whiteSpace: 'nowrap',
                                boxShadow: '0 2px 6px rgba(30, 55, 153, 0.4)',
                            }}
                            title="編集したエフェクトや加工を現在の音源にそのまま上書き更新"
                        >
                            <IconSave size={13} color="#70a1ff" />
                            <span>上書き</span>
                        </button>

                        {/* 別名で新規保存 */}
                        <button
                            onClick={() => {
                                const currentName = voices[selectedVoiceIdx]?.name || 'Voice';
                                setNewSaveName(`${currentName} FX`);
                                setSaveAsModalOpen(true);
                            }}
                            style={{
                                background: 'linear-gradient(135deg, #2f3542 0%, #1e2430 100%)',
                                color: '#ffffff',
                                border: '1px solid #576574',
                                borderRadius: 6,
                                padding: '6px 10px',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                whiteSpace: 'nowrap',
                            }}
                            title="編集した音色を新しい名前をつけて新規プリセットとして保存"
                        >
                            <IconPlus size={13} color="#2ed573" />
                            <span>別名保存</span>
                        </button>

                        <button
                            onClick={onClose}
                            style={{
                                background: '#2f3542',
                                color: '#f1f2f6',
                                border: 'none',
                                borderRadius: '50%',
                                width: 26,
                                height: 26,
                                fontSize: 13,
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginLeft: 4,
                                flexShrink: 0,
                            }}
                            title="閉じる"
                        >
                            <IconClose size={12} color="#f1f2f6" />
                        </button>
                    </div>
                </div>

                {/* 保存完了トースト通知 */}
                {saveToast && (
                    <div
                        style={{
                            background: '#2ed573',
                            color: '#0d1017',
                            padding: '6px 16px',
                            fontSize: 12,
                            fontWeight: 900,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            boxShadow: '0 4px 12px rgba(46, 213, 115, 0.4)',
                        }}
                    >
                        <IconCheck size={16} color="#0d1017" />
                        <span>{saveToast}</span>
                    </div>
                )}

                {/* メイン操作エリア */}
                <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* 🎤 ボイス / サウンド サンプラー（その場で録音して即シンセ音源化） */}
                    <div style={{ background: '#141822', border: isRecording ? '2px solid #ff4757' : '1px solid #232e3d', borderRadius: 10, padding: 14, boxShadow: isRecording ? '0 0 15px rgba(255, 71, 87, 0.4)' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: '#2ecc71', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <IconRecord size={14} color={isRecording ? '#ff4757' : '#2ecc71'} /> ボイス / サウンド・サンプラー
                            </span>
                            <span style={{ fontSize: 11, color: isRecording ? '#ff4757' : '#8395a7', fontWeight: isRecording ? 800 : 400 }}>
                                {isRecording ? '● 録音中… 声や物音を出してください' : '声や身の回りの音を録音して、即座にオリジナルシンセ化'}
                            </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#0e121a', padding: 12, borderRadius: 8, border: '1px solid #283344' }}>
                            <button
                                onClick={onRecordToggle}
                                style={{
                                    background: isRecording ? '#c0392b' : countInBeat !== null ? '#d35400' : '#1a231f',
                                    color: '#ffffff',
                                    border: `1px solid ${isRecording ? '#e74c3c' : countInBeat !== null ? '#e67e22' : 'rgba(46, 204, 113, 0.6)'}`,
                                    borderRadius: 6,
                                    padding: '10px 22px',
                                    fontSize: 13.5,
                                    fontWeight: 900,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    boxShadow: 'none',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                {isRecording ? <IconStop size={14} color="#ffffff" /> : <IconRecord size={14} color="#2ecc71" />}
                                {isRecording
                                    ? '録音停止（シンセ化）'
                                    : countInBeat !== null
                                        ? `カウント中: ${countInBeat}...`
                                        : '声をサンプリング録音'}
                            </button>

                            {/* ⏱️ カウントイン切替ボタン（コンパクトDAWスタイル） */}
                            <button
                                onClick={onToggleCountIn}
                                style={{
                                    background: countInEnabled ? 'rgba(77, 124, 255, 0.2)' : '#1b1f27',
                                    color: countInEnabled ? '#70a1ff' : '#747d8c',
                                    border: `1px solid ${countInEnabled ? '#4d7cff' : '#283344'}`,
                                    borderRadius: 6,
                                    padding: '8px 10px',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    whiteSpace: 'nowrap',
                                }}
                                title={countInEnabled ? 'カウントイン: 4拍（クリックでOFF）' : 'カウントイン: OFF（クリックで4拍カウントON）'}
                            >
                                <IconTimer size={13} color={countInEnabled ? '#70a1ff' : '#747d8c'} />
                                <span>カウント</span>
                                <span style={{ fontSize: 9, fontWeight: 900, background: countInEnabled ? '#4d7cff' : '#2f3542', color: countInEnabled ? '#fff' : '#a4b0be', padding: '1px 4px', borderRadius: 3 }}>
                                    {countInEnabled ? '4拍' : 'OFF'}
                                </span>
                            </button>

                            <button
                                onClick={onPlayToggle}
                                disabled={!hasVoice}
                                style={{
                                    background: isPlaying ? '#4d7cff' : '#2f3542',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: 6,
                                    padding: '10px 16px',
                                    fontSize: 13,
                                    fontWeight: 800,
                                    cursor: hasVoice ? 'pointer' : 'not-allowed',
                                    opacity: hasVoice ? 1 : 0.4,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                }}
                            >
                                {isPlaying ? <IconStop size={13} color="#fff" /> : <IconSpeaker size={13} color="#fff" />}
                                <span>{isPlaying ? '停止' : '原音プレビュー'}</span>
                            </button>

                            {/* ループ再生切替ボタン */}
                            <button
                                onClick={async () => {
                                    const next = !isLoopPreview;
                                    setIsLoopPreview(next);
                                    await native.setPlaybackLoop(next);
                                }}
                                disabled={!hasVoice}
                                style={{
                                    background: isLoopPreview ? 'rgba(46, 213, 115, 0.2)' : '#1b1f27',
                                    color: isLoopPreview ? '#2ed573' : '#747d8c',
                                    border: `1px solid ${isLoopPreview ? '#2ed573' : '#283344'}`,
                                    borderRadius: 6,
                                    padding: '10px 12px',
                                    fontSize: 12,
                                    fontWeight: 800,
                                    cursor: hasVoice ? 'pointer' : 'not-allowed',
                                    opacity: hasVoice ? 1 : 0.4,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    whiteSpace: 'nowrap',
                                }}
                                title={isLoopPreview ? 'ループ再生: ON（クリックでOFF）' : 'ループ再生: OFF（クリックで連続ループON）'}
                            >
                                <IconLoopCycle size={13} color={isLoopPreview ? '#2ed573' : '#747d8c'} />
                                <span>ループ</span>
                                <span style={{ fontSize: 9, fontWeight: 900, background: isLoopPreview ? '#2ed573' : '#2f3542', color: isLoopPreview ? '#0a1017' : '#a4b0be', padding: '1px 4px', borderRadius: 3 }}>
                                    {isLoopPreview ? 'ON' : 'OFF'}
                                </span>
                            </button>

                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ background: '#1c222e', padding: '4px 10px', borderRadius: 6, border: '1px solid #3d4a5d', fontSize: 11, color: '#e0e6ed' }}>
                                    基音: <span style={{ color: '#70a1ff', fontWeight: 800 }}>{synth?.basePitch ? `${Math.round(synth.basePitch)}Hz` : '未設定 (初期倍音)'}</span>
                                </div>
                                <div style={{ background: '#1c222e', padding: '4px 10px', borderRadius: 6, border: '1px solid #3d4a5d', fontSize: 11, color: '#e0e6ed' }}>
                                    音階: <span style={{ color: '#ff6b81', fontWeight: 800 }}>{synth?.basePitch ? '自動アサイン済' : '標準'}</span>
                                </div>
                            </div>
                        </div>

                        {/* 🌊 波形サンプルエディタ（トリミング＆無音カット＆サウンド加工） */}
                        {analysis?.peaks && analysis.peaks.length > 0 && (
                            <div style={{ marginTop: 12, background: '#0a0d14', border: '1px solid #232d3d', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: 11, fontWeight: 800, color: '#70a1ff', display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <IconWaveform size={13} color="#70a1ff" /> 波形サンプル編集（出だしの無音カット・トリミング）
                                    </span>
                                    <span style={{ fontSize: 10, color: '#8898aa' }}>
                                        長さ: {analysis.duration ? `${analysis.duration.toFixed(2)}s` : '-'}
                                    </span>
                                </div>

                                {/* 波形キャンバス & Start/End トリミング領域 */}
                                <div
                                    style={{
                                        position: 'relative',
                                        height: 64,
                                        background: '#07090e',
                                        borderRadius: 6,
                                        border: '1px solid #1a2230',
                                        overflow: 'hidden',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    {/* 波形ピーク描画 */}
                                    <svg width="100%" height="100%" viewBox={`0 -1 ${analysis.peaks.length} 2`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
                                        {analysis.peaks.map((p, i) => (
                                            <line
                                                key={i}
                                                x1={i}
                                                y1={p[0]}
                                                x2={i}
                                                y2={p[1]}
                                                stroke={i / analysis.peaks.length >= trimStart && i / analysis.peaks.length <= trimEnd ? '#2ed573' : '#3d4b66'}
                                                strokeWidth="1"
                                                opacity={i / analysis.peaks.length >= trimStart && i / analysis.peaks.length <= trimEnd ? 0.9 : 0.3}
                                            />
                                        ))}
                                    </svg>

                                    {/* トリミング開始・終了のオーバーレイシャドウ */}
                                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${trimStart * 100}%`, background: 'rgba(0,0,0,0.6)', borderRight: '2px solid #ff4757' }} />
                                    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${(1 - trimEnd) * 100}%`, background: 'rgba(0,0,0,0.6)', borderLeft: '2px solid #ff4757' }} />

                                    {/* スタート位置ラベル */}
                                    <div style={{ position: 'absolute', left: `${trimStart * 100}%`, top: 2, transform: 'translateX(-50%)', background: '#ff4757', color: '#fff', fontSize: 8, fontWeight: 900, padding: '1px 4px', borderRadius: 3, pointerEvents: 'none' }}>
                                        START
                                    </div>
                                    {/* エンド位置ラベル */}
                                    <div style={{ position: 'absolute', left: `${trimEnd * 100}%`, bottom: 2, transform: 'translateX(-50%)', background: '#ff4757', color: '#fff', fontSize: 8, fontWeight: 900, padding: '1px 4px', borderRadius: 3, pointerEvents: 'none' }}>
                                        END
                                    </div>

                                    {/* 📍 リアルタイム再生位置バー（プレイヘッド） */}
                                    {isPlaying && status?.playbackPosition !== undefined && analysis.duration && analysis.duration > 0 && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                left: `${Math.min(100, Math.max(0, (status.playbackPosition / analysis.duration) * 100))}%`,
                                                top: 0,
                                                bottom: 0,
                                                width: 2,
                                                background: '#00f2fe',
                                                boxShadow: '0 0 8px #00f2fe, 0 0 16px rgba(0, 242, 254, 0.8)',
                                                zIndex: 10,
                                                pointerEvents: 'none',
                                                transition: 'left 0.05s linear',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: '50%',
                                                    transform: 'translateX(-50%)',
                                                    width: 6,
                                                    height: 6,
                                                    borderRadius: '50%',
                                                    background: '#ffffff',
                                                    boxShadow: '0 0 6px #00f2fe',
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* トリミングスライダー & クイック加工ツールバー（ゆったり2段構成） */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {/* 1段目: 開始・終了スライダー */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, background: '#0e1219', padding: '6px 12px', borderRadius: 6, border: '1px solid #1a2230' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 10.5, color: '#2ed573', fontWeight: 800, whiteSpace: 'nowrap', minWidth: 54 }}>
                                                開始: {analysis.duration ? `${(trimStart * analysis.duration).toFixed(2)}s` : `${Math.round(trimStart * 100)}%`}
                                            </span>
                                            <input
                                                type="range"
                                                min="0"
                                                max="0.95"
                                                step="0.01"
                                                value={trimStart}
                                                onChange={(e) => {
                                                    const v = parseFloat(e.target.value);
                                                    const nextStart = Math.min(v, trimEnd - 0.05);
                                                    setTrimStart(nextStart);
                                                    native.setPreviewTrimRange(nextStart, trimEnd).catch(() => { });
                                                }}
                                                style={{ flex: 1, accentColor: '#2ed573', height: 4, cursor: 'pointer' }}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 10.5, color: '#70a1ff', fontWeight: 800, whiteSpace: 'nowrap', minWidth: 54 }}>
                                                終了: {analysis.duration ? `${(trimEnd * analysis.duration).toFixed(2)}s` : `${Math.round(trimEnd * 100)}%`}
                                            </span>
                                            <input
                                                type="range"
                                                min="0.05"
                                                max="1"
                                                step="0.01"
                                                value={trimEnd}
                                                onChange={(e) => {
                                                    const v = parseFloat(e.target.value);
                                                    const nextEnd = Math.max(v, trimStart + 0.05);
                                                    setTrimEnd(nextEnd);
                                                    native.setPreviewTrimRange(trimStart, nextEnd).catch(() => { });
                                                }}
                                                style={{ flex: 1, accentColor: '#70a1ff', height: 4, cursor: 'pointer' }}
                                            />
                                        </div>
                                    </div>

                                    {/* 2段目: アクションボタンツールバー */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                        {/* 左側: カット & トリミング確定 */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                            {/* 無音自動カット */}
                                            <button
                                                onClick={async () => {
                                                    if (onAutoTrimVoice) {
                                                        await onAutoTrimVoice();
                                                        setTrimStart(0.0);
                                                        setTrimEnd(1.0);
                                                        await native.setPreviewTrimRange(0.0, 1.0);
                                                    }
                                                }}
                                                style={{
                                                    background: 'linear-gradient(135deg, #e67e22 0%, #d35400 100%)',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    padding: '5px 10px',
                                                    fontSize: 11,
                                                    fontWeight: 800,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                    whiteSpace: 'nowrap',
                                                }}
                                                title="出だしの無音や息を自動検知してジャスト発音位置にトリム"
                                            >
                                                <IconAutoTrim size={12} color="#fff" />
                                                <span>無音自動カット</span>
                                            </button>

                                            {/* トリミング確定 */}
                                            <button
                                                onClick={async () => {
                                                    if (onTrimVoice && (trimStart > 0 || trimEnd < 1)) {
                                                        await onTrimVoice(trimStart, trimEnd);
                                                        setTrimStart(0.0);
                                                        setTrimEnd(1.0);
                                                        await native.setPreviewTrimRange(0.0, 1.0);
                                                    }
                                                }}
                                                disabled={trimStart === 0 && trimEnd === 1}
                                                style={{
                                                    background: trimStart > 0 || trimEnd < 1 ? '#2ed573' : '#2f3542',
                                                    color: trimStart > 0 || trimEnd < 1 ? '#0a1017' : '#747d8c',
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    padding: '5px 10px',
                                                    fontSize: 11,
                                                    fontWeight: 800,
                                                    cursor: trimStart > 0 || trimEnd < 1 ? 'pointer' : 'not-allowed',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                    whiteSpace: 'nowrap',
                                                }}
                                                title="選択した範囲で波形を切り抜き確定"
                                            >
                                                <IconScissorsCut size={12} color={trimStart > 0 || trimEnd < 1 ? '#0a1017' : '#747d8c'} />
                                                <span>トリミング確定</span>
                                            </button>
                                        </div>

                                        {/* 右側: 音量最大化・VOL・逆再生・リセット */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                            {/* 音量最大化 */}
                                            <button
                                                onClick={async () => {
                                                    if (isNormalized) {
                                                        if (onNormalizeVoice) await onNormalizeVoice(false);
                                                        setIsNormalized(false);
                                                        setVoiceGainPercent(100);
                                                    } else {
                                                        if (onNormalizeVoice) await onNormalizeVoice(true);
                                                        setIsNormalized(true);
                                                    }
                                                }}
                                                style={{
                                                    background: isNormalized ? '#2752b8' : '#1e2430',
                                                    color: isNormalized ? '#ffffff' : '#70a1ff',
                                                    border: isNormalized ? '1px solid #3d7eff' : '1px solid #3d4b66',
                                                    borderRadius: 4,
                                                    padding: '5px 9px',
                                                    fontSize: 10.5,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                    boxShadow: isNormalized ? '0 0 8px rgba(61, 126, 255, 0.6)' : 'none',
                                                    transition: 'all 0.15s ease',
                                                    whiteSpace: 'nowrap',
                                                }}
                                                title={isNormalized ? 'クリックで元の録音音量に戻す' : '音量を最大化（ノーマライズ）'}
                                            >
                                                <IconNormalize size={12} color={isNormalized ? '#ffffff' : '#70a1ff'} />
                                                <span>音量最大化 {isNormalized ? 'ON' : 'OFF'}</span>
                                            </button>

                                            {/* コンパクト音量ゲインバー */}
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                    background: '#161920',
                                                    border: '1px solid #2d3340',
                                                    borderRadius: 4,
                                                    padding: '2px 6px',
                                                    height: 24,
                                                }}
                                                title="ダブルクリックで 100% にリセット"
                                                onDoubleClick={async () => {
                                                    setVoiceGainPercent(100);
                                                    if (onSetVoiceGain) await onSetVoiceGain(1.0);
                                                }}
                                            >
                                                <span style={{ fontSize: 9.5, fontWeight: 800, color: '#8395a7' }}>VOL</span>
                                                <input
                                                    type="range"
                                                    min={30}
                                                    max={200}
                                                    value={voiceGainPercent}
                                                    onChange={(e) => {
                                                        const val = parseInt(e.target.value) || 100;
                                                        setVoiceGainPercent(val);
                                                    }}
                                                    onPointerUp={async () => {
                                                        const factor = voiceGainPercent / 100.0;
                                                        if (onSetVoiceGain) await onSetVoiceGain(factor);
                                                    }}
                                                    style={{
                                                        width: 105,
                                                        height: 5,
                                                        accentColor: '#3d7eff',
                                                        cursor: 'pointer',
                                                    }}
                                                />
                                                <span style={{ fontSize: 9.5, fontWeight: 800, color: '#c8d6e5', minWidth: 32, textAlign: 'right' }}>
                                                    {voiceGainPercent}%
                                                </span>
                                            </div>

                                            {/* 逆再生 */}
                                            <button
                                                onClick={async () => {
                                                    if (onReverseVoice) await onReverseVoice();
                                                }}
                                                style={{
                                                    background: '#1e2430',
                                                    color: '#eccc68',
                                                    border: '1px solid #576574',
                                                    borderRadius: 4,
                                                    padding: '5px 8px',
                                                    fontSize: 10.5,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                    whiteSpace: 'nowrap',
                                                }}
                                                title="波形を逆再生にして幻想的なシンセ音に"
                                            >
                                                <IconReverse size={12} color="#eccc68" />
                                                <span>逆再生</span>
                                            </button>

                                            {/* 録音状態にリセット */}
                                            <button
                                                onClick={async () => {
                                                    if (onResetVoice) await onResetVoice();
                                                    setIsNormalized(false);
                                                    setVoiceGainPercent(100);
                                                    setTrimStart(0.0);
                                                    setTrimEnd(1.0);
                                                    await native.setPreviewTrimRange(0.0, 1.0);
                                                }}
                                                style={{
                                                    background: '#1e2430',
                                                    color: '#ff6b81',
                                                    border: '1px solid #576574',
                                                    borderRadius: 4,
                                                    padding: '5px 8px',
                                                    fontSize: 10.5,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                    whiteSpace: 'nowrap',
                                                }}
                                                title="元の録音音声データに完全復元"
                                            >
                                                <IconUndo size={12} color="#ff6b81" />
                                                <span>リセット</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* サウンドコントロール (ADSR & フィルター & マスター) */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                        {/* ADSR エンベロープ */}
                        <div style={{ background: '#141820', border: '1px solid #2d3748', borderRadius: 10, padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <span style={{ fontSize: 12, fontWeight: 800, color: '#a29bfe', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <IconZap size={14} color="#a29bfe" /> 音量エンベロープ (ADSR)
                                </span>

                                {/* 📈 リアルタイム ADSR 曲線 SVG 図解 */}
                                {(() => {
                                    const a = Math.max(0.05, Math.min(1.0, synth.params.attack / 1.5));
                                    const d = Math.max(0.05, Math.min(1.0, synth.params.decay / 1.5));
                                    const s = Math.max(0.05, Math.min(1.0, synth.params.sustain));
                                    const r = Math.max(0.05, Math.min(1.0, synth.params.release / 2.0));
                                    const total = a + d + 0.6 + r;
                                    const w = 110;
                                    const h = 26;
                                    const pA = (a / total) * w;
                                    const pD = pA + (d / total) * w;
                                    const pS = pD + (0.6 / total) * w;
                                    const pR = w;
                                    const sY = h - (s * (h - 4)) - 2;
                                    const dPath = `M 2,${h - 2} L ${pA},2 L ${pD},${sY} L ${pS},${sY} L ${pR - 2},${h - 2}`;

                                    return (
                                        <div style={{ background: '#090d14', border: '1px solid #283344', borderRadius: 6, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 6 }} title="音量の時間変化曲線 (A:立上り → D:減衰 → S:持続 → R:余韻)">
                                            <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
                                                {/* 背景ガイド線 */}
                                                <line x1={0} y1={h - 2} x2={w} y2={h - 2} stroke="#2c384a" strokeWidth={1} />
                                                <line x1={pA} y1={0} x2={pA} y2={h} stroke="#a29bfe" strokeWidth={1} strokeDasharray="2,2" opacity={0.4} />
                                                <line x1={pD} y1={0} x2={pD} y2={h} stroke="#8c7ae6" strokeWidth={1} strokeDasharray="2,2" opacity={0.4} />
                                                <line x1={pS} y1={0} x2={pS} y2={h} stroke="#ffa502" strokeWidth={1} strokeDasharray="2,2" opacity={0.4} />
                                                {/* エンベロープ曲線 */}
                                                <path d={dPath} fill="none" stroke="url(#adsrGrad)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                                                <defs>
                                                    <linearGradient id="adsrGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                                        <stop offset="0%" stopColor="#a29bfe" />
                                                        <stop offset="33%" stopColor="#8c7ae6" />
                                                        <stop offset="66%" stopColor="#ffa502" />
                                                        <stop offset="100%" stopColor="#eccc68" />
                                                    </linearGradient>
                                                </defs>
                                            </svg>
                                        </div>
                                    );
                                })()}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                                <Knob
                                    label="A"
                                    subLabel="立上り"
                                    hint="鍵盤を押してから最大音量に達するまでの時間（0sで即発音、長くするとふわっと出現）"
                                    value={synth.params.attack}
                                    min={0.001}
                                    max={2.0}
                                    step={0.001}
                                    accent="#a29bfe"
                                    format={(v) => `${v.toFixed(3)}s`}
                                    onChange={(v) => onParamChange({ attack: v })}
                                />
                                <Knob
                                    label="D"
                                    subLabel="減衰"
                                    hint="最大音量からサステイン（持続）音量へ落ち着くまでの時間"
                                    value={synth.params.decay}
                                    min={0.001}
                                    max={2.0}
                                    step={0.001}
                                    accent="#8c7ae6"
                                    format={(v) => `${v.toFixed(3)}s`}
                                    onChange={(v) => onParamChange({ decay: v })}
                                />
                                <Knob
                                    label="S"
                                    subLabel="持続音量"
                                    hint="鍵盤を押し続けている間に鳴り続ける音の大きさ（100%で減衰なし、0%でアタック後に消音）"
                                    value={synth.params.sustain}
                                    min={0.0}
                                    max={1.0}
                                    step={0.01}
                                    accent="#ffa502"
                                    format={(v) => `${Math.round(v * 100)}%`}
                                    onChange={(v) => onParamChange({ sustain: v })}
                                />
                                <Knob
                                    label="R"
                                    subLabel="余韻"
                                    hint="鍵盤から指を離した後に音が消えるまでの余韻の長さ"
                                    value={synth.params.release}
                                    min={0.001}
                                    max={3.0}
                                    step={0.001}
                                    accent="#eccc68"
                                    format={(v) => `${v.toFixed(3)}s`}
                                    onChange={(v) => onParamChange({ release: v })}
                                />
                            </div>
                        </div>

                        {/* フィルター & マスター */}
                        <div style={{ background: '#141820', border: '1px solid #2d3748', borderRadius: 10, padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <span style={{ fontSize: 12, fontWeight: 800, color: '#70a1ff', letterSpacing: '0.8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <IconSliders size={14} color="#70a1ff" /> フィルター & 音量 (FILTER)
                                </span>

                                {/* 📈 リアルタイム ローパスフィルター周波数特性 SVG 図解 */}
                                {(() => {
                                    const cutoffRatio = Math.max(0.05, Math.min(0.95, (synth.params.filterCutoff - 100) / 15900));
                                    const reso = Math.max(0.1, Math.min(10.0, synth.params.filterResonance));
                                    const w = 90;
                                    const h = 26;
                                    const cx = cutoffRatio * (w - 14) + 6;
                                    const peakH = Math.min(10, (reso - 0.1) * 1.2);
                                    const dPath = `M 2,${h - 10} L ${cx - 6},${h - 10} Q ${cx},${h - 10 - peakH} ${cx + 4},${h - 10} Q ${cx + 12},${h - 3} ${w - 2},${h - 2}`;

                                    return (
                                        <div style={{ background: '#090d14', border: '1px solid #283344', borderRadius: 6, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 6 }} title="フィルター周波数特性 (左:低音通過 / 右:高音カット)">
                                            <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
                                                <line x1={0} y1={h - 2} x2={w} y2={h - 2} stroke="#2c384a" strokeWidth={1} />
                                                <line x1={cx} y1={0} x2={cx} y2={h} stroke="#70a1ff" strokeWidth={1} strokeDasharray="2,2" opacity={0.5} />
                                                <path d={dPath} fill="none" stroke="#70a1ff" strokeWidth={2.2} strokeLinecap="round" />
                                            </svg>
                                        </div>
                                    );
                                })()}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                                <Knob
                                    label="CUTOFF"
                                    subLabel="明るさ"
                                    hint="音の明るさ・高音域のカットオフ周波数（左に回すとこもった温かい音、右でクリアで明るい音）"
                                    value={synth.params.filterCutoff}
                                    min={100}
                                    max={16000}
                                    step={10}
                                    accent="#70a1ff"
                                    format={(v) => `${Math.round(v)}Hz`}
                                    onChange={(v) => onParamChange({ filterCutoff: v })}
                                />
                                <Knob
                                    label="RESO"
                                    subLabel="クセ/響き"
                                    hint="レゾナンス（カットオフ周波数付近を強調してシュワシュワ・ミョンミョンしたシンセ特有のクセを付加）"
                                    value={synth.params.filterResonance}
                                    min={0.1}
                                    max={10.0}
                                    step={0.1}
                                    accent="#2ed573"
                                    format={(v) => v.toFixed(1)}
                                    onChange={(v) => onParamChange({ filterResonance: v })}
                                />
                                <Knob
                                    label="GAIN"
                                    subLabel="マスター音量"
                                    hint="シンセサイザーの最終出力音量（100%が基準、歪まないよう適宜調整）"
                                    value={synth.params.masterGain}
                                    min={0.0}
                                    max={2.0}
                                    step={0.01}
                                    accent="#ffffff"
                                    format={(v) => `${Math.round(v * 100)}%`}
                                    onChange={(v) => onParamChange({ masterGain: v })}
                                />
                            </div>
                        </div>
                    </div>

                    {/*==========================================================*/}
                    {/* 🎤 保存済みボイス音源ライブラリ（Synth1 スタイル高密度ブラウザ） */}
                    <div style={{ background: '#12161f', border: '1px solid #283344', borderRadius: 10, padding: 14, boxSizing: 'border-box', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, boxSizing: 'border-box' }}>
                            {/* タイトル */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 900, color: '#2ed573', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <IconSynth size={16} color="#2ed573" /> マイ・ボイス音源ライブラリ ({voices.length})
                                </span>
                            </div>

                            {/* 検索バー */}
                            <div style={{ position: 'relative', width: 200, flexShrink: 0, boxSizing: 'border-box' }}>
                                <input
                                    type="text"
                                    placeholder="ボイスを検索..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{
                                        width: '100%',
                                        background: '#090d14',
                                        color: '#f1f2f6',
                                        border: '1px solid #2c384a',
                                        borderRadius: 6,
                                        padding: '5px 10px 5px 28px',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        outline: 'none',
                                        boxSizing: 'border-box',
                                    }}
                                />
                                <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                                    <IconSearch size={12} color="#747d8c" />
                                </span>
                            </div>
                        </div>

                        {/* 新規ボイス名保存バー */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <input
                                type="text"
                                value={voiceName}
                                onChange={(e) => onVoiceNameChange(e.target.value)}
                                placeholder="現在の音声を新しいボイス名で保存..."
                                onKeyDown={(e) => e.key === 'Enter' && onSaveVoice()}
                                style={{
                                    flex: 1,
                                    background: '#0a0d13',
                                    color: '#fff',
                                    border: '1px solid #3c3858',
                                    borderRadius: 6,
                                    padding: '7px 12px',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    outline: 'none',
                                }}
                            />
                            <button
                                onClick={onSaveVoice}
                                disabled={!hasVoice}
                                style={{
                                    background: hasVoice ? '#1c2822' : '#14171d',
                                    color: hasVoice ? '#2ecc71' : '#636e72',
                                    border: `1px solid ${hasVoice ? 'rgba(46, 204, 113, 0.55)' : '#283344'}`,
                                    borderRadius: 6,
                                    padding: '7px 18px',
                                    fontWeight: 900,
                                    fontSize: 12,
                                    cursor: hasVoice ? 'pointer' : 'not-allowed',
                                    boxShadow: 'none',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                現在の音を保存
                            </button>
                        </div>

                        {/* ボイス音源一覧：番号付き高密度グリッドリスト */}
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                                gap: 8,
                                maxHeight: 240,
                                overflowY: 'auto',
                                paddingRight: 4,
                            }}
                        >
                            {filteredVoices.length === 0 ? (
                                <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#747d8c', padding: 20, textAlign: 'center' }}>
                                    {voices.length === 0 ? 'マイクで声を録音すると、ここにボイス音源が保存されます' : '一致するボイス音源がありません'}
                                </div>
                            ) : (
                                filteredVoices.map((v) => {
                                    const idx = v.originalIndex;
                                    const isEditing = editingVoiceIdx === idx;
                                    return (
                                        <div
                                            key={idx}
                                            onClick={async () => {
                                                if (!isEditing) {
                                                    setTrimStart(0.0);
                                                    setTrimEnd(1.0);
                                                    await onLoadVoice(idx);
                                                }
                                            }}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                background: '#19202c',
                                                border: '1px solid #313e52',
                                                borderRadius: 6,
                                                padding: '6px 10px',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s ease',
                                                userSelect: 'none',
                                            }}
                                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#2ed573')}
                                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#313e52')}
                                        >
                                            {/* 番号 */}
                                            <span style={{ fontSize: 11, fontWeight: 900, color: '#2ed573', width: 26, flexShrink: 0 }}>
                                                {idx < 10 ? `0${idx}` : idx}
                                            </span>

                                            {/* 名前 */}
                                            {isEditing ? (
                                                <input
                                                    type="text"
                                                    value={editVoiceText}
                                                    onChange={(e) => setEditVoiceText(e.target.value)}
                                                    onBlur={() => commitRenameVoice(idx)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') commitRenameVoice(idx);
                                                        if (e.key === 'Escape') setEditingVoiceIdx(null);
                                                    }}
                                                    autoFocus
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{
                                                        flex: 1,
                                                        background: '#090c10',
                                                        color: '#fff',
                                                        border: '1px solid #2ed573',
                                                        borderRadius: 4,
                                                        padding: '2px 6px',
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                        outline: 'none',
                                                    }}
                                                />
                                            ) : (
                                                <div style={{ flex: 1, overflow: 'hidden' }} onDoubleClick={(e) => startRenameVoice(idx, v.name, e)}>
                                                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f2f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {v.name}
                                                    </div>
                                                    <div style={{ fontSize: 9, color: '#888' }}>
                                                        {formatTime(v.duration)} / {v.noteCount}音
                                                    </div>
                                                </div>
                                            )}

                                            {/* 操作ボタン */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6, flexShrink: 0 }}>
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        setTrimStart(0.0);
                                                        setTrimEnd(1.0);
                                                        await onLoadVoice(idx);
                                                        if (onPlayToggle) onPlayToggle();
                                                    }}
                                                    style={{
                                                        background: '#2f3542',
                                                        border: 'none',
                                                        color: '#2ed573',
                                                        padding: '3px 7px',
                                                        borderRadius: 4,
                                                        fontSize: 10,
                                                        fontWeight: 800,
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 3,
                                                    }}
                                                    title="このボイス音源を試聴"
                                                >
                                                    <IconPlay size={9} color="#2ed573" />
                                                    <span>試聴</span>
                                                </button>
                                                <button
                                                    onClick={(e) => startRenameVoice(idx, v.name, e)}
                                                    style={{ background: 'transparent', border: 'none', color: '#747d8c', padding: '3px 4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                                    title="名前を変更"
                                                >
                                                    <IconEdit size={11} color="#747d8c" />
                                                </button>
                                                {confirmDeleteVoiceIdx === idx ? (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onDeleteVoice(idx);
                                                            setConfirmDeleteVoiceIdx(null);
                                                        }}
                                                        onMouseLeave={() => setConfirmDeleteVoiceIdx(null)}
                                                        style={{
                                                            background: '#ff4757',
                                                            border: 'none',
                                                            color: '#fff',
                                                            padding: '2px 6px',
                                                            borderRadius: 4,
                                                            fontSize: 9,
                                                            fontWeight: 900,
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 2,
                                                            animation: 'pulse 1s infinite alternate',
                                                            boxShadow: '0 0 8px rgba(255, 71, 87, 0.6)',
                                                        }}
                                                        title="もう一度クリックして削除を確定"
                                                    >
                                                        <span>削除?</span>
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setConfirmDeleteVoiceIdx(idx);
                                                            setTimeout(() => {
                                                                setConfirmDeleteVoiceIdx((curr) => (curr === idx ? null : curr));
                                                            }, 3000);
                                                        }}
                                                        style={{
                                                            background: 'transparent',
                                                            border: 'none',
                                                            color: '#747d8c',
                                                            padding: '3px 4px',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            borderRadius: 3,
                                                            transition: 'all 0.15s ease',
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.color = '#ff4757';
                                                            e.currentTarget.style.background = 'rgba(255, 71, 87, 0.15)';
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.color = '#747d8c';
                                                            e.currentTarget.style.background = 'transparent';
                                                        }}
                                                        title="ボイス音源を削除（クリックで確認）"
                                                    >
                                                        <IconClose size={10} color="currentColor" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ➕ 別名で新規保存モーダル */}
            {saveAsModalOpen && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 99999,
                        background: 'rgba(0, 0, 0, 0.75)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={() => setSaveAsModalOpen(false)}
                >
                    <div
                        style={{
                            background: '#161922',
                            border: '1px solid #3d4b66',
                            borderRadius: 12,
                            padding: '20px 24px',
                            width: 360,
                            maxWidth: '90vw',
                            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.9), 0 0 24px rgba(112, 161, 255, 0.2)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 16,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ background: 'rgba(112, 161, 255, 0.15)', padding: 8, borderRadius: 8 }}>
                                <IconSynth size={20} color="#70a1ff" />
                            </div>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 900, color: '#f1f2f6' }}>
                                    新しい音源として保存
                                </div>
                                <div style={{ fontSize: 11, color: '#a4b0be' }}>
                                    現在のエフェクト設定で新プリセットを作成します
                                </div>
                            </div>
                        </div>

                        <div>
                            <label style={{ fontSize: 11, fontWeight: 700, color: '#747d8c', display: 'block', marginBottom: 6 }}>
                                新しい音源名 (Voice Name)
                            </label>
                            <input
                                type="text"
                                autoFocus
                                value={newSaveName}
                                onChange={(e) => setNewSaveName(e.target.value)}
                                onKeyDown={async (e) => {
                                    if (e.key === 'Enter') {
                                        const finalName = newSaveName.trim() || 'Custom Voice';
                                        if (onSaveVoiceAs) await onSaveVoiceAs(finalName);
                                        setSaveAsModalOpen(false);
                                        setSaveToast(`✅ 「${finalName}」を新規音源として保存しました！`);
                                        setTimeout(() => setSaveToast(null), 3000);
                                    } else if (e.key === 'Escape') {
                                        setSaveAsModalOpen(false);
                                    }
                                }}
                                placeholder="例: リードボーカル A, ディレイシンセ"
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    background: '#0d1017',
                                    border: '1px solid #3d4b66',
                                    borderRadius: 6,
                                    padding: '9px 12px',
                                    color: '#ffffff',
                                    fontSize: 13,
                                    fontWeight: 700,
                                    outline: 'none',
                                }}
                            />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                            <button
                                onClick={() => setSaveAsModalOpen(false)}
                                style={{
                                    background: 'transparent',
                                    border: '1px solid #3d4a5d',
                                    borderRadius: 6,
                                    padding: '7px 14px',
                                    color: '#a4b0be',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                }}
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={async () => {
                                    const finalName = newSaveName.trim() || 'Custom Voice';
                                    if (onSaveVoiceAs) await onSaveVoiceAs(finalName);
                                    setSaveAsModalOpen(false);
                                    setSaveToast(`「${finalName}」を新規音源として保存しました！`);
                                    setTimeout(() => setSaveToast(null), 3000);
                                }}
                                style={{
                                    background: 'linear-gradient(135deg, #70a1ff 0%, #3742fa 100%)',
                                    border: 'none',
                                    borderRadius: 6,
                                    padding: '7px 16px',
                                    color: '#ffffff',
                                    fontSize: 12,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    boxShadow: '0 0 12px rgba(112, 161, 255, 0.4)',
                                }}
                            >
                                <IconSave size={14} color="#ffffff" />
                                <span>新規保存</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
