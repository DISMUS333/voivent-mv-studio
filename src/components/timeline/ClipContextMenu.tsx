// クリップ右クリック・コンテキストメニュー（EQ・声シンセ編集・ノート操作・音源変換・複製・削除）。
import { useRef, useState } from 'react';

import { native } from '../../native';
import type { Status, VoiceLibraryEntry } from '../../types';
import {
    IconSliders,
    IconClose,
    IconPiano,
    IconCopy,
    IconTrash,
    IconSynth,
    IconSparkles,
    IconPlay,
    IconPause,
    IconMic,
} from '../Icons';
import type { NoteSelection } from './types';

export function ClipContextMenu(props: {
    x: number;
    y: number;
    track: number;
    clip: number;
    status: Status | null;
    selectedNotes: NoteSelection;
    selectedClipNote: { track: number; clip: number; note: number } | null;
    selectedClips: Array<{ track: number; clip: number }>;
    voices: VoiceLibraryEntry[];
    trackName: string;
    onClose: () => void;
    onOpenEqModalForClip?: (track: number, clip: number) => void;
    onOpenSynthEditorForClip?: (track: number, clip: number) => void;
    onDuplicateNotes?: () => void;
    onDeleteNotes?: () => void;
    onPlayClipAsSequence?: (track: number, clip: number) => void;
    onConvertClipToVoice?: (track: number, clip: number, voiceIndex: number, mode?: number) => void;
    onPlayClipWithVoice?: (track: number, clip: number, voiceIndex: number) => void;
    onDuplicateClip?: () => void;
    onOpenPianoRoll?: (track: number, clip: number) => void;
    onSaveVoiceRequest: (track: number, clip: number) => void;
    onDeleteClip?: (track: number, clip: number) => void;
    onDeleteClips?: (clips: Array<{ track: number; clip: number }>) => void;
}) {
    const {
        x,
        y,
        track,
        clip,
        status,
        selectedNotes,
        selectedClipNote,
        selectedClips,
        voices,
        trackName,
        onClose,
        onOpenEqModalForClip,
        onOpenSynthEditorForClip,
        onDuplicateNotes,
        onDeleteNotes,
        onPlayClipAsSequence,
        onConvertClipToVoice,
        onPlayClipWithVoice,
        onDuplicateClip,
        onOpenPianoRoll,
        onSaveVoiceRequest,
        onDeleteClip,
        onDeleteClips,
    } = props;

    // 生試聴 / MIDI試聴のプレビュー状態（メニュー内で完結）
    const [previewAudition, setPreviewAudition] = useState<{ vIdx: number; mode: number } | null>(null);

    // メニュー表示位置（ヘッダー掴みドラッグで移動、初期値は右クリック座標）
    const [menuPos, setMenuPos] = useState({ x, y });
    const dragStateRef = useRef<{ isDragging: boolean; startX: number; startY: number; origMenuX: number; origMenuY: number } | null>(null);

    return (
        <div
            style={{
                position: 'fixed',
                left: 0,
                top: 0,
                width: '100vw',
                height: '100vh',
                zIndex: 9999,
            }}
            onClick={onClose}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    left: Math.max(10, Math.min(menuPos.x, window.innerWidth - 460)),
                    top: Math.max(10, Math.min(menuPos.y, window.innerHeight - 480)),
                    background: '#1a1d26',
                    border: '1px solid #3d4b66',
                    borderRadius: 8,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.85), 0 0 1px rgba(255,255,255,0.2)',
                    padding: 8,
                    minWidth: 440,
                    maxWidth: 460,
                    maxHeight: 'calc(100vh - 40px)',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    userSelect: 'none',
                    zIndex: 10000,
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ドラッグ移動可能なヘッダー & 閉じるボタン */}
                <div
                    style={{
                        fontSize: 10,
                        fontWeight: 900,
                        color: '#94a3b8',
                        padding: '6px 8px',
                        borderBottom: '1px solid #283344',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'grab',
                        background: 'linear-gradient(180deg, #222938 0%, #1a1e29 100%)',
                        borderRadius: '6px 6px 0 0',
                        marginBottom: 2,
                    }}
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                        dragStateRef.current = {
                            isDragging: true,
                            startX: e.clientX,
                            startY: e.clientY,
                            origMenuX: menuPos.x,
                            origMenuY: menuPos.y,
                        };
                    }}
                    onPointerMove={(e) => {
                        if (!dragStateRef.current?.isDragging) return;
                        e.stopPropagation();
                        const dx = e.clientX - dragStateRef.current.startX;
                        const dy = e.clientY - dragStateRef.current.startY;
                        setMenuPos({
                            x: dragStateRef.current.origMenuX + dx,
                            y: dragStateRef.current.origMenuY + dy,
                        });
                    }}
                    onPointerUp={(e) => {
                        if (dragStateRef.current?.isDragging) {
                            e.stopPropagation();
                            try { (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); } catch (_) { }
                            dragStateRef.current = null;
                        }
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <IconSliders size={12} color="#70a1ff" />
                        <span>クリップ操作（ドラッグで移動可能）</span>
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        title="閉じる"
                    >
                        <IconClose size={13} color="#cbd5e1" />
                    </button>
                </div>

                {/* 本格4バンドEQ & 音量ゲイン */}
                <button
                    onClick={() => {
                        onOpenEqModalForClip?.(track, clip);
                        onClose();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        background: 'linear-gradient(135deg, rgba(112, 224, 255, 0.18) 0%, rgba(52, 152, 219, 0.28) 100%)',
                        color: '#70e0ff',
                        border: '1px solid rgba(112, 224, 255, 0.45)',
                        borderRadius: 6,
                        padding: '7px 10px',
                        fontSize: 11.5,
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'left',
                        boxShadow: '0 2px 8px rgba(52, 152, 219, 0.25)',
                    }}
                    title="4バンド・パラメトリックEQを開き、周波数カーブ・音量ブースト・抜け感補正を編集"
                >
                    <IconSliders size={16} color="#70e0ff" />
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>4-Band EQ (イコライザー)</div>
                        <div style={{ fontSize: 9.5, color: '#bfeaff', opacity: 0.85 }}>周波数バランス・音質調整</div>
                    </div>
                </button>

                {/* 声シンセで詳細編集（波形カット・音量増幅・ADSR・フィルター） */}
                <button
                    onClick={() => {
                        onOpenSynthEditorForClip?.(track, clip);
                        onClose();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        background: 'linear-gradient(135deg, rgba(255, 107, 129, 0.18) 0%, rgba(255, 71, 87, 0.28) 100%)',
                        color: '#ff6b81',
                        border: '1px solid rgba(255, 107, 129, 0.45)',
                        borderRadius: 6,
                        padding: '7px 10px',
                        fontSize: 11.5,
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'left',
                        boxShadow: '0 2px 8px rgba(255, 71, 87, 0.25)',
                    }}
                    title="このクリップの歌声を声シンセで開き、波形トリミング・音量ブースト・無音カット・ADSR・フィルターを編集"
                >
                    <IconSynth size={16} color="#ff6b81" />
                    <div>
                        <div>声シンセで詳細編集</div>
                        <div style={{ fontSize: 9.5, color: '#ffb8b8', fontWeight: 500 }}>波形トリミング・音量ブースト・無音カット・エフェクト</div>
                    </div>
                </button>

                {/* 選択中のノート操作（範囲選択・クリック選択したノートの複製・削除） */}
                {((selectedNotes && selectedNotes.track === track && selectedNotes.clip === clip && selectedNotes.notes.length > 0) ||
                    (selectedClipNote && selectedClipNote.track === track && selectedClipNote.clip === clip)) && (
                        <div style={{ background: '#181e2b', border: '1px solid #3b82f6', borderRadius: 7, padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontSize: 10, fontWeight: 900, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <IconPiano size={12} color="#60a5fa" />
                                <span>選択中のノート ({selectedNotes?.notes?.length || 1}個) 操作:</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                {/* 選択ノートを複製 */}
                                <button
                                    onClick={() => {
                                        onDuplicateNotes?.();
                                        onClose();
                                    }}
                                    style={{
                                        flex: 1,
                                        background: 'linear-gradient(135deg, #1e3799 0%, #0c2461 100%)',
                                        color: '#ffffff',
                                        border: '1px solid #3d7eff',
                                        borderRadius: 5,
                                        padding: '6px 8px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 4,
                                        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                                    }}
                                    title="選択中のノート群を直後に複製"
                                >
                                    <IconCopy size={12} color="#70a1ff" />
                                    <span>選択ノートを複製</span>
                                </button>

                                {/* 選択ノートを削除 */}
                                <button
                                    onClick={() => {
                                        onDeleteNotes?.();
                                        onClose();
                                    }}
                                    style={{
                                        background: '#2b1d20',
                                        color: '#ff6b81',
                                        border: '1px solid rgba(255, 71, 87, 0.4)',
                                        borderRadius: 5,
                                        padding: '6px 8px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                    }}
                                    title="選択中のノートを一括削除"
                                >
                                    <IconTrash size={12} color="#ff6b81" />
                                    <span>削除</span>
                                </button>
                            </div>
                        </div>
                    )}

                {/* 声シンセに変換して演奏 */}
                <button
                    onClick={() => {
                        onPlayClipAsSequence?.(track, clip);
                        onClose();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        background: 'linear-gradient(135deg, #1a2e1a 0%, #122012 100%)',
                        color: '#a8ff3e',
                        border: '1px solid rgba(168, 255, 62, 0.3)',
                        borderRadius: 6,
                        padding: '8px 10px',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <IconPiano size={16} color="#a8ff3e" />
                    <div>
                        <div>声シンセに変換して演奏</div>
                        <div style={{ fontSize: 10, color: '#88a870', fontWeight: 500 }}>歌声のリズム・音程でシンセ化</div>
                    </div>
                </button>

                {/* 他のボイス音源を選んでこのリズム・音程で演奏 / タイムライン音色を完全置換 */}
                {voices && voices.length > 0 && (
                    <div style={{ background: '#12151d', border: '1px solid #232d3d', borderRadius: 7, padding: '6px 8px' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#70a1ff', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <IconPiano size={11} color="#70a1ff" />
                            <span>このリズムで鳴らす声シンセ音源を選択:</span>
                        </div>
                        <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {voices.map((v, vIdx) => (
                                <div
                                    key={vIdx}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        background: '#181d28',
                                        border: '1px solid #2a3547',
                                        borderRadius: 5,
                                        padding: '5px 8px',
                                        gap: 8,
                                    }}
                                >
                                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#f1f2f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 90 }}>
                                        {v.name}
                                    </span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                        {/* 生同期 確定 */}
                                        <button
                                            onClick={() => {
                                                onConvertClipToVoice?.(track, clip, vIdx, 0);
                                                onClose();
                                            }}
                                            style={{
                                                background: 'linear-gradient(135deg, #2ed573 0%, #10ac84 100%)',
                                                color: '#0a1017',
                                                border: 'none',
                                                borderRadius: 4,
                                                padding: '3px 6px',
                                                fontSize: 9,
                                                fontWeight: 900,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 3,
                                                boxShadow: '0 2px 6px rgba(46, 213, 115, 0.4)',
                                            }}
                                            title={`【生同期】声の生波形・アタック感を100%維持して「${v.name}」のシンセ音に確定変換`}
                                        >
                                            <IconSparkles size={10} color="#0a1017" />
                                            <span>生同期</span>
                                        </button>

                                        {/* 生試聴（生波形シンセ音のプレビュー再生 / 停止） */}
                                        <button
                                            onClick={async () => {
                                                if (previewAudition?.vIdx === vIdx && previewAudition?.mode === 0 && status?.isPlaying) {
                                                    setPreviewAudition(null);
                                                    await native.stopPlayback();
                                                } else {
                                                    setPreviewAudition({ vIdx, mode: 0 });
                                                    await native.previewClipSynth(track, clip, vIdx, 0);
                                                }
                                            }}
                                            style={{
                                                background: previewAudition?.vIdx === vIdx && previewAudition?.mode === 0 && status?.isPlaying ? '#ff4757' : '#142a20',
                                                color: previewAudition?.vIdx === vIdx && previewAudition?.mode === 0 && status?.isPlaying ? '#ffffff' : '#2ed573',
                                                border: previewAudition?.vIdx === vIdx && previewAudition?.mode === 0 && status?.isPlaying ? '1px solid #ff6b81' : '1px solid rgba(46, 213, 115, 0.45)',
                                                borderRadius: 4,
                                                padding: '3px 6px',
                                                fontSize: 9,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 2,
                                                boxShadow: previewAudition?.vIdx === vIdx && previewAudition?.mode === 0 && status?.isPlaying ? '0 0 8px rgba(255, 71, 87, 0.6)' : 'none',
                                            }}
                                            title={`生同期の音色をプレビュー試聴（クリックで再生/停止）`}
                                        >
                                            {previewAudition?.vIdx === vIdx && previewAudition?.mode === 0 && status?.isPlaying ? (
                                                <IconPause size={9} color="#ffffff" />
                                            ) : (
                                                <IconPlay size={9} color="#2ed573" />
                                            )}
                                            <span>{previewAudition?.vIdx === vIdx && previewAudition?.mode === 0 && status?.isPlaying ? '停止' : '生試聴'}</span>
                                        </button>

                                        {/* MIDI 確定 */}
                                        <button
                                            onClick={() => {
                                                onConvertClipToVoice?.(track, clip, vIdx, 1);
                                                onClose();
                                            }}
                                            style={{
                                                background: 'linear-gradient(135deg, #3d7eff 0%, #1e3799 100%)',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: 4,
                                                padding: '3px 6px',
                                                fontSize: 9,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 3,
                                            }}
                                            title={`【MIDI同期】検出ノート単位でクオンタイズして「${v.name}」でシンセ化`}
                                        >
                                            <IconPiano size={10} color="#ffffff" />
                                            <span>MIDI</span>
                                        </button>

                                        {/* MIDI試聴（MIDIノートシーケンスのプレビュー再生 / 停止） */}
                                        <button
                                            onClick={async () => {
                                                if (previewAudition?.vIdx === vIdx && previewAudition?.mode === 1 && (status?.isPlaying || status?.isSessionPlaying)) {
                                                    setPreviewAudition(null);
                                                    await native.setSequencerPlaying(false);
                                                } else {
                                                    setPreviewAudition({ vIdx, mode: 1 });
                                                    onPlayClipWithVoice?.(track, clip, vIdx);
                                                }
                                            }}
                                            style={{
                                                background: previewAudition?.vIdx === vIdx && previewAudition?.mode === 1 && (status?.isPlaying || status?.isSessionPlaying) ? '#ff4757' : '#1c2433',
                                                color: previewAudition?.vIdx === vIdx && previewAudition?.mode === 1 && (status?.isPlaying || status?.isSessionPlaying) ? '#ffffff' : '#70a1ff',
                                                border: previewAudition?.vIdx === vIdx && previewAudition?.mode === 1 && (status?.isPlaying || status?.isSessionPlaying) ? '1px solid #ff6b81' : '1px solid rgba(112, 161, 255, 0.4)',
                                                borderRadius: 4,
                                                padding: '3px 6px',
                                                fontSize: 9,
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 2,
                                                boxShadow: previewAudition?.vIdx === vIdx && previewAudition?.mode === 1 && (status?.isPlaying || status?.isSessionPlaying) ? '0 0 8px rgba(255, 71, 87, 0.6)' : 'none',
                                            }}
                                            title={`MIDI同期シーケンスをプレビュー試聴（クリックで再生/停止）`}
                                        >
                                            {previewAudition?.vIdx === vIdx && previewAudition?.mode === 1 && (status?.isPlaying || status?.isSessionPlaying) ? (
                                                <IconPause size={9} color="#ffffff" />
                                            ) : (
                                                <IconPlay size={9} color="#70a1ff" />
                                            )}
                                            <span>{previewAudition?.vIdx === vIdx && previewAudition?.mode === 1 && (status?.isPlaying || status?.isSessionPlaying) ? '停止' : '試聴'}</span>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* クリップ複製（単一または複数一括） */}
                <button
                    onClick={() => {
                        onDuplicateClip?.();
                        onClose();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        background: 'linear-gradient(135deg, #1e2638 0%, #151b27 100%)',
                        color: '#ffffff',
                        border: '1px solid #3d7eff',
                        borderRadius: 6,
                        padding: '7px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <IconCopy size={14} color="#70a1ff" />
                    <span>
                        {selectedClips && selectedClips.length > 1
                            ? `選択中のクリップ (${selectedClips.length}個) を一括複製`
                            : 'クリップ全体を複製'}
                    </span>
                </button>

                {/* ピアノロールで編集 */}
                <button
                    onClick={() => {
                        onOpenPianoRoll?.(track, clip);
                        onClose();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        background: 'linear-gradient(135deg, rgba(112, 161, 255, 0.15) 0%, rgba(77, 124, 255, 0.25) 100%)',
                        color: '#70a1ff',
                        border: '1px solid rgba(112, 161, 255, 0.4)',
                        borderRadius: 6,
                        padding: '8px 10px',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <IconPiano size={15} color="#70a1ff" />
                    <span>ピアノロールで編集</span>
                </button>

                <button
                    onClick={() => {
                        onSaveVoiceRequest(track, clip);
                        onClose();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        background: 'linear-gradient(135deg, #18202c 0%, #121822 100%)',
                        color: '#70a1ff',
                        border: '1px solid rgba(112, 161, 255, 0.25)',
                        borderRadius: 6,
                        padding: '7px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <IconMic size={15} color="#70a1ff" />
                    <span>この歌声をシンセ音源 (Voice) に設定</span>
                </button>

                <div style={{ height: 1, background: '#283344', margin: '2px 0' }} />

                <button
                    onClick={() => {
                        if (selectedClips && selectedClips.length > 1) {
                            onDeleteClips?.(selectedClips);
                        } else {
                            onDeleteClip?.(track, clip);
                        }
                        onClose();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        background: '#2b1d20',
                        color: '#ff6b81',
                        border: '1px solid rgba(255, 71, 87, 0.3)',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <IconTrash size={14} color="#ff6b81" />
                    <span>
                        {selectedClips && selectedClips.length > 1
                            ? `選択中のクリップ (${selectedClips.length}個) を削除`
                            : 'クリップを削除'}
                    </span>
                </button>
            </div>
        </div>
    );
}
