//==============================================================================
//　トラック / タイムライン表示。
//  - クリップのドラッグ移動・トラック間移動
//  - 範囲ツール（枠囲い）による複数ノート選択
//  - 選択ノートの削除 / 複製
//  - カットツール（任意位置にカーソルを置いて分割）
//==============================================================================
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { native } from '../native';
import type { LiveMidiNote, SessionState, Status, VoiceLibraryEntry } from '../types';
import type { ThemeConfig } from '../theme';
import { formatTime, noteName } from '../lib/music';
import {
    IconPlay,
    IconRecord,
    IconSpeaker,
    IconStop,
    IconScissors,
    IconTrash,
    IconPrevLocator,
    IconNextLocator,
    IconFastRewind,
    IconFastForward,
    IconReturnToStart,
    IconLoopCycle,
    IconPlus,
    IconMarquee,
    IconPiano,
    IconMic,
    IconMicrophone,
    IconTimer,
    IconCopy,
    IconSliders,
    IconSparkles,
    IconPause,
    IconClose,
    IconSynth,
    IconMagnet,
    IconFollowPlayhead,
} from './Icons';

import type { NoteSelection, CutCursor, MarqueeRect } from './timeline/types';
import { TransportBar } from './timeline/TransportBar';
import { TimelineToolbar } from './timeline/TimelineToolbar';
import { TimelineRuler } from './timeline/TimelineRuler';
import { ClipContextMenu } from './timeline/ClipContextMenu';
import { TrackContextMenu, type TrackInstrumentKind } from './timeline/TrackContextMenu';
import { SaveVoiceModal } from './timeline/SaveVoiceModal';

export type { NoteSelection, CutCursor, MarqueeRect };

export function SessionTimeline(props: {
    theme?: ThemeConfig;
    session: SessionState | null;
    status: Status | null;
    recSeconds?: number;
    recStartSeconds?: number;
    isMidiRecording?: boolean;
    liveMidiNotes?: unknown[];
    selectedClip: { track: number; clip: number } | null;
    selectedClips?: Array<{ track: number; clip: number }>;
    selectedClipNote: { track: number; clip: number; note: number } | null;
    selectedNotes: NoteSelection;
    cutCursor: CutCursor;
    cutToolActive: boolean;
    rangeToolActive: boolean;
    snapEnabled?: boolean;
    onToggleSnap?: () => void;
    followPlayhead?: boolean;
    onToggleFollowPlayhead?: () => void;
    zoomAnchorMode?: 'mouse' | 'playhead';
    dragPreview: { clips: Array<{ track: number; clip: number }>; dx: number; dy: number; targetTrack?: number } | null;
    dragRef: React.MutableRefObject<{ track: number; clip: number; origStart: number; startX: number; startY: number; pxPerSec: number; moved: boolean; clips: Array<{ track: number; clip: number }> } | null>;
    onSessionPlayToggle: () => void;
    onAddTrack: () => void;
    onDeleteTrack?: (track: number) => void;
    onOpenFxChain?: (track: number) => void;
    onArmed: (track: number, v: boolean) => void;
    onSetTrackInputType?: (track: number, inputType: 'audio' | 'midi') => void;
    onMonitor: (track: number, v: boolean) => void;
    onMute: (track: number, v: boolean) => void;
    onSolo: (track: number, v: boolean) => void;
    onGain: (track: number, v: number) => void;
    onPan: (track: number, v: number) => void;
    onAppendClip: (track: number) => void;
    onDuplicateClip: () => void;
    onDuplicateNotes: () => void;
    onDeleteNotes: () => void;
    onDeleteClip?: (track: number, clip: number) => void;
    onDeleteClips?: (clips: Array<{ track: number; clip: number }>) => void;
    onSeek?: (seconds: number) => void;
    onToggleCutTool: () => void;
    onToggleRangeTool: () => void;
    onCutAtCursor: () => void;
    onCutDirect?: (track: number, clip: number, timeSeconds: number) => void;
    onClipPointerDown: (e: ReactPointerEvent<HTMLDivElement>, track: number, clip: number, start: number, pxPerSec: number) => void;
    onClipPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onClipPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onTrimClip?: (track: number, clip: number, newStart: number, sourceStart: number, duration: number) => void;
    onSelectClip: (track: number, clip: number) => void;
    onSelectClips?: (clips: Array<{ track: number; clip: number }>) => void;
    onSelectClipNote: (track: number, clip: number, note: number) => void;
    onMarqueeSelect: (track: number, clip: number, notes: number[]) => void;
    onSetCutCursor: (track: number, clip: number, timeSeconds: number) => void;
    onAssignClipToSynth?: (track: number, clip: number, name?: string) => void;
    onPlayClipAsSequence?: (track: number, clip: number) => void;
    onPlayClipWithVoice?: (track: number, clip: number, voiceIndex: number) => void;
    onConvertClipToVoice?: (track: number, clip: number, voiceIndex: number, mode?: number) => void;
    onInsertVoiceClip?: (track: number, voiceIndex?: number, startSeconds?: number) => void;
    onDropVirtualAnalog?: (track: number, startSeconds?: number) => void;
    onDropVoiceChanger?: (track: number) => void;
    onOpenPianoRoll?: (track: number, clip: number) => void;
    onOpenSynthEditorForClip?: (track: number, clip: number) => void;
    onOpenEqModalForClip?: (track: number, clip: number) => void;
    voices?: VoiceLibraryEntry[];
    onLoadVoice?: (index: number) => Promise<void> | void;
    vaPresets?: Array<{ name: string; params: Record<string, number> }>;
    onLoadVirtualAnalogPreset?: (index: number) => Promise<void> | void;
    onSelectTrack?: (trackIndex: number) => void;
    onRecordToggle?: () => void;
    countInEnabled?: boolean;
    onToggleCountIn?: () => void;
    bpm?: number;
    onBpmChange?: (bpm: number) => void;
}) {
    const {
        theme,
        session,
        status,
        recSeconds = 0,
        recStartSeconds = 0,
        isMidiRecording = false,
        liveMidiNotes = [],
        selectedClip,
        selectedClips = [],
        selectedClipNote,
        selectedNotes,
        cutCursor,
        cutToolActive,
        rangeToolActive,
        dragPreview,
        dragRef,
        onSessionPlayToggle,
        onRecordToggle,
        countInEnabled = false,
        onToggleCountIn,
        bpm = 120,
        onBpmChange,
        onAddTrack,
        onDeleteTrack,
        onOpenFxChain,
        onArmed,
        onSetTrackInputType,
        onMonitor,
        onMute,
        onSolo,
        onGain,
        onPan,
        onAppendClip,
        onDuplicateClip,
        onDuplicateNotes,
        onDeleteNotes,
        onDeleteClip,
        onDeleteClips,
        onSeek,
        onToggleCutTool,
        onToggleRangeTool,
        snapEnabled = true,
        onToggleSnap,
        followPlayhead = true,
        onToggleFollowPlayhead,
        zoomAnchorMode = 'mouse',
        onCutAtCursor,
        onCutDirect,
        onClipPointerDown,
        onClipPointerMove,
        onClipPointerUp,
        onTrimClip,
        onSelectClip,
        onSelectClips,
        onSelectClipNote,
        onMarqueeSelect,
        onSetCutCursor,
        onAssignClipToSynth,
        onPlayClipAsSequence,
        onPlayClipWithVoice,
        onConvertClipToVoice,
        onInsertVoiceClip,
        onDropVirtualAnalog,
        onDropVoiceChanger,
        onOpenPianoRoll,
        onOpenSynthEditorForClip,
        onOpenEqModalForClip,
        voices = [],
    } = props;

    const tracks = session?.tracks ?? [];
    const sessionDuration = Math.max(0.5, session?.duration ?? 0.5);

    // 🔍 プロ仕様対数ズーム（0% = 2.0px/秒（200小節一望）〜 50% = 50px/秒 〜 100% = 1500px/秒（ミリ秒単位））
    const [zoomPercent, setZoomPercent] = useState(50);
    const pxPerSec = Math.max(2.0, Math.min(1500.0, Math.round(50.0 * Math.pow(30.0, (zoomPercent - 50.0) / 50.0))));

    // 📏 トラックヘッダー可変幅（境界線ドラッグで 200px〜650px で自由伸縮）
    const [trackHeaderWidth, setTrackHeaderWidth] = useState<number>(360);
    const headerResizeDragRef = useRef<{ startX: number; startW: number } | null>(null);

    // 🛡️ トラック誤削除（ミスポチ）防止用 2段階確認ステート（3秒で自動解除）
    const [confirmDeleteTrack, setConfirmDeleteTrack] = useState<number | null>(null);
    const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 🎙️ クリップ歌声を名前付きでボイスライブラリへ保存するモーダル
    const [saveVoiceModal, setSaveVoiceModal] = useState<{ track: number; clip: number; defaultName: string } | null>(null);
    const [customVoiceName, setCustomVoiceName] = useState('');

    // 🎚️ クリップ角ドラッグによるフェードイン/フェードアウト調整
    const [fadeDrag, setFadeDrag] = useState<{
        track: number;
        clip: number;
        type: 'in' | 'out';
        startX: number;
        origFade: number;
        currentFade: number;
        maxSec: number;
    } | null>(null);
    const [trimDrag, setTrimDrag] = useState<{
        track: number; clip: number; edge: 'left' | 'right'; startX: number;
        start: number; sourceStart: number; duration: number; sourceDuration: number;
        currentStart: number; currentSourceStart: number; currentDuration: number;
    } | null>(null);

    const beginTrim = (e: ReactPointerEvent<HTMLDivElement>, track: number, clip: number,
        edge: 'left' | 'right', start: number, duration: number, sourceStart: number, sourceDuration: number) => {
        e.stopPropagation();
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { }
        setTrimDrag({
            track, clip, edge, startX: e.clientX, start, sourceStart, duration, sourceDuration,
            currentStart: start, currentSourceStart: sourceStart, currentDuration: duration
        });
    };
    const moveTrim = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!trimDrag) return;
        const delta = (e.clientX - trimDrag.startX) / pxPerSec;
        if (trimDrag.edge === 'left') {
            const maxLeft = trimDrag.start + trimDrag.duration - 0.02;
            const nextStart = Math.max(0, Math.min(maxLeft, trimDrag.start + delta));
            const nextSource = Math.max(0, trimDrag.sourceStart + (nextStart - trimDrag.start));
            setTrimDrag({
                ...trimDrag, currentStart: nextStart, currentSourceStart: nextSource,
                currentDuration: trimDrag.duration - (nextStart - trimDrag.start)
            });
        } else {
            const maxDuration = trimDrag.sourceDuration - trimDrag.sourceStart;
            const nextDuration = Math.max(0.02, Math.min(maxDuration, trimDrag.duration + delta));
            setTrimDrag({ ...trimDrag, currentDuration: nextDuration });
        }
    };
    const endTrim = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!trimDrag) return;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { }
        onTrimClip?.(trimDrag.track, trimDrag.clip, trimDrag.currentStart,
            trimDrag.currentSourceStart, trimDrag.currentDuration);
        setTrimDrag(null);
    };
    const [hoveredFadeClip, setHoveredFadeClip] = useState<{ track: number; clip: number } | null>(null);

    // 🔀 トラックドラッグ＆ドロップ並び替え（ポインターイベント方式）
    const [trackDrag, setTrackDrag] = useState<{
        fromIndex: number;
        startY: number;
        currentY: number;
        dropIndex: number;
        position: 'before' | 'after';
    } | null>(null);
    const trackRowsRef = useRef<HTMLDivElement>(null);

    // ✏️ トラック名インライン編集
    const [editingTrackNameIndex, setEditingTrackNameIndex] = useState<number | null>(null);
    const [editingTrackNameValue, setEditingTrackNameValue] = useState<string>('');

    // タイムライン横スクロールコンテナ & 自動追尾
    const timelineScrollRef = useRef<HTMLDivElement>(null);

    const currentHeadSec = status?.isRecording
        ? (recStartSeconds + recSeconds)
        : status?.isSessionPlaying
            ? (status?.sessionPosition ?? 0)
            : status?.isPlaying
                ? (status?.playbackPosition ?? 0)
                : (status?.sessionPosition ?? 0);

    // 🎯 ズーム更新時の即時同期アンカー Ref（描画ラグによる瞬間移動・チラつきを完全防止）
    const zoomPendingAnchorRef = useRef<{ anchorTimeSec: number; screenOffsetX: number } | null>(null);

    // ズーム変更時のアンカー追従（マウスカーソルの位置を厳密に画面上の同じ位置に固定してズーム）
    const changeZoomPercent = (newPercent: number, mouseClientX?: number) => {
        const clampedPercent = Math.max(0, Math.min(100, newPercent));
        const container = timelineScrollRef.current;
        if (!container) {
            setZoomPercent(clampedPercent);
            return;
        }

        const oldPx = pxPerSec;
        const rect = container.getBoundingClientRect();
        const scrollLeft = container.scrollLeft;

        let anchorTimeSec: number;
        let screenOffsetX: number;

        if (zoomAnchorMode === 'playhead') {
            // 🎯 再生バー（再生ヘッド）基準モード
            const headOffset = currentHeadSec * oldPx - scrollLeft;
            if (headOffset >= 0 && headOffset <= (container.clientWidth - trackHeaderWidth)) {
                anchorTimeSec = currentHeadSec;
                screenOffsetX = headOffset;
            } else {
                screenOffsetX = (container.clientWidth - trackHeaderWidth) / 2;
                anchorTimeSec = (scrollLeft + screenOffsetX) / oldPx;
            }
        } else if (mouseClientX !== undefined) {
            // 🎯 マウス位置基準モード（マウスカーソルのタイムライン内X座標を絶対アンカーにする）
            screenOffsetX = Math.max(0, mouseClientX - (rect.left + trackHeaderWidth));
            anchorTimeSec = (scrollLeft + screenOffsetX) / oldPx;
        } else {
            // 🎯 マウス指定がない場合（スライダー等）は画面中央をアンカーにする
            screenOffsetX = (container.clientWidth - trackHeaderWidth) / 2;
            anchorTimeSec = (scrollLeft + screenOffsetX) / oldPx;
        }

        // 即時同期用 Ref を記録
        zoomPendingAnchorRef.current = { anchorTimeSec, screenOffsetX };
        setZoomPercent(clampedPercent);
    };

    // 🚀 DOM 描画直前に同期的に scrollLeft を確定（1フレームのワープ・チラつきを 100% ゼロ化）
    useLayoutEffect(() => {
        const pending = zoomPendingAnchorRef.current;
        if (!pending || !timelineScrollRef.current) return;
        zoomPendingAnchorRef.current = null;
        const targetScrollLeft = pending.anchorTimeSec * pxPerSec - pending.screenOffsetX;
        timelineScrollRef.current.scrollLeft = Math.max(0, targetScrollLeft);
    }, [pxPerSec]);

    // ルーラー上でのホイール（コロコロ）ズーム: なめらかな微細ステップでズーム！
    const handleMainRulerWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // マウスホイールの微小な回転量（deltaY）に応じて滑らかにズーム
        const delta = -e.deltaY * 0.05;
        changeZoomPercent(zoomPercent + delta, e.clientX);
    };

    // Alt/Option または Ctrl + ホイールでマウス位置を中心に対話型ズーム
    useEffect(() => {
        const container = timelineScrollRef.current;
        if (!container) return;

        const onWheel = (e: WheelEvent) => {
            if (e.altKey || e.metaKey || e.ctrlKey) {
                e.preventDefault();
                const delta = -e.deltaY * 0.05;
                changeZoomPercent(zoomPercent + delta, e.clientX);
            }
        };

        container.addEventListener('wheel', onWheel, { passive: false });
        return () => container.removeEventListener('wheel', onWheel);
    }, [zoomPercent, pxPerSec, trackHeaderWidth]);

    // 🎚️ フェードイン・フェードアウトのドラッグリスナー
    useEffect(() => {
        if (!fadeDrag) return;

        const handlePointerMove = (e: PointerEvent) => {
            const deltaPx = e.clientX - fadeDrag.startX;
            const deltaSec = deltaPx / pxPerSec;
            let newFade = fadeDrag.origFade + (fadeDrag.type === 'in' ? deltaSec : -deltaSec);
            newFade = Math.max(0, Math.min(fadeDrag.maxSec, Math.round(newFade * 1000) / 1000));
            setFadeDrag((prev) => prev ? { ...prev, currentFade: newFade } : null);
        };

        const handlePointerUp = async () => {
            if (!fadeDrag) return;
            const track = session?.tracks[fadeDrag.track];
            const clip = track?.clips[fadeDrag.clip];
            if (track && clip) {
                const finalFadeIn = fadeDrag.type === 'in' ? fadeDrag.currentFade : (clip.fadeIn ?? 0);
                const finalFadeOut = fadeDrag.type === 'out' ? fadeDrag.currentFade : (clip.fadeOut ?? 0);
                await native.sessionSetClipFade(fadeDrag.track, fadeDrag.clip, finalFadeIn, finalFadeOut);
            }
            setFadeDrag(null);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [fadeDrag, pxPerSec, session]);

    // 🔀 トラックドラッグ並び替えのポインターリスナー
    useEffect(() => {
        if (!trackDrag) return;

        const handlePointerMove = (e: PointerEvent) => {
            const container = trackRowsRef.current;
            if (!container) return;
            const rowEls = container.querySelectorAll<HTMLDivElement>('[data-track-row]');
            let targetIdx = trackDrag.fromIndex;
            let pos: 'before' | 'after' = 'after';

            for (let i = 0; i < rowEls.length; ++i) {
                const rect = rowEls[i].getBoundingClientRect();
                if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    targetIdx = i;
                    pos = e.clientY < (rect.top + rect.height / 2) ? 'before' : 'after';
                    break;
                } else if (i === 0 && e.clientY < rect.top) {
                    targetIdx = 0;
                    pos = 'before';
                    break;
                } else if (i === rowEls.length - 1 && e.clientY > rect.bottom) {
                    targetIdx = i;
                    pos = 'after';
                    break;
                }
            }

            setTrackDrag((prev) => prev ? {
                ...prev,
                currentY: e.clientY,
                dropIndex: targetIdx,
                position: pos,
            } : null);
        };

        const handlePointerUp = async () => {
            if (!trackDrag) return;
            const fromIdx = trackDrag.fromIndex;
            const targetPos = trackDrag.position;
            let toIdx = targetPos === 'before' ? trackDrag.dropIndex : trackDrag.dropIndex + 1;
            if (fromIdx < toIdx) toIdx--;
            setTrackDrag(null);
            if (fromIdx !== toIdx && toIdx >= 0 && toIdx < (session?.tracks.length ?? 0)) {
                await native.sessionReorderTrack(fromIdx, toIdx);
            }
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [trackDrag, session]);

    // 自動追尾（オートスクロール）：再生ヘッドが画面外に出た時、または再生・録音進行時に自動スクロール
    const isPlayingOrRecording = !!status?.isRecording || !!status?.isSessionPlaying || !!status?.isPlaying;
    useEffect(() => {
        if (timelineScrollRef.current && followPlayhead) {
            const container = timelineScrollRef.current;
            const headX = currentHeadSec * pxPerSec;
            const scrollLeft = container.scrollLeft;
            const visibleWidth = container.clientWidth;

            if (isPlayingOrRecording) {
                if (headX > scrollLeft + visibleWidth * 0.75) {
                    container.scrollLeft = headX - visibleWidth * 0.3;
                } else if (headX < scrollLeft) {
                    container.scrollLeft = Math.max(0, headX - 50);
                }
            } else {
                // 停止中のシークで再生ヘッドが視野から完全に外れている場合は追従
                if (headX < scrollLeft || headX > scrollLeft + visibleWidth) {
                    container.scrollLeft = Math.max(0, headX - visibleWidth * 0.2);
                }
            }
        }
    }, [currentHeadSec, pxPerSec, isPlayingOrRecording, followPlayhead]);

    // 小節数計算（最低128小節、または再生ヘッド/セッション長に合わせて自動拡張）
    const totalTimelineSec = Math.max(256, sessionDuration + 20, currentHeadSec + 20);
    const barSec = (60 / Math.max(20, bpm)) * 4; // 4/4 拍子 動的BPM基準
    const totalBars = Math.ceil(totalTimelineSec / barSec);
    const timelineWidthPx = totalTimelineSec * pxPerSec;
    const singleBarPx = barSec * pxPerSec;
    const barStep = singleBarPx < 8 ? 16 : singleBarPx < 18 ? 8 : singleBarPx < 40 ? 4 : singleBarPx < 80 ? 2 : 1;

    const handleRulerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = Math.max(0, e.clientX - rect.left);
        const timeSec = localX / pxPerSec;
        // ルーラーをクリックしたら常に再生位置へシーク
        onSeek?.(timeSec);
    };

    const handleRulerDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (status?.isSessionPlaying) onSessionPlayToggle();
    };

    // ループハンドルのドラッグ開始
    const handleLoopHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>, mode: 'start' | 'end' | 'move') => {
        e.stopPropagation();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch (_) { }

        const localX = e.clientX;
        loopDragRef.current = {
            mode,
            startX: localX,
            origRange: { ...loopRange },
        };
    };

    const handleLoopHandlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!loopDragRef.current) return;
        const deltaSec = (e.clientX - loopDragRef.current.startX) / pxPerSec;
        const { start, end } = loopDragRef.current.origRange;

        if (loopDragRef.current.mode === 'start') {
            const newStart = Math.max(0, Math.min(end - 0.5, start + deltaSec));
            setLoopRange({ start: newStart, end });
        } else if (loopDragRef.current.mode === 'end') {
            const newEnd = Math.max(start + 0.5, end + deltaSec);
            setLoopRange({ start, end: newEnd });
        } else if (loopDragRef.current.mode === 'move') {
            const dur = end - start;
            const newStart = Math.max(0, start + deltaSec);
            setLoopRange({ start: newStart, end: newStart + dur });
        }
    };

    const handleLoopHandlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (loopDragRef.current) {
            try {
                e.currentTarget.releasePointerCapture(e.pointerId);
            } catch (_) { }
            loopDragRef.current = null;
        }
    };

    // 右クリック・コンテキストメニュー状態
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        track: number;
        clip: number;
    } | null>(null);
    const contextMenuDragRef = useRef<{ isDragging: boolean; startX: number; startY: number; origMenuX: number; origMenuY: number } | null>(null);

    // トラックヘッダーの右クリックメニュー状態
    const [trackContextMenu, setTrackContextMenu] = useState<{
        x: number;
        y: number;
        track: number;
    } | null>(null);

    // 🎯 選択中トラックインデックス（アクティブトラックハイライト）
    const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);

    // 🎹 トラック毎インストゥルメント種別 ＆ プリセットインデックス（声 / VA）
    const [instrumentKinds, setInstrumentKinds] = useState<Record<number, TrackInstrumentKind>>({});
    const [voicePresetIndices, setVoicePresetIndices] = useState<Record<number, number>>({});
    const [vaPresetIndices, setVaPresetIndices] = useState<Record<number, number>>({});
    const [instrumentTick, setInstrumentTick] = useState(0);
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const nextKinds: Record<number, TrackInstrumentKind> = {};
            const nextVoicePresets: Record<number, number> = {};
            const nextVaPresets: Record<number, number> = {};
            for (let i = 0; i < tracks.length; ++i) {
                try {
                    nextKinds[i] = await native.sessionGetTrackInstrument(i);
                    nextVoicePresets[i] = await native.sessionGetTrackVoicePreset(i);
                    nextVaPresets[i] = await native.sessionGetTrackVaPreset(i);
                } catch (_) {
                    nextKinds[i] = 'none';
                    nextVoicePresets[i] = -1;
                    nextVaPresets[i] = -1;
                }
            }
            if (!cancelled) {
                setInstrumentKinds(nextKinds);
                setVoicePresetIndices(nextVoicePresets);
                setVaPresetIndices(nextVaPresets);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [tracks.length, instrumentTick]);
    const instrumentKindOf = (trackIdx: number): TrackInstrumentKind =>
        instrumentKinds[trackIdx] ?? 'none';

    // 📏 トラックヘッダー幅のリサイズ操作
    const handleHeaderResizePointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch (_) { }
        headerResizeDragRef.current = { startX: e.clientX, startW: trackHeaderWidth };
    };

    const handleHeaderResizePointerMove = (e: React.PointerEvent) => {
        if (!headerResizeDragRef.current) return;
        const dx = e.clientX - headerResizeDragRef.current.startX;
        const newW = Math.max(220, Math.min(650, headerResizeDragRef.current.startW + dx));
        setTrackHeaderWidth(newW);
    };

    const handleHeaderResizePointerUp = (e: React.PointerEvent) => {
        if (headerResizeDragRef.current) {
            try {
                e.currentTarget.releasePointerCapture(e.pointerId);
            } catch (_) { }
            headerResizeDragRef.current = null;
        }
    };

    // 範囲選択（マーキー）はコンポーネント内で管理する。
    const [marquee, setMarquee] = useState<MarqueeRect>(null);
    const marqueeRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

    const startMarquee = (e: ReactPointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        marqueeRef.current = { x1: startX, y1: startY, x2: startX, y2: startY };
        setMarquee({ x1: startX, y1: startY, x2: startX, y2: startY });

        const handlePointerMove = (moveEvt: PointerEvent) => {
            const cur = marqueeRef.current;
            if (!cur) return;
            const x = moveEvt.clientX;
            const y = moveEvt.clientY;
            const next = { x1: cur.x1, y1: cur.y1, x2: x, y2: y };
            marqueeRef.current = next;
            setMarquee(next);

            if (timelineScrollRef.current) {
                const container = timelineScrollRef.current;
                const scrollRect = container.getBoundingClientRect();
                const edgeMargin = 50;
                const scrollSpeed = 16;
                if (moveEvt.clientX > scrollRect.right - edgeMargin) {
                    container.scrollLeft += scrollSpeed;
                } else if (moveEvt.clientX < scrollRect.left + trackHeaderWidth + edgeMargin) {
                    container.scrollLeft = Math.max(0, container.scrollLeft - scrollSpeed);
                }
            }
        };

        const handlePointerUp = (upEvt: PointerEvent) => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);

            const rect = marqueeRef.current;
            marqueeRef.current = null;
            setMarquee(null);

            const x1 = rect ? Math.min(rect.x1, rect.x2) : startX;
            const x2 = rect ? Math.max(rect.x1, rect.x2) : startX;
            const y1 = rect ? Math.min(rect.y1, rect.y2) : startY;
            const y2 = rect ? Math.max(rect.y1, rect.y2) : startY;
            const isClick = (x2 - x1 < 5 && y2 - y1 < 5);

            const matchedClips: Array<{ track: number; clip: number }> = [];
            const clipEls = trackRowsRef.current?.querySelectorAll<HTMLDivElement>('[data-clip-item="true"]') ?? [];

            clipEls.forEach((clipEl) => {
                const cRect = clipEl.getBoundingClientRect();
                const tIdx = Number(clipEl.getAttribute('data-track-index'));
                const cIdx = Number(clipEl.getAttribute('data-clip-index'));
                if (isNaN(tIdx) || isNaN(cIdx)) return;

                // 🎯 マーキー枠 (x1, y1) ~ (x2, y2) と clipRect の完全ピクセル交差判定
                const intersects = isClick
                    ? (upEvt.clientX >= cRect.left && upEvt.clientX <= cRect.right && upEvt.clientY >= cRect.top && upEvt.clientY <= cRect.bottom)
                    : (x1 <= cRect.right && x2 >= cRect.left && y1 <= cRect.bottom && y2 >= cRect.top);

                if (intersects) {
                    matchedClips.push({ track: tIdx, clip: cIdx });

                    const trackData = tracks[tIdx];
                    const clip = trackData?.clips[cIdx];
                    if (!isClick && clip?.notes && clip.notes.length > 0) {
                        const selected: number[] = [];
                        const w = cRect.width;
                        clip.notes.forEach((n, ni) => {
                            const nl = cRect.left + (n.start / clip.duration) * w;
                            const nr = cRect.left + (n.end / clip.duration) * w;
                            if (nr >= x1 && nl <= x2) selected.push(ni);
                        });
                        if (selected.length > 0) onMarqueeSelect(tIdx, cIdx, selected);
                    }
                }
            });

            if (matchedClips.length > 0) {
                onSelectClips?.(matchedClips);
            } else {
                // 🎯 空白タップ／何もない場所の囲み時は確実に選択解除！
                onSelectClips?.([]);
            }
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
    };

    const placeCutCursor = (
        e: ReactPointerEvent<HTMLDivElement>,
        track: number,
        specificClipIdx?: number
    ) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const trackData = tracks[track];
        if (!trackData) return;

        if (specificClipIdx !== undefined && trackData.clips[specificClipIdx]) {
            // ✂️ クリップ要素そのものを直接クリックした場合（ピクセル精度で瞬時分割）
            const clip = trackData.clips[specificClipIdx];
            const localX = Math.max(0, e.clientX - rect.left);
            const splitSec = Math.max(0.02, Math.min(clip.duration - 0.02, localX / pxPerSec));
            onSetCutCursor(track, specificClipIdx, splitSec);
            if (cutToolActive) {
                props.onCutDirect?.(track, specificClipIdx, splitSec);
            }
            return;
        }

        // トラックレーン全体をクリックした場合
        const x = e.clientX - rect.left;
        const time = x / pxPerSec;
        for (let ci = 0; ci < trackData.clips.length; ci++) {
            const clip = trackData.clips[ci];
            if (time >= clip.start && time <= clip.start + clip.duration) {
                const splitSec = Math.max(0.02, Math.min(clip.duration - 0.02, time - clip.start));
                onSetCutCursor(track, ci, splitSec);
                if (cutToolActive) {
                    props.onCutDirect?.(track, ci, splitSec);
                }
                return;
            }
        }
    };

    // 🎯 音源のドラッグ＆ドロップ配置ステート
    const [dragOverTrack, setDragOverTrack] = useState<{ track: number; time: number } | null>(null);
    const [previewAudition, setPreviewAudition] = useState<{ vIdx: number; mode: number } | null>(null);

    // 🔁 ループ範囲（初期値：0.0秒〜8.0秒 = 1小節〜5小節）
    const [loopActive, setLoopActive] = useState(false);
    const [loopRange, setLoopRange] = useState<{ start: number; end: number }>({ start: 0, end: 8.0 });
    const loopDragRef = useRef<{ mode: 'start' | 'end' | 'move' | 'create'; startX: number; origRange: { start: number; end: number } } | null>(null);

    // ループ区間・有効状態をネイティブ側へ同期（オーディオスレッドで
    // サンプル精度に折り返す。UI 側ポーリング巻き戻しでは継ぎ目に
    // ジッターとノート強制切断が発生するため廃止した）。
    useEffect(() => {
        void native.setSessionLoop(loopActive, loopRange.start, loopRange.end);
    }, [loopActive, loopRange]);

    return (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', margin: '4px 6px 0 12px', border: `1px solid ${theme?.border || '#283344'}`, borderRadius: 10, overflow: 'hidden', background: theme?.bgTimeline || '#0e1117', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)', transition: 'background-color 0.2s ease, border-color 0.2s ease' }}>
            <TransportBar
                theme={theme}
                status={status}
                countInEnabled={countInEnabled}
                loopActive={loopActive}
                bpm={bpm}
                onSeek={onSeek}
                onSessionPlayToggle={onSessionPlayToggle}
                onRecordToggle={onRecordToggle}
                onToggleCountIn={onToggleCountIn}
                onToggleLoop={() => setLoopActive((l) => !l)}
                onBpmChange={onBpmChange}
                onAddTrack={onAddTrack}
                scrollContainerRef={timelineScrollRef}
            >
                <TimelineToolbar
                    theme={theme}
                    sessionDuration={sessionDuration}
                    sessionPosition={status?.sessionPosition ?? 0}
                    snapEnabled={snapEnabled}
                    followPlayhead={followPlayhead}
                    rangeToolActive={rangeToolActive}
                    cutToolActive={cutToolActive}
                    zoomPercent={zoomPercent}
                    selectedNotes={selectedNotes}
                    selectedClips={selectedClips}
                    selectedClip={selectedClip}
                    onToggleSnap={onToggleSnap}
                    onToggleFollowPlayhead={onToggleFollowPlayhead}
                    onToggleRangeTool={onToggleRangeTool}
                    onToggleCutTool={onToggleCutTool}
                    onChangeZoom={(newPercent) => setZoomPercent(Math.max(0, Math.min(100, newPercent)))}
                    onDeleteNotes={onDeleteNotes}
                    onDeleteClip={onDeleteClip}
                    onDeleteClips={onDeleteClips}
                />
            </TransportBar>

            {/* トラック / タイムライン（横スクロール可能） */}
            <div
                ref={timelineScrollRef}
                style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'auto', display: 'flex', flexDirection: 'column', position: 'relative' }}
                onPointerMove={props.onClipPointerMove}
                onPointerUp={props.onClipPointerUp}
            >
                {/* タイムライン全体のコンテナ（固定トラックヘッダー + スクロールする小節ルーラー・トラック行） */}
                <div style={{ display: 'flex', flexDirection: 'column', width: trackHeaderWidth + Math.max(600, timelineWidthPx), minWidth: '100%', minHeight: '100%', position: 'relative' }}>
                    <TimelineRuler
                        theme={theme}
                        status={status}
                        trackHeaderWidth={trackHeaderWidth}
                        timelineWidthPx={timelineWidthPx}
                        totalBars={totalBars}
                        barSec={(60 / Math.max(20, bpm)) * 4}
                        pxPerSec={pxPerSec}
                        currentHeadSec={currentHeadSec}
                        loopActive={loopActive}
                        loopRange={loopRange}
                        onRulerPointerDown={handleRulerPointerDown}
                        onRulerDoubleClick={handleRulerDoubleClick}
                        onRulerWheel={handleMainRulerWheel}
                        onLoopHandlePointerDown={handleLoopHandlePointerDown}
                        onLoopHandlePointerMove={handleLoopHandlePointerMove}
                        onLoopHandlePointerUp={handleLoopHandlePointerUp}
                        onHeaderResizePointerDown={handleHeaderResizePointerDown}
                        onHeaderResizePointerMove={handleHeaderResizePointerMove}
                        onHeaderResizePointerUp={handleHeaderResizePointerUp}
                    />

                    {/* トラックリスト（ルーラーとピクセル完全一致 / どこにドロップしても確実に受け取る） */}
                    <div
                        ref={trackRowsRef}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            try {
                                const dataStr = e.dataTransfer.getData('text/plain');
                                if (dataStr) {
                                    const data = JSON.parse(dataStr);
                                    if (data.type === 'virtual-analog') {
                                        onDropVirtualAnalog?.(-1);
                                        return;
                                    }
                                    if (data.type === 'voice-changer') {
                                        onDropVoiceChanger?.(-1);
                                        return;
                                    }
                                }
                            } catch (err) { }
                        }}
                        style={{ display: 'flex', flexDirection: 'column', position: 'relative', minHeight: '100%', flex: 1 }}
                    >
                        {tracks.map((track, ti) => {
                            const isArmed = track.armed;
                            const isSelectedTrack = selectedTrackIndex === ti;
                            const isRecordingOnThisTrack = Boolean(status?.isRecording || isMidiRecording) && (isArmed || (ti === 0 && !tracks.some(t => t.armed)));
                            const isTrackDragging = trackDrag?.fromIndex === ti;
                            const isDropBefore = trackDrag !== null && trackDrag.dropIndex === ti && trackDrag.position === 'before' && trackDrag.fromIndex !== ti;
                            const isDropAfter = trackDrag !== null && trackDrag.dropIndex === ti && trackDrag.position === 'after' && trackDrag.fromIndex !== ti;

                            return (
                                <div
                                    key={ti}
                                    data-track-row={ti}
                                    onClick={() => setSelectedTrackIndex(ti)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'stretch',
                                        background: isArmed
                                            ? '#201518'
                                            : isSelectedTrack
                                                ? (theme?.id === 'slate' ? '#353b47' : theme?.id === 'charcoal' ? '#24272c' : '#161c29')
                                                : (theme?.id === 'slate' ? '#282c34' : theme?.id === 'charcoal' ? '#1c1e22' : '#13161c'),
                                        borderBottom: isSelectedTrack ? `1px solid ${theme?.accentSecondary || '#4d7cff'}` : `1px solid ${theme?.border || '#242b38'}`,
                                        borderTop: isSelectedTrack ? `1px solid ${theme?.accentSecondary || '#4d7cff'}` : '1px solid transparent',
                                        boxShadow: isSelectedTrack ? 'inset 0 0 20px rgba(77, 124, 255, 0.08)' : 'none',
                                        minHeight: 68,
                                        position: 'relative',
                                        opacity: isTrackDragging ? 0.35 : 1,
                                        transition: 'background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease',
                                    }}
                                >
                                    {/* 🔵 トラック挿入ガイドライン（ドロップ位置インジケーター） */}
                                    {isDropBefore && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                top: -2,
                                                left: 0,
                                                right: 0,
                                                height: 4,
                                                background: '#528bff',
                                                boxShadow: '0 0 12px #528bff, 0 0 4px #ffffff',
                                                zIndex: 50,
                                                pointerEvents: 'none',
                                                borderRadius: 2,
                                            }}
                                        />
                                    )}
                                    {isDropAfter && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                bottom: -2,
                                                left: 0,
                                                right: 0,
                                                height: 4,
                                                background: '#528bff',
                                                boxShadow: '0 0 12px #528bff, 0 0 4px #ffffff',
                                                zIndex: 50,
                                                pointerEvents: 'none',
                                                borderRadius: 2,
                                            }}
                                        />
                                    )}

                                    {/* トラックヘッダ（左端に固定：可変幅 trackHeaderWidth / ヘッダー全体を掴んでドラッグ並び替え可能） */}
                                    <div
                                        onPointerDown={(e) => {
                                            const target = e.target as HTMLElement;
                                            if (target.closest('button') || target.closest('input') || target.closest('[data-no-drag]')) return;
                                            if (e.button !== 0) return; // 左クリックのみ
                                            e.preventDefault();
                                            setSelectedTrackIndex(ti);
                                            setTrackDrag({
                                                fromIndex: ti,
                                                startY: e.clientY,
                                                currentY: e.clientY,
                                                dropIndex: ti,
                                                position: 'after',
                                            });
                                        }}
                                        onClick={() => {
                                            setSelectedTrackIndex(ti);
                                            props.onSelectTrack?.(ti);
                                        }}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setSelectedTrackIndex(ti);
                                            props.onSelectTrack?.(ti);
                                            void Promise.all([
                                                native.sessionGetTrackInstrument(ti),
                                                native.sessionGetTrackVoicePreset(ti),
                                                native.sessionGetTrackVaPreset(ti),
                                            ]).then(([k, vIdx, vaIdx]) => {
                                                setInstrumentKinds((prev) => ({ ...prev, [ti]: k as TrackInstrumentKind }));
                                                setVoicePresetIndices((prev) => ({ ...prev, [ti]: vIdx }));
                                                setVaPresetIndices((prev) => ({ ...prev, [ti]: vaIdx }));
                                            });
                                            setTrackContextMenu({
                                                x: e.clientX,
                                                y: e.clientY,
                                                track: ti,
                                            });
                                        }}
                                        style={{
                                            width: trackHeaderWidth,
                                            padding: '8px 10px',
                                            borderRight: isSelectedTrack ? `2px solid ${theme?.accentSecondary || '#4d7cff'}` : `1px solid ${theme?.border || '#2a2d34'}`,
                                            background: isArmed
                                                ? '#201518'
                                                : isSelectedTrack
                                                    ? (theme?.id === 'slate' ? '#3a414e' : theme?.id === 'charcoal' ? '#282b31' : '#1a2233')
                                                    : (theme?.id === 'slate' ? '#303540' : theme?.id === 'charcoal' ? '#202226' : '#13161c'),
                                            flexShrink: 0,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'center',
                                            position: 'sticky',
                                            left: 0,
                                            zIndex: 10,
                                            cursor: trackDrag?.fromIndex === ti ? 'grabbing' : 'grab',
                                            userSelect: 'none',
                                            transition: 'background 0.15s ease',
                                        }}
                                        title="ドラッグしてトラックの順番を上下に入れ替え"
                                    >
                                        {/* 📏 境界線リサイズスプリッター（右端） */}
                                        <div
                                            data-no-drag="true"
                                            onPointerDown={handleHeaderResizePointerDown}
                                            onPointerMove={handleHeaderResizePointerMove}
                                            onPointerUp={handleHeaderResizePointerUp}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                bottom: 0,
                                                right: -4,
                                                width: 8,
                                                cursor: 'col-resize',
                                                zIndex: 15,
                                            }}
                                            title="ドラッグしてトラック幅を調整"
                                        />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            {/* ⠿ ドラッグ並び替えグリップ＆トラックカラー */}
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 3,
                                                    padding: '2px 4px 2px 0',
                                                    borderRadius: 3,
                                                    pointerEvents: 'none',
                                                }}
                                            >
                                                {/* 6点グリップドット */}
                                                <span style={{ fontSize: 10, color: isSelectedTrack ? '#70a1ff' : '#636e72', lineHeight: 1, userSelect: 'none' }}>⋮⋮</span>
                                                <span
                                                    style={{
                                                        width: 4,
                                                        height: 22,
                                                        background: isArmed ? '#e5484d' : (track.color || (isSelectedTrack ? '#70a1ff' : '#3d4a5d')),
                                                        borderRadius: 2,
                                                        boxShadow: isArmed
                                                            ? '0 0 10px rgba(229, 72, 77, 0.9)'
                                                            : isSelectedTrack
                                                                ? `0 0 10px ${track.color || '#70a1ff'}`
                                                                : 'none',
                                                        transition: 'all 0.15s ease',
                                                    }}
                                                />
                                            </div>
                                            <span style={{ fontSize: 11, fontWeight: 900, color: isSelectedTrack ? (track.color || '#70a1ff') : '#747d8c', width: 14 }}>{ti + 1}</span>
                                            {/* 🎚️ ステレオ / モノラルスマートバッジ */}
                                            <span
                                                style={{
                                                    fontSize: 8,
                                                    fontWeight: 900,
                                                    padding: '1px 3px',
                                                    borderRadius: 2,
                                                    background: 'rgba(0,0,0,0.4)',
                                                    color: track.isStereo === false ? '#ffa502' : '#70a1ff',
                                                    border: `1px solid ${track.isStereo === false ? 'rgba(255, 165, 2, 0.4)' : 'rgba(112, 161, 255, 0.4)'}`,
                                                }}
                                                title={track.isStereo === false ? 'モノラルトラック (Mono)' : 'ステレオトラック (Stereo)'}
                                            >
                                                {track.isStereo === false ? 'MONO' : 'ST'}
                                            </span>
                                            <button
                                                onClick={() => onArmed(ti, !track.armed)}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    const nextType = track.inputType === 'midi' ? 'audio' : 'midi';
                                                    onSetTrackInputType?.(ti, nextType);
                                                }}
                                                style={{
                                                    background: track.armed ? '#c23616' : '#2a2d34',
                                                    color: '#eee',
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    width: 24,
                                                    height: 24,
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    flexShrink: 0,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    boxShadow: track.armed ? '0 0 8px rgba(194, 54, 22, 0.5)' : 'none',
                                                }}
                                                title={track.armed ? `録音アーム中 (${track.inputType === 'midi' ? '🎹 シンセMIDI' : '🎙️ マイク音声'} / 右クリックで切替)` : `録音アーム (現在: ${track.inputType === 'midi' ? '🎹 シンセMIDI' : '🎙️ マイク音声'} / 右クリックで切替)`}
                                            >
                                                {track.inputType === 'midi' ? (
                                                    <IconPiano size={12} color={track.armed ? '#ffffff' : '#a4b0be'} />
                                                ) : (
                                                    <IconMic size={12} color={track.armed ? '#ffffff' : '#a4b0be'} />
                                                )}
                                            </button>
                                            <button
                                                onClick={() => onMonitor(ti, !track.monitor)}
                                                style={{
                                                    background: track.monitor ? '#10ac84' : '#2a2d34',
                                                    color: '#eee',
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    width: 24,
                                                    height: 24,
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    flexShrink: 0,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    boxShadow: track.monitor ? '0 0 6px rgba(16, 172, 132, 0.5)' : 'none',
                                                }}
                                                title="入力モニター（このトラックへ出力）"
                                            >
                                                <IconSpeaker size={12} color={track.monitor ? '#ffffff' : '#a4b0be'} />
                                            </button>
                                            <button
                                                onClick={() => onMute(ti, !track.mute)}
                                                style={{
                                                    background: track.mute ? '#e5484d' : '#2a2d34',
                                                    color: '#eee',
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    width: 24,
                                                    height: 24,
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    flexShrink: 0,
                                                }}
                                                title="ミュート"
                                            >
                                                M
                                            </button>
                                            <button
                                                onClick={() => onSolo(ti, !track.solo)}
                                                style={{
                                                    background: track.solo ? '#ffc857' : '#2a2d34',
                                                    color: track.solo ? '#111' : '#eee',
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    width: 24,
                                                    height: 24,
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    flexShrink: 0,
                                                }}
                                                title="ソロ"
                                            >
                                                S
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onOpenFxChain?.(ti);
                                                }}
                                                style={{
                                                    background: 'linear-gradient(135deg, rgba(92,124,250,0.25), rgba(61,90,241,0.35))',
                                                    color: '#a5b4fc',
                                                    border: '1px solid rgba(92,124,250,0.4)',
                                                    borderRadius: 4,
                                                    padding: '0 6px',
                                                    height: 24,
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    cursor: 'pointer',
                                                    flexShrink: 0,
                                                    letterSpacing: '0.04em',
                                                    transition: 'all 0.15s ease',
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background = 'linear-gradient(135deg, #5c7cfa, #3d5af1)';
                                                    e.currentTarget.style.color = '#ffffff';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(92,124,250,0.25), rgba(61,90,241,0.35))';
                                                    e.currentTarget.style.color = '#a5b4fc';
                                                }}
                                                title="インサート FX（VST3 プラグインチェーン）を開く"
                                            >
                                                FX
                                            </button>
                                            {editingTrackNameIndex === ti ? (
                                                <input
                                                    autoFocus
                                                    value={editingTrackNameValue}
                                                    onChange={(e) => setEditingTrackNameValue(e.target.value)}
                                                    onBlur={() => {
                                                        if (editingTrackNameValue.trim() && editingTrackNameValue.trim() !== track.name) {
                                                            void native.sessionSetTrackName(ti, editingTrackNameValue.trim());
                                                        }
                                                        setEditingTrackNameIndex(null);
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            if (editingTrackNameValue.trim() && editingTrackNameValue.trim() !== track.name) {
                                                                void native.sessionSetTrackName(ti, editingTrackNameValue.trim());
                                                            }
                                                            setEditingTrackNameIndex(null);
                                                        } else if (e.key === 'Escape') {
                                                            setEditingTrackNameIndex(null);
                                                        }
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{
                                                        fontSize: 11,
                                                        fontWeight: 800,
                                                        color: '#ffffff',
                                                        background: '#090b10',
                                                        border: '1px solid #3b82f6',
                                                        borderRadius: 3,
                                                        padding: '1px 4px',
                                                        flex: 1,
                                                        minWidth: 0,
                                                        outline: 'none',
                                                    }}
                                                />
                                            ) : (
                                                <span
                                                    onDoubleClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingTrackNameIndex(ti);
                                                        setEditingTrackNameValue(track.name || `Track ${ti + 1}`);
                                                    }}
                                                    title="ダブルクリックでトラック名を変更"
                                                    style={{
                                                        fontWeight: isSelectedTrack ? 800 : 700,
                                                        fontSize: 12,
                                                        flex: 1,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        color: isSelectedTrack ? '#ffffff' : '#c8d6e5',
                                                        cursor: 'text',
                                                    }}
                                                >
                                                    {track.name}
                                                </span>
                                            )}
                                            {/* 🛡️ トラック削除ボタン（ミスポチ防止 2段階セーフティクリック） */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirmDeleteTrack === ti) {
                                                        // 2回目のクリックで安全に削除実行
                                                        if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
                                                        setConfirmDeleteTrack(null);
                                                        onDeleteTrack?.(ti);
                                                    } else {
                                                        // 1回目のクリックで確認状態（3秒で自動リセット）
                                                        setConfirmDeleteTrack(ti);
                                                        if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
                                                        deleteTimerRef.current = setTimeout(() => {
                                                            setConfirmDeleteTrack(null);
                                                        }, 3000);
                                                    }
                                                }}
                                                style={{
                                                    background: confirmDeleteTrack === ti ? '#ff4757' : 'transparent',
                                                    color: confirmDeleteTrack === ti ? '#ffffff' : '#747d8c',
                                                    border: confirmDeleteTrack === ti ? '1px solid #ff4757' : '1px solid #2f3542',
                                                    borderRadius: 4,
                                                    padding: confirmDeleteTrack === ti ? '0 6px' : '0',
                                                    height: 22,
                                                    minWidth: 22,
                                                    fontSize: 10.5,
                                                    fontWeight: 800,
                                                    cursor: 'pointer',
                                                    flexShrink: 0,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 3,
                                                    boxShadow: confirmDeleteTrack === ti ? '0 0 10px rgba(255, 71, 87, 0.8)' : 'none',
                                                    transition: 'all 0.15s ease',
                                                }}
                                                title={confirmDeleteTrack === ti ? 'もう一度クリックするとトラックが削除されます' : 'トラックを削除（クリックで確認）'}
                                            >
                                                {confirmDeleteTrack === ti ? (
                                                    <span>削除?</span>
                                                ) : (
                                                    <IconTrash size={12} color="currentColor" />
                                                )}
                                            </button>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                                            <span style={{ fontSize: 10, color: '#888', flexShrink: 0 }}>VOL</span>
                                            <input
                                                type="range"
                                                min={0}
                                                max={1.5}
                                                step={0.01}
                                                value={track.gain}
                                                onChange={(e) => onGain(ti, Number(e.target.value))}
                                                style={{ flex: 1, minWidth: 40, accentColor: theme?.accentSecondary || '#3d7eff', cursor: 'pointer' }}
                                            />
                                            <span style={{ fontSize: 10, color: '#888', flexShrink: 0 }}>PAN</span>
                                            <input
                                                type="range"
                                                min={-1}
                                                max={1}
                                                step={0.01}
                                                value={track.pan}
                                                onChange={(e) => onPan(ti, Number(e.target.value))}
                                                style={{ width: 60, flexShrink: 0, accentColor: theme?.accentSecondary || '#3d7eff', cursor: 'pointer' }}
                                            />
                                        </div>
                                    </div>

                                    {/* クリップ表示レーン */}
                                    <div
                                        onClick={() => setSelectedTrackIndex(ti)}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'copy';
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = e.clientX - rect.left;
                                            const time = Math.max(0, x / pxPerSec);
                                            setDragOverTrack({ track: ti, time });
                                        }}
                                        onDragLeave={(e) => {
                                            // 子要素への移動でない場合のみクリア
                                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                                setDragOverTrack(null);
                                            }
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = e.clientX - rect.left;
                                            const dropTime = Math.max(0, x / pxPerSec);
                                            setDragOverTrack(null);
                                            try {
                                                const dataStr = e.dataTransfer.getData('text/plain');
                                                if (dataStr) {
                                                    const data = JSON.parse(dataStr);
                                                    if (data.type === 'virtual-analog') {
                                                        onDropVirtualAnalog?.(ti, dropTime);
                                                        return;
                                                    }
                                                    if (data.type === 'voice-changer') {
                                                        onDropVoiceChanger?.(ti);
                                                        return;
                                                    }
                                                    if (data.type === 'voice') {
                                                        onInsertVoiceClip?.(ti, data.voiceIndex, dropTime);
                                                        return;
                                                    }
                                                }
                                            } catch (err) { }
                                            onInsertVoiceClip?.(ti, undefined, dropTime);
                                        }}
                                        style={{
                                            position: 'relative',
                                            flex: 1,
                                            overflowX: 'hidden',
                                            background: dragOverTrack?.track === ti
                                                ? 'rgba(46, 213, 115, 0.12)'
                                                : dragPreview?.targetTrack === ti
                                                    ? 'rgba(112, 161, 255, 0.09)'
                                                    : isArmed
                                                        ? '#1a1418'
                                                        : isSelectedTrack
                                                            ? (theme?.id === 'slate' ? '#262a33' : theme?.id === 'charcoal' ? '#191b1f' : '#131822')
                                                            : (theme?.id === 'slate' ? '#21252b' : theme?.id === 'charcoal' ? '#151618' : '#111318'),
                                            outline: dragOverTrack?.track === ti
                                                ? '1px dashed #2ed573'
                                                : dragPreview?.targetTrack === ti
                                                    ? '1.5px solid #70a1ff'
                                                    : 'none',
                                            boxShadow: dragPreview?.targetTrack === ti ? 'inset 0 0 16px rgba(112, 161, 255, 0.15)' : 'none',
                                            cursor: rangeToolActive ? 'crosshair' : cutToolActive ? 'copy' : 'default',
                                            transition: 'background 0.12s ease, outline 0.12s ease',
                                        }}
                                    >
                                        <div
                                            data-timeline-lane="true"
                                            style={{
                                                position: 'relative',
                                                width: Math.max(600, timelineWidthPx),
                                                height: '100%',
                                                flexShrink: 0,
                                            }}
                                            onPointerDown={(e) => {
                                                if (cutToolActive) placeCutCursor(e, ti);
                                                else if (rangeToolActive) startMarquee(e);
                                                else {
                                                    // 🎯 空白部分をクリックした時は選択解除
                                                    onSelectClips?.([]);
                                                    onSelectClip(-1, -1);
                                                }
                                            }}
                                        >
                                            {/* 🎯 音源ドロップ時の半透明プレビューゴースト */}
                                            {dragOverTrack?.track === ti && (
                                                <div
                                                    style={{
                                                        position: 'absolute',
                                                        left: dragOverTrack.time * pxPerSec,
                                                        top: 8,
                                                        width: 90,
                                                        height: 48,
                                                        background: 'rgba(46, 213, 115, 0.3)',
                                                        border: '2px dashed #2ed573',
                                                        borderRadius: 4,
                                                        pointerEvents: 'none',
                                                        zIndex: 20,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: 4,
                                                        color: '#2ed573',
                                                        fontSize: 10,
                                                        fontWeight: 900,
                                                        boxShadow: '0 0 12px rgba(46, 213, 115, 0.5)',
                                                    }}
                                                >
                                                    <IconPlus size={11} color="#2ed573" />
                                                    <span>ここに配置</span>
                                                </div>
                                            )}

                                            {/* 背景の小節グリッド線（ルーラーと完全同期） */}
                                            {Array.from({ length: Math.ceil(totalBars / barStep) + 2 }).map((_, stepIdx) => {
                                                const left = stepIdx * barStep * barSec * pxPerSec;
                                                const isMajor = (stepIdx * barStep) % 4 === 0;
                                                return (
                                                    <div
                                                        key={stepIdx}
                                                        style={{
                                                            position: 'absolute',
                                                            top: 0,
                                                            bottom: 0,
                                                            left,
                                                            width: 1,
                                                            background: isMajor ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                                                            pointerEvents: 'none',
                                                        }}
                                                    />
                                                );
                                            })}

                                            {track.clips.map((clip, ci) => {
                                                const isTrimDragging = trimDrag?.track === ti && trimDrag?.clip === ci;
                                                const displayStart = isTrimDragging ? trimDrag.currentStart : clip.start;
                                                const displayDuration = isTrimDragging ? trimDrag.currentDuration : clip.duration;
                                                const left = displayStart * pxPerSec;
                                                const w = Math.max(6, displayDuration * pxPerSec);
                                                const isSel = (selectedClip?.track === ti && selectedClip?.clip === ci) ||
                                                    selectedClips.some(c => c.track === ti && c.clip === ci);
                                                const dragActive = dragPreview?.clips.some(c => c.track === ti && c.clip === ci) ?? false;
                                                const drag = dragActive ? dragPreview : null;
                                                const isNoteSel = (ni: number) =>
                                                    selectedNotes?.track === ti &&
                                                    selectedNotes?.clip === ci &&
                                                    selectedNotes.notes.indexOf(ni) !== -1;
                                                const isFadeDraggingIn = fadeDrag?.track === ti && fadeDrag?.clip === ci && fadeDrag.type === 'in';
                                                const isFadeDraggingOut = fadeDrag?.track === ti && fadeDrag?.clip === ci && fadeDrag.type === 'out';
                                                const activeFadeIn = isFadeDraggingIn ? fadeDrag.currentFade : (clip.fadeIn ?? 0);
                                                const activeFadeOut = isFadeDraggingOut ? fadeDrag.currentFade : (clip.fadeOut ?? 0);
                                                const fadeInPx = Math.min(w, activeFadeIn * pxPerSec);
                                                const fadeOutPx = Math.min(w, activeFadeOut * pxPerSec);
                                                const isClipHovered = hoveredFadeClip?.track === ti && hoveredFadeClip?.clip === ci;
                                                const trimStartSec = isTrimDragging ? trimDrag.currentSourceStart : (clip.trimStart ?? 0);
                                                const sourceDurationSec = Math.max(trimStartSec + displayDuration, clip.sourceDuration ?? clip.duration);
                                                const trimEndSec = Math.min(sourceDurationSec, trimStartSec + displayDuration);

                                                // ✂️ 他クリップとの重なり（スマート・オーバーラップ）検知
                                                const clipEnd = displayStart + displayDuration;
                                                const overlappingClips = track.clips.filter((other, oi) => {
                                                    if (oi === ci) return false;
                                                    const otherEnd = other.start + other.duration;
                                                    return other.start < clipEnd && otherEnd > displayStart;
                                                });
                                                const hasOverlap = overlappingClips.length > 0;

                                                return (
                                                    <div
                                                        key={ci}
                                                        data-clip-item="true"
                                                        data-track-index={ti}
                                                        data-clip-index={ci}
                                                        onMouseEnter={() => setHoveredFadeClip({ track: ti, clip: ci })}
                                                        onMouseLeave={() => setHoveredFadeClip((prev) => prev?.track === ti && prev?.clip === ci ? null : prev)}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setContextMenu({
                                                                x: e.clientX,
                                                                y: e.clientY,
                                                                track: ti,
                                                                clip: ci,
                                                            });
                                                        }}
                                                        onPointerDown={(e) => {
                                                            e.stopPropagation();
                                                            if (e.button === 2) return; // 右クリックはメニュー表示のみ
                                                            if (cutToolActive) {
                                                                placeCutCursor(e, ti, ci);
                                                                return;
                                                            }
                                                            if (rangeToolActive && !isSel) {
                                                                startMarquee(e);
                                                                return;
                                                            }
                                                            onClipPointerDown(e, ti, ci, clip.start, pxPerSec);
                                                        }}
                                                        onPointerMove={onClipPointerMove}
                                                        onPointerUp={onClipPointerUp}
                                                        onPointerCancel={onClipPointerUp}
                                                        style={{
                                                            position: 'absolute',
                                                            left,
                                                            top: 8,
                                                            width: w,
                                                            height: 48,
                                                            background: isSel
                                                                ? `linear-gradient(180deg, ${track.color || '#3d7eff'} 0%, #1e3799 100%)`
                                                                : `linear-gradient(180deg, ${track.color || '#3468eb'} 0%, #0c2461 100%)`,
                                                            borderRadius: 4,
                                                            color: '#ffffff',
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                            overflow: 'visible',
                                                            cursor: cutToolActive ? 'crosshair' : rangeToolActive ? 'crosshair' : 'grab',
                                                            transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
                                                            opacity: drag ? 0.75 : 1,
                                                            border: isSel
                                                                ? '1px solid #ffffff'
                                                                : hasOverlap
                                                                    ? '1px solid rgba(255, 107, 129, 0.85)'
                                                                    : '1px solid rgba(255, 255, 255, 0.2)',
                                                            boxShadow: isSel
                                                                ? '0 0 0 1.5px #ffffff, 0 0 14px rgba(61, 126, 255, 0.7)'
                                                                : hasOverlap
                                                                    ? '0 0 8px rgba(255, 71, 87, 0.45)'
                                                                    : '0 2px 6px rgba(0,0,0,0.3)',
                                                            zIndex: drag ? 10 : isSel ? 5 : (ci + 1),
                                                        }}
                                                        onDoubleClick={(e) => {
                                                            e.stopPropagation();
                                                            onOpenPianoRoll?.(ti, ci);
                                                        }}
                                                        title={`${track.name || `Track ${ti + 1}`} (${formatTime(clip.start)}〜${formatTime(clip.start + clip.duration)}) / ノート ${clip.notes.length} 個（ダブルクリックでピアノロール編集）`}
                                                    >
                                                        <div
                                                            onPointerDown={(e) => beginTrim(e, ti, ci, 'left', clip.start, clip.duration, clip.trimStart ?? 0, clip.sourceDuration ?? clip.duration)}
                                                            onPointerMove={moveTrim}
                                                            onPointerUp={endTrim}
                                                            onPointerCancel={endTrim}
                                                            style={{
                                                                position: 'absolute', left: -4, top: 14, width: 9, height: 20,
                                                                cursor: 'ew-resize', zIndex: 20, borderRadius: 2,
                                                                opacity: isClipHovered || isTrimDragging ? 0.42 : 0,
                                                                background: 'rgba(255,255,255,0.9)',
                                                                boxShadow: isTrimDragging ? '0 0 3px rgba(0,0,0,0.55)' : 'none',
                                                                transition: 'opacity 80ms ease-out',
                                                            }}
                                                            title="左端をドラッグしてトリム"
                                                        />
                                                        <div
                                                            onPointerDown={(e) => beginTrim(e, ti, ci, 'right', clip.start, clip.duration, clip.trimStart ?? 0, clip.sourceDuration ?? clip.duration)}
                                                            onPointerMove={moveTrim}
                                                            onPointerUp={endTrim}
                                                            onPointerCancel={endTrim}
                                                            style={{
                                                                position: 'absolute', right: -4, top: 14, width: 9, height: 20,
                                                                cursor: 'ew-resize', zIndex: 20, borderRadius: 2,
                                                                opacity: isClipHovered || isTrimDragging ? 0.42 : 0,
                                                                background: 'rgba(255,255,255,0.9)',
                                                                boxShadow: isTrimDragging ? '0 0 3px rgba(0,0,0,0.55)' : 'none',
                                                                transition: 'opacity 80ms ease-out',
                                                            }}
                                                            title="右端をドラッグしてトリム"
                                                        />
                                                        {/* 🏷️ 左上スマートネームタグ（🎙️ マイク / 🎹 シンセ アイコン付き） */}
                                                        {(() => {
                                                            const hasAudioWaveform = Array.isArray(clip.peaks) && clip.peaks.length > 0 && clip.peaks.some(p => p && (p[0] > 0.005 || p[1] > 0.005));
                                                            const isMidiClip = track.inputType === 'midi' || (!hasAudioWaveform && Array.isArray(clip.notes) && clip.notes.length > 0);
                                                            return (
                                                                <div
                                                                    onPointerDown={(e) => {
                                                                        e.stopPropagation();
                                                                        if (e.button === 2) {
                                                                            setContextMenu({
                                                                                x: e.clientX,
                                                                                y: e.clientY,
                                                                                track: ti,
                                                                                clip: ci,
                                                                            });
                                                                            return;
                                                                        }
                                                                        if (cutToolActive) {
                                                                            placeCutCursor(e, ti, ci);
                                                                            return;
                                                                        }
                                                                        if (rangeToolActive && !isSel) {
                                                                            startMarquee(e);
                                                                            return;
                                                                        }
                                                                        const clipEl = e.currentTarget.parentElement as HTMLDivElement | null;
                                                                        if (clipEl && typeof clipEl.setPointerCapture === 'function') {
                                                                            try { clipEl.setPointerCapture(e.pointerId); } catch (_) { }
                                                                        }
                                                                        onClipPointerDown(e, ti, ci, clip.start, pxPerSec);
                                                                    }}
                                                                    onDoubleClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onOpenPianoRoll?.(ti, ci);
                                                                    }}
                                                                    style={{
                                                                        position: 'absolute',
                                                                        top: 0,
                                                                        left: 0,
                                                                        background: 'rgba(10, 16, 28, 0.92)',
                                                                        padding: '1px 6px',
                                                                        borderRadius: '0 0 4px 0',
                                                                        fontSize: 8.5,
                                                                        fontWeight: 800,
                                                                        color: isMidiClip ? '#f4f2ad' : '#c8d6e5',
                                                                        pointerEvents: 'auto',
                                                                        cursor: cutToolActive ? 'crosshair' : rangeToolActive ? 'crosshair' : 'grab',
                                                                        zIndex: 25,
                                                                        letterSpacing: '0.3px',
                                                                        borderRight: '1px solid rgba(255,255,255,0.25)',
                                                                        borderBottom: '1px solid rgba(255,255,255,0.25)',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: 4,
                                                                        boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                                                                        userSelect: 'none',
                                                                    }}
                                                                    title={`${track.name || `Clip ${ci + 1}`} を選択・ドラッグ移動（ダブルクリックで編集）`}
                                                                >
                                                                    {isMidiClip ? (
                                                                        <IconPiano size={10} color="#f4f2ad" />
                                                                    ) : (
                                                                        <IconMic size={10} color="#70e0ff" />
                                                                    )}
                                                                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: Math.max(30, w - 24) }}>
                                                                        {track.name || `Clip ${ci + 1}`}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* 🌊 プロ仕様・リアルタイムオーディオ波形描画 */}
                                                        {Array.isArray(clip.peaks) && clip.peaks.length > 0 && (
                                                            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 1, borderRadius: 3 }}>
                                                                <svg
                                                                    width="100%"
                                                                    height="100%"
                                                                    preserveAspectRatio="none"
                                                                    viewBox={`${(trimStartSec / sourceDurationSec) * clip.peaks.length} 0 ${Math.max(1, ((trimEndSec - trimStartSec) / sourceDurationSec) * clip.peaks.length)} 100`}
                                                                    style={{ width: '100%', height: '100%', display: 'block' }}
                                                                >
                                                                    <defs>
                                                                        <linearGradient id={`waveGrad_${ti}_${ci}`} x1="0" y1="0" x2="0" y2="1">
                                                                            <stop offset="0%" stopColor="#70e0ff" stopOpacity="0.85" />
                                                                            <stop offset="50%" stopColor="#00d2d3" stopOpacity="0.45" />
                                                                            <stop offset="100%" stopColor="#70e0ff" stopOpacity="0.85" />
                                                                        </linearGradient>
                                                                    </defs>
                                                                    {/* 上下対称波形パス */}
                                                                    <path
                                                                        d={(() => {
                                                                            const len = clip.peaks.length;
                                                                            let topPath = '';
                                                                            let bottomPath = '';
                                                                            for (let i = 0; i < len; ++i) {
                                                                                const [mn, mx] = clip.peaks[i];
                                                                                const topY = 50 - Math.max(1, Math.min(48, Math.abs(mx) * 48));
                                                                                const bottomY = 50 + Math.max(1, Math.min(48, Math.abs(mn) * 48));
                                                                                if (i === 0) {
                                                                                    topPath += `M ${i} ${topY}`;
                                                                                    bottomPath = `L ${i} ${bottomY}`;
                                                                                } else {
                                                                                    topPath += ` L ${i} ${topY}`;
                                                                                    bottomPath = ` L ${i} ${bottomY}` + bottomPath;
                                                                                }
                                                                            }
                                                                            return `${topPath} ${bottomPath} Z`;
                                                                        })()}
                                                                        fill={`url(#waveGrad_${ti}_${ci})`}
                                                                        stroke="#70e0ff"
                                                                        strokeWidth="0.6"
                                                                    />
                                                                </svg>
                                                            </div>
                                                        )}

                                                        {/* 🎵 スリムで美しい MIDI ノートミニマム描画 */}
                                                        {clip.notes.length > 0 && (
                                                            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2, borderRadius: 3 }}>
                                                                {(() => {
                                                                    const midis = clip.notes.map((n) => n.midi);
                                                                    const minM = Math.min(...midis);
                                                                    const maxM = Math.max(...midis);
                                                                    const mRange = Math.max(12, maxM - minM + 4);

                                                                    return clip.notes.map((n, ni) => {
                                                                        const visibleStart = Math.max(n.start, trimStartSec);
                                                                        const visibleEnd = Math.min(n.end, trimEndSec);
                                                                        if (visibleEnd <= visibleStart) return null;
                                                                        const nLeft = ((visibleStart - trimStartSec) / displayDuration) * 100;
                                                                        const nWidth = Math.max(((visibleEnd - visibleStart) / displayDuration) * 100, 0.8);
                                                                        const nSel = selectedClipNote?.track === ti && selectedClipNote?.clip === ci && selectedClipNote?.note === ni;
                                                                        const multiSel = isNoteSel(ni);
                                                                        const normPitch = (maxM + 2 - n.midi) / mRange;
                                                                        const topPx = normPitch * 34 + 8;

                                                                        return (
                                                                            <div
                                                                                key={ni}
                                                                                style={{
                                                                                    position: 'absolute',
                                                                                    left: `${nLeft}%`,
                                                                                    width: `${nWidth}%`,
                                                                                    top: topPx,
                                                                                    height: 2,
                                                                                    background: nSel || multiSel ? '#ffd32a' : '#ffffff',
                                                                                    borderRadius: 1,
                                                                                    boxShadow: nSel || multiSel
                                                                                        ? '0 0 4px #ffd32a'
                                                                                        : '0 0 2px rgba(255, 255, 255, 0.8)',
                                                                                    zIndex: 2,
                                                                                }}
                                                                            />
                                                                        );
                                                                    });
                                                                })()}
                                                            </div>
                                                        )}

                                                        {/* 🎚️ フェードイン・フェードアウト SVG カーブシェーディング */}
                                                        {(fadeInPx > 0 || fadeOutPx > 0) && (
                                                            <svg
                                                                style={{
                                                                    position: 'absolute',
                                                                    inset: 0,
                                                                    width: '100%',
                                                                    height: '100%',
                                                                    pointerEvents: 'none',
                                                                    zIndex: 3,
                                                                    borderRadius: 3,
                                                                }}
                                                            >
                                                                {fadeInPx > 0 && (
                                                                    <g>
                                                                        {/* フェードイン減衰シェード */}
                                                                        <path
                                                                            d={`M 0,0 L ${fadeInPx},0 C ${fadeInPx * 0.3},0 0,${48 * 0.7} 0,48 Z`}
                                                                            fill="rgba(0, 0, 0, 0.42)"
                                                                        />
                                                                        {/* フェードイン曲線 */}
                                                                        <path
                                                                            d={`M 0,48 C 0,${48 * 0.7} ${fadeInPx * 0.3},0 ${fadeInPx},0`}
                                                                            fill="none"
                                                                            stroke="rgba(255, 255, 255, 0.85)"
                                                                            strokeWidth="1.5"
                                                                        />
                                                                    </g>
                                                                )}
                                                                {fadeOutPx > 0 && (
                                                                    <g>
                                                                        {/* フェードアウト減衰シェード */}
                                                                        <path
                                                                            d={`M ${w},0 L ${w - fadeOutPx},0 C ${w - fadeOutPx * 0.3},0 ${w},${48 * 0.7} ${w},48 Z`}
                                                                            fill="rgba(0, 0, 0, 0.42)"
                                                                        />
                                                                        {/* フェードアウト曲線 */}
                                                                        <path
                                                                            d={`M ${w - fadeOutPx},0 C ${w - fadeOutPx * 0.3},0 ${w},${48 * 0.7} ${w},48`}
                                                                            fill="none"
                                                                            stroke="rgba(255, 255, 255, 0.85)"
                                                                            strokeWidth="1.5"
                                                                        />
                                                                    </g>
                                                                )}
                                                            </svg>
                                                        )}

                                                        {/* 🎛️ 左上フェードイン・角ハンドル */}
                                                        <div
                                                            onPointerDown={(e) => {
                                                                e.stopPropagation();
                                                                setFadeDrag({
                                                                    track: ti,
                                                                    clip: ci,
                                                                    type: 'in',
                                                                    startX: e.clientX,
                                                                    origFade: clip.fadeIn ?? 0,
                                                                    currentFade: clip.fadeIn ?? 0,
                                                                    maxSec: clip.duration,
                                                                });
                                                            }}
                                                            style={{
                                                                position: 'absolute',
                                                                left: Math.max(0, fadeInPx - 6),
                                                                top: -1,
                                                                width: 12,
                                                                height: 14,
                                                                cursor: 'ew-resize',
                                                                zIndex: 10,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                opacity: isClipHovered || isFadeDraggingIn || fadeInPx > 0 ? 1 : 0,
                                                                transition: 'opacity 0.15s ease',
                                                            }}
                                                            title={`フェードイン調整（ドラッグで出だしの音量変化を設定） / 現在: ${activeFadeIn.toFixed(2)}s`}
                                                        >
                                                            <div
                                                                style={{
                                                                    width: 8,
                                                                    height: 8,
                                                                    background: isFadeDraggingIn ? '#ffd32a' : '#ffffff',
                                                                    borderRadius: 1,
                                                                    transform: 'rotate(45deg)',
                                                                    border: '1px solid rgba(0,0,0,0.6)',
                                                                    boxShadow: '0 1px 3px rgba(0,0,0,0.8)',
                                                                }}
                                                            />
                                                        </div>

                                                        {/* 🎛️ 右上フェードアウト・角ハンドル */}
                                                        <div
                                                            onPointerDown={(e) => {
                                                                e.stopPropagation();
                                                                setFadeDrag({
                                                                    track: ti,
                                                                    clip: ci,
                                                                    type: 'out',
                                                                    startX: e.clientX,
                                                                    origFade: clip.fadeOut ?? 0,
                                                                    currentFade: clip.fadeOut ?? 0,
                                                                    maxSec: clip.duration,
                                                                });
                                                            }}
                                                            style={{
                                                                position: 'absolute',
                                                                right: Math.max(0, fadeOutPx - 6),
                                                                top: -1,
                                                                width: 12,
                                                                height: 14,
                                                                cursor: 'ew-resize',
                                                                zIndex: 10,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                opacity: isClipHovered || isFadeDraggingOut || fadeOutPx > 0 ? 1 : 0,
                                                                transition: 'opacity 0.15s ease',
                                                            }}
                                                            title={`フェードアウト調整（ドラッグで最後の音量変化を設定） / 現在: ${activeFadeOut.toFixed(2)}s`}
                                                        >
                                                            <div
                                                                style={{
                                                                    width: 8,
                                                                    height: 8,
                                                                    background: isFadeDraggingOut ? '#ffd32a' : '#ffffff',
                                                                    borderRadius: 1,
                                                                    transform: 'rotate(45deg)',
                                                                    border: '1px solid rgba(0,0,0,0.6)',
                                                                    boxShadow: '0 1px 3px rgba(0,0,0,0.8)',
                                                                }}
                                                            />
                                                        </div>

                                                        {/* 💬 ドラッグ中のリアルタイム HUD ツールチップ */}
                                                        {(isFadeDraggingIn || isFadeDraggingOut) && (
                                                            <div
                                                                style={{
                                                                    position: 'absolute',
                                                                    top: -24,
                                                                    left: isFadeDraggingIn ? fadeInPx : undefined,
                                                                    right: isFadeDraggingOut ? fadeOutPx : undefined,
                                                                    transform: 'translateX(-50%)',
                                                                    background: '#10141d',
                                                                    border: '1px solid #528bff',
                                                                    borderRadius: 4,
                                                                    padding: '2px 6px',
                                                                    fontSize: 9.5,
                                                                    fontWeight: 900,
                                                                    color: '#ffffff',
                                                                    whiteSpace: 'nowrap',
                                                                    pointerEvents: 'none',
                                                                    boxShadow: '0 4px 12px rgba(0,0,0,0.8)',
                                                                    zIndex: 20,
                                                                }}
                                                            >
                                                                {isFadeDraggingIn ? `Fade In: ${activeFadeIn.toFixed(2)}s` : `Fade Out: ${activeFadeOut.toFixed(2)}s`}
                                                            </div>
                                                        )}

                                                        {/* ✂️ クリップ重なり領域の斜線ストライプ・インジケーター */}
                                                        {overlappingClips.map((other, oi) => {
                                                            const otherEnd = other.start + other.duration;
                                                            const overlapStartSec = Math.max(displayStart, other.start);
                                                            const overlapEndSec = Math.min(clipEnd, otherEnd);
                                                            if (overlapEndSec <= overlapStartSec) return null;
                                                            const oLeft = (overlapStartSec - displayStart) * pxPerSec;
                                                            const oWidth = Math.max(2, (overlapEndSec - overlapStartSec) * pxPerSec);
                                                            return (
                                                                <div
                                                                    key={oi}
                                                                    style={{
                                                                        position: 'absolute',
                                                                        left: oLeft,
                                                                        top: 0,
                                                                        width: oWidth,
                                                                        height: '100%',
                                                                        background: 'repeating-linear-gradient(45deg, rgba(255, 71, 87, 0.18), rgba(255, 71, 87, 0.18) 4px, rgba(0, 0, 0, 0.25) 4px, rgba(0, 0, 0, 0.25) 8px)',
                                                                        borderLeft: '1px dashed rgba(255, 107, 129, 0.8)',
                                                                        borderRight: '1px dashed rgba(255, 107, 129, 0.8)',
                                                                        pointerEvents: 'none',
                                                                        zIndex: 3,
                                                                    }}
                                                                />
                                                            );
                                                        })}

                                                        {/* 空クリップ */}
                                                        {(!clip.peaks || clip.peaks.length === 0) && clip.notes.length === 0 && (
                                                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, fontSize: 9 }}>
                                                                空クリップ
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* 🎙️ / 🎹 録音中のリアルタイム追尾クリップ（マイク / シンセ 自動判定＆目に優しいトーン） */}
                                            {isRecordingOnThisTrack && (() => {
                                                const isMidiTrack = track.inputType === 'midi';
                                                const bgGrad = isMidiTrack
                                                    ? 'linear-gradient(135deg, rgba(120, 75, 15, 0.78) 0%, rgba(90, 45, 10, 0.68) 100%)'
                                                    : 'linear-gradient(135deg, rgba(20, 60, 95, 0.78) 0%, rgba(12, 85, 80, 0.68) 100%)';
                                                const borderColor = isMidiTrack ? '#e1b12c' : '#22a6b3';
                                                const glowColor = isMidiTrack ? 'rgba(225, 177, 44, 0.35)' : 'rgba(34, 166, 179, 0.35)';
                                                const recLabel = isMidiTrack ? 'MIDI REC' : 'MIC REC';
                                                const recLabelColor = isMidiTrack ? '#f4f2ad' : '#70e0ff';

                                                return (
                                                    <div
                                                        style={{
                                                            position: 'absolute',
                                                            left: recStartSeconds * pxPerSec,
                                                            top: 4,
                                                            bottom: 4,
                                                            // クリップ幅は C++ 側が固定 100点/秒でどんどん居てる peaks.length / 100秒で算出。
                                                            // こうすることで SVG viewBox 幅（peaks.length）とクリップ px 幅が
                                                            // 常に比例一致し、波形が左から右へ正しく居まる。
                                                            width: Math.max(6, ((status?.liveRecordPeaks?.length ?? 0) > 0
                                                                ? (status!.liveRecordPeaks!.length / 100) * pxPerSec
                                                                : recSeconds * pxPerSec)),
                                                            background: bgGrad,
                                                            borderRadius: 4,
                                                            color: '#ffffff',
                                                            border: `1px solid ${borderColor}80`,
                                                            borderRight: `3px solid ${borderColor}`,
                                                            boxShadow: `0 0 14px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.2)`,
                                                            zIndex: 8,
                                                            overflow: 'hidden',
                                                        }}
                                                    >
                                                        {/* 左上：スタイリッシュなトラック名＆録音タイプタグ */}
                                                        <div
                                                            style={{
                                                                position: 'absolute',
                                                                top: 2,
                                                                left: 4,
                                                                background: 'rgba(10, 14, 22, 0.75)',
                                                                padding: '1px 6px',
                                                                borderRadius: 3,
                                                                fontSize: 9,
                                                                fontWeight: 900,
                                                                color: '#ffffff',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 5,
                                                                zIndex: 5,
                                                                pointerEvents: 'none',
                                                            }}
                                                        >
                                                            {isMidiTrack ? (
                                                                <IconPiano size={10} color="#f4f2ad" />
                                                            ) : (
                                                                <IconMic size={10} color="#70e0ff" />
                                                            )}
                                                            <span>{track.name || `Track ${ti + 1}`}</span>
                                                            <span style={{ color: recLabelColor, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 3 }}>
                                                                <span>{recLabel} {recSeconds.toFixed(1)}s</span>
                                                            </span>
                                                        </div>

                                                        {/* 🌊 プロ仕様リアルタイム音声波形描画（録音経過時間に合わせて右へ蓄積されていく） */}
                                                        {!isMidiTrack && Array.isArray(status?.liveRecordPeaks) && status.liveRecordPeaks.length > 0 && (
                                                            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
                                                                <svg
                                                                    width="100%"
                                                                    height="100%"
                                                                    preserveAspectRatio="none"
                                                                    viewBox={`0 0 ${status.liveRecordPeaks.length} 100`}
                                                                    style={{ width: '100%', height: '100%', display: 'block' }}
                                                                >
                                                                    <defs>
                                                                        <linearGradient id={`liveWaveGrad_${ti}`} x1="0" y1="0" x2="0" y2="1">
                                                                            <stop offset="0%" stopColor="#70e0ff" stopOpacity="0.95" />
                                                                            <stop offset="50%" stopColor="#00d2d3" stopOpacity="0.45" />
                                                                            <stop offset="100%" stopColor="#70e0ff" stopOpacity="0.95" />
                                                                        </linearGradient>
                                                                    </defs>
                                                                    {/* 上下対称リアルタイム波形パス */}
                                                                    <path
                                                                        d={(() => {
                                                                            const len = status.liveRecordPeaks.length;
                                                                            let topPath = '';
                                                                            let bottomPath = '';
                                                                            for (let i = 0; i < len; ++i) {
                                                                                const peak = status.liveRecordPeaks[i];
                                                                                const clamped = Math.min(1.0, Math.max(0.03, peak * 2.2));
                                                                                const topY = 50 - clamped * 45;
                                                                                const bottomY = 50 + clamped * 45;
                                                                                if (i === 0) {
                                                                                    topPath += `M ${i} ${topY}`;
                                                                                    bottomPath = `L ${i} ${bottomY}`;
                                                                                } else {
                                                                                    topPath += ` L ${i} ${topY}`;
                                                                                    bottomPath = ` L ${i} ${bottomY}` + bottomPath;
                                                                                }
                                                                            }
                                                                            return `${topPath} ${bottomPath} Z`;
                                                                        })()}
                                                                        fill={`url(#liveWaveGrad_${ti})`}
                                                                        stroke="#70e0ff"
                                                                        strokeWidth="0.75"
                                                                        opacity={0.95}
                                                                    />
                                                                    {/* センターライン */}
                                                                    <line x1="0" y1="50" x2={status.liveRecordPeaks.length} y2="50" stroke="rgba(112, 224, 255, 0.45)" strokeWidth="0.8" />
                                                                </svg>
                                                            </div>
                                                        )}

                                                        {/* 🎵 リアルタイムに入力された MIDI ノートのミニ描画（MIDIトラックのみ） */}
                                                        {isMidiTrack && Array.isArray(liveMidiNotes) && liveMidiNotes.length > 0 && (
                                                            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                                                                {liveMidiNotes.map((rawEntry: unknown, nIdx: number) => {
                                                                    const rawNote = (rawEntry ?? {}) as Partial<LiveMidiNote> & Record<string, unknown>;
                                                                    const noteStart = Number(rawNote.startSeconds ?? rawNote.start ?? 0);
                                                                    const noteEnd = Number(rawNote.endSeconds ?? rawNote.end ?? noteStart + 0.3);
                                                                    const midi = Number(rawNote.note ?? rawNote.midi ?? 60);

                                                                    // C++ の liveMidiNotes (startSeconds) は録音開始時からの相対秒 (0.0s スタート)
                                                                    const relStart = Math.max(0, noteStart);
                                                                    const nLeft = relStart * pxPerSec;
                                                                    const nWidth = Math.max(4, Math.max(0.1, noteEnd - noteStart) * pxPerSec);
                                                                    // MIDI 36(C2)〜84(C6) の範囲で Y 座標をマッピング
                                                                    const relPitch = Math.max(0, Math.min(1, (midi - 36) / 48));
                                                                    const nTop = (1.0 - relPitch) * 44 + 14;

                                                                    return (
                                                                        <div
                                                                            key={nIdx}
                                                                            style={{
                                                                                position: 'absolute',
                                                                                left: nLeft,
                                                                                top: nTop,
                                                                                width: nWidth,
                                                                                height: 2,
                                                                                background: '#ffffff',
                                                                                borderRadius: 1,
                                                                                boxShadow: '0 0 3px rgba(255, 255, 255, 0.9)',
                                                                            }}
                                                                            title={`${noteName(midi)}`}
                                                                        />
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })()}

                                            {/* カットカーソル */}
                                            {cutCursor?.track === ti ? (
                                                <div
                                                    style={{
                                                        position: 'absolute',
                                                        left: (cutCursor.clip >= 0 && cutCursor.clip < track.clips.length
                                                            ? (track.clips[cutCursor.clip].start + cutCursor.timeSeconds) * pxPerSec
                                                            : 0),
                                                        top: 0,
                                                        width: 2,
                                                        height: '100%',
                                                        background: '#ffc857',
                                                        zIndex: 6,
                                                    }}
                                                />
                                            ) : null}

                                            {/* 垂直再生/録音ヘッド（録音時は赤ライン、再生時は黄色ライン） */}
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    left: currentHeadSec * pxPerSec,
                                                    top: 0,
                                                    width: 2,
                                                    height: '100%',
                                                    background: status?.isRecording ? '#ff3838' : (status?.isSessionPlaying || status?.isPlaying) ? '#ffd32a' : '#ffffff',
                                                    boxShadow: status?.isRecording ? '0 0 10px #ff3838' : (status?.isSessionPlaying || status?.isPlaying) ? '0 0 8px #ffd32a' : '0 0 4px rgba(255,255,255,0.6)',
                                                    zIndex: 8,
                                                    pointerEvents: 'none',
                                                }}
                                            >
                                                {/* 上部再生ヘッドマーカー（三角） */}
                                                <div
                                                    style={{
                                                        position: 'absolute',
                                                        top: 0,
                                                        left: -4,
                                                        width: 0,
                                                        height: 0,
                                                        borderLeft: '5px solid transparent',
                                                        borderRight: '5px solid transparent',
                                                        borderTop: `6px solid ${status?.isRecording ? '#ff3838' : status?.isSessionPlaying ? '#ffd32a' : '#ffffff'}`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {marquee ? (
                            <div
                                style={{
                                    position: 'fixed',
                                    left: Math.min(marquee.x1, marquee.x2),
                                    top: Math.min(marquee.y1, marquee.y2),
                                    width: Math.abs(marquee.x2 - marquee.x1),
                                    height: Math.abs(marquee.y2 - marquee.y1),
                                    border: '1px solid #7aa2ff',
                                    background: 'rgba(122, 162, 255, 0.15)',
                                    zIndex: 100,
                                    pointerEvents: 'none',
                                }}
                            />
                        ) : null}
                        {tracks.length === 0 ? (
                            <div style={{ padding: 16, color: '#555', fontSize: 13 }}>
                                まだトラックがありません。「＋トラック」で追加してください。
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* 🖱️ クリップ右クリック・コンテキストメニュー */}
            {contextMenu && (
                <ClipContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    track={contextMenu.track}
                    clip={contextMenu.clip}
                    status={status}
                    selectedNotes={selectedNotes}
                    selectedClipNote={selectedClipNote}
                    selectedClips={selectedClips}
                    voices={voices}
                    trackName={tracks[contextMenu.track]?.name || `Track ${contextMenu.track + 1}`}
                    onClose={() => setContextMenu(null)}
                    onOpenEqModalForClip={onOpenEqModalForClip}
                    onOpenSynthEditorForClip={onOpenSynthEditorForClip}
                    onDuplicateNotes={onDuplicateNotes}
                    onDeleteNotes={onDeleteNotes}
                    onPlayClipAsSequence={onPlayClipAsSequence}
                    onConvertClipToVoice={onConvertClipToVoice}
                    onPlayClipWithVoice={onPlayClipWithVoice}
                    onDuplicateClip={onDuplicateClip}
                    onOpenPianoRoll={onOpenPianoRoll}
                    onSaveVoiceRequest={(track, clip) => {
                        const trk = tracks[track];
                        const trkName = trk?.name || `Track ${track + 1}`;
                        const defaultName = `${trkName} Voice`;
                        setSaveVoiceModal({
                            track,
                            clip,
                            defaultName,
                        });
                    }}
                    onDeleteClip={onDeleteClip}
                    onDeleteClips={onDeleteClips}
                />
            )}

            {/* 🎛️ トラックヘッダー右クリックメニュー */}
            {trackContextMenu && (
                <TrackContextMenu
                    x={trackContextMenu.x}
                    y={trackContextMenu.y}
                    track={trackContextMenu.track}
                    trackName={tracks[trackContextMenu.track]?.name}
                    isMidiTrack={
                        tracks[trackContextMenu.track]?.inputType === 'midi'
                    }
                    currentInstrument={instrumentKindOf(
                        trackContextMenu.track,
                    )}
                    currentVoicePresetIdx={
                        voicePresetIndices[trackContextMenu.track] ?? -1
                    }
                    currentVaPresetIdx={
                        vaPresetIndices[trackContextMenu.track] ?? -1
                    }
                    presets={voices || []}
                    vaPresets={props.vaPresets || []}
                    onAddTrack={onAddTrack}
                    onDeleteTrack={onDeleteTrack}
                    onSetInstrument={(t, kind, presetIdx) => {
                        void native.sessionSetTrackInstrument(t, kind, presetIdx).then(
                            () => {
                                setInstrumentTick((v) => v + 1);
                                if (kind === 'voice' && typeof presetIdx === 'number' && presetIdx >= 0) {
                                    void props.onLoadVoice?.(presetIdx);
                                } else if (kind === 'va' && typeof presetIdx === 'number' && presetIdx >= 0) {
                                    void props.onLoadVirtualAnalogPreset?.(presetIdx);
                                }
                            },
                        );
                    }}
                    onClose={() => setTrackContextMenu(null)}
                />
            )}

            {/* 🎙️ クリップ歌声を名前付きでボイスライブラリへ保存するモーダル */}
            {saveVoiceModal && (
                <SaveVoiceModal
                    track={saveVoiceModal.track}
                    clip={saveVoiceModal.clip}
                    defaultName={saveVoiceModal.defaultName}
                    onAssignClipToSynth={onAssignClipToSynth}
                    onClose={() => setSaveVoiceModal(null)}
                />
            )}
        </div>
    );
}
