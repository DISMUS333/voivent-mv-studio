//==============================================================================
// 本格ピアノロール（MIDIエディタ）。
// - 5px/s 〜 3000px/s の極大時間ズーム（150小節の全体俯瞰からミリ秒単位のミクロ編集まで）
// - 4px 〜 60px の極大音高ズーム（全音域128鍵の一望から巨大鍵盤まで）
// - 適応型タイムラインルーラー（ズーム率に応じて小節・拍・16分目盛りを自動最適化）
// - 美しいリアルピアノ鍵盤デザイン（白鍵立体グラデーション・黒鍵ハイライト）
// - ルーラー上でのホイール・ドラッグによる瞬時ズーム
// - 安定したベロシティレーン & ノート編集
//==============================================================================
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { AnalysisNote, SessionTrack, VoiceLibraryEntry } from '../types';
import { noteName } from '../lib/music';
import {
    IconClose,
    IconTrash,
    IconFollowPlayhead,
    IconPiano,
} from './Icons';

// 音域の定義 (C1=24 〜 B7=107: 7オクターブ 84半音)
const MIN_MIDI = 24;
const MAX_MIDI = 107;
const TOTAL_KEYS = MAX_MIDI - MIN_MIDI + 1;
const VELOCITY_LANE_HEIGHT = 100;
const RULER_HEIGHT = 28;

// 白鍵・黒鍵の判定
const isBlackKey = (midi: number) => {
    const semitone = midi % 12;
    return semitone === 1 || semitone === 3 || semitone === 6 || semitone === 8 || semitone === 10;
};

export interface PianoRollEditorProps {
    trackIndex: number;
    clipIndex: number;
    track: SessionTrack;
    notes: AnalysisNote[];
    clipDuration: number;
    clipStart: number;
    voices?: VoiceLibraryEntry[];
    onUpdateNote: (track: number, clip: number, noteIndex: number, midi: number, start: number, end: number, velocity?: number) => void;
    onAddNote: (track: number, clip: number, midi: number, start: number, end: number, velocity?: number) => void;
    onDeleteNote: (track: number, clip: number, noteIndex: number) => void;
    onPreviewNote?: (midi: number, velocity?: number) => void;
    onClose: () => void;
}

export function PianoRollEditor(props: PianoRollEditorProps) {
    const {
        trackIndex,
        clipIndex,
        track,
        notes: propNotes,
        clipDuration,
        onUpdateNote,
        onAddNote,
        onDeleteNote,
        onPreviewNote,
        onClose,
    } = props;

    // 即時描画用のローカルノートステート
    const [localNotes, setLocalNotes] = useState<AnalysisNote[]>(propNotes);
    const localNotesRef = useRef<AnalysisNote[]>(propNotes);
    const isDraggingRef = useRef<boolean>(false);

    useEffect(() => {
        // ドラッグ中は親コンポーネントからの再レンダリングで上書きしない
        if (!isDraggingRef.current) {
            setLocalNotes(propNotes);
            localNotesRef.current = propNotes;
        }
    }, [propNotes]);

    const [selectedNoteIdx, setSelectedNoteIdx] = useState<number | null>(propNotes.length > 0 ? 0 : null);
    const [selectedNoteIndices, setSelectedNoteIndices] = useState<number[]>(propNotes.length > 0 ? [0] : []);
    const [allowDblClickDelete, setAllowDblClickDelete] = useState<boolean>(false); // 誤操作防止のためデフォルトOFF（安全設計）
    const [snapEnabled, setSnapEnabled] = useState<boolean>(true); // スナップ ON/OFF 切替
    const [snapGrid, setSnapGrid] = useState<number>(0.125); // 1/16拍（0.125秒）
    const [pxPerSec, setPxPerSec] = useState<number>(180); // 横ズーム（時間軸 5〜3000px/s）
    const [rowHeight, setRowHeight] = useState<number>(18); // 縦ズーム（鍵盤高さ 4〜60px）

    // 🎹 範囲選択（マーキー）ステート
    const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
    const marqueeRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const rulerInnerRef = useRef<HTMLDivElement>(null);
    const velocityLaneInnerRef = useRef<HTMLDivElement>(null);

    // 最大時間を十分に確保（ズームアウト時も途切れない）
    const maxTime = Math.max(120, clipDuration + 10.0);
    const gridWidth = Math.max(800, maxTime * pxPerSec);
    const gridHeight = TOTAL_KEYS * rowHeight;

    // ノート / ベロシティドラッグ操作ステート
    const dragRef = useRef<{
        type: 'move' | 'resize-start' | 'resize-end' | 'velocity';
        noteIndex: number;
        startX: number;
        startY: number;
        origStart: number;
        origEnd: number;
        origMidi: number;
        origVel: number;
        currentVel: number;
        selectedSnapshots?: {
            index: number;
            origStart: number;
            origEnd: number;
            origMidi: number;
            origVel: number;
        }[];
    } | null>(null);

    // ルーラードラッグズーム用ステート
    const rulerDragRef = useRef<{
        startY: number;
        startPxPerSec: number;
    } | null>(null);

    // 初期スクロール位置（ノートが存在する音域の中央にスクロール）
    useEffect(() => {
        if (scrollContainerRef.current) {
            let avgMidi = 60; // C4
            if (propNotes.length > 0) {
                const sum = propNotes.reduce((acc, n) => acc + n.midi, 0);
                avgMidi = sum / propNotes.length;
            }
            const keyIndexFromTop = MAX_MIDI - avgMidi;
            const targetY = Math.max(0, keyIndexFromTop * rowHeight - 200);
            scrollContainerRef.current.scrollTop = targetY;
        }
    }, []);

    // キーボードショートカット (Delete / Backspace で選択ノート削除)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedNoteIndices.length > 0) {
                    e.preventDefault();
                    // インデックスの大きい順に削除してインデックス狂いを防止
                    const sortedIndices = [...selectedNoteIndices].sort((a, b) => b - a);
                    sortedIndices.forEach((idx) => {
                        onDeleteNote(trackIndex, clipIndex, idx);
                    });
                    setSelectedNoteIndices([]);
                    setSelectedNoteIdx(null);
                } else if (selectedNoteIdx !== null) {
                    e.preventDefault();
                    onDeleteNote(trackIndex, clipIndex, selectedNoteIdx);
                    setSelectedNoteIdx(null);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedNoteIdx, selectedNoteIndices, trackIndex, clipIndex, onDeleteNote]);

    // グリッドスナップヘルパー（snapEnabled が false のときは完全フリー移動）
    const snapTime = useCallback((t: number, forceFree = false) => {
        if (!snapEnabled || forceFree || snapGrid <= 0) return Math.max(0, t);
        return Math.max(0, Math.round(t / snapGrid) * snapGrid);
    }, [snapEnabled, snapGrid]);

    // ルーラー上でのマウスホイール（コロコロ）ズーム
    const changePxPerSec = (newPx: number, mouseClientX?: number) => {
        const clampedPx = Math.min(2000, Math.max(2, Math.round(newPx)));
        const container = scrollContainerRef.current;
        if (!container) {
            setPxPerSec(clampedPx);
            return;
        }

        const oldPx = pxPerSec;
        const rect = container.getBoundingClientRect();
        const scrollLeft = container.scrollLeft;

        let anchorTimeSec: number;
        let screenOffsetX: number;

        if (mouseClientX !== undefined) {
            // 鍵盤幅 84px より右側
            screenOffsetX = Math.max(0, mouseClientX - (rect.left + 84));
            anchorTimeSec = (scrollLeft + screenOffsetX) / oldPx;
        } else {
            screenOffsetX = (container.clientWidth - 84) / 2;
            anchorTimeSec = (scrollLeft + screenOffsetX) / oldPx;
        }

        setPxPerSec(clampedPx);

        requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
                const targetScrollLeft = anchorTimeSec * clampedPx - screenOffsetX;
                scrollContainerRef.current.scrollLeft = Math.max(0, targetScrollLeft);
            }
        });
    };

    const handleRulerWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY;
        const zoomFactor = delta < 0 ? 1.25 : 0.8;
        changePxPerSec(pxPerSec * zoomFactor, e.clientX);
    };

    // 🎹 音高（縦）ズーム：現在の音階位置を厳密に画面上に保持したままズーム
    const changeRowHeight = (newHeight: number, mouseClientY?: number) => {
        const clampedHeight = Math.min(60, Math.max(4, Math.round(newHeight)));
        const container = scrollContainerRef.current;
        if (!container) {
            setRowHeight(clampedHeight);
            return;
        }

        const rect = container.getBoundingClientRect();
        const scrollTop = container.scrollTop;
        const oldHeight = rowHeight;

        // アンカーとする音階のインデックス（画面上の位置）
        let screenOffsetY: number;
        let anchorKeyIdx: number;

        if (mouseClientY !== undefined) {
            screenOffsetY = Math.max(0, mouseClientY - rect.top);
            anchorKeyIdx = (scrollTop + screenOffsetY) / oldHeight;
        } else {
            screenOffsetY = container.clientHeight / 2;
            anchorKeyIdx = (scrollTop + screenOffsetY) / oldHeight;
        }

        setRowHeight(clampedHeight);

        requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
                const targetScrollTop = anchorKeyIdx * clampedHeight - screenOffsetY;
                scrollContainerRef.current.scrollTop = Math.max(0, targetScrollTop);
            }
        });
    };

    // 鍵盤エリア上でのマウスホイール（コロコロ）縦ズーム
    const handleKeyboardWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY;
        const factor = delta < 0 ? 1.15 : 0.85;
        changeRowHeight(rowHeight * factor, e.clientY);
    };

    // グリッド上での Ctrl / Cmd / Alt + ホイールズーム
    const handleGridWheel = (e: React.WheelEvent) => {
        if (e.altKey || e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY;
            if (e.shiftKey) {
                // 縦ズーム（マウス音階アンカー）
                const factor = delta < 0 ? 1.15 : 0.85;
                changeRowHeight(rowHeight * factor, e.clientY);
            } else {
                // 横ズーム（マウスタイムアンカー）
                const zoomFactor = delta < 0 ? 1.25 : 0.8;
                changePxPerSec(pxPerSec * zoomFactor, e.clientX);
            }
        }
    };

    // ルーラーでの上下ドラッグズーム
    const handleRulerPointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch (_) { }
        rulerDragRef.current = {
            startY: e.clientY,
            startPxPerSec: pxPerSec,
        };
    };

    const handleRulerPointerMove = (e: React.PointerEvent) => {
        if (!rulerDragRef.current) return;
        const dy = e.clientY - rulerDragRef.current.startY;
        const factor = Math.exp(dy * 0.02);
        const newPx = Math.min(3000, Math.max(5, Math.round(rulerDragRef.current.startPxPerSec * factor)));
        setPxPerSec(newPx);
    };

    const handleRulerPointerUp = (e: React.PointerEvent) => {
        if (rulerDragRef.current) {
            try {
                e.currentTarget.releasePointerCapture(e.pointerId);
            } catch (_) { }
            rulerDragRef.current = null;
        }
    };

    // グローバルな window pointermove / pointerup リスナー（ドラッグが絶対に外れない安全設計）
    useEffect(() => {
        const onWindowPointerMove = (e: PointerEvent) => {
            if (!dragRef.current) return;

            // 🚀 ドラッグ中の画面端オートスクロール（Edge Auto-Scrolling）
            if (scrollContainerRef.current) {
                const container = scrollContainerRef.current;
                const rect = container.getBoundingClientRect();
                const margin = 40;
                const speed = 14;

                if (e.clientX > rect.right - margin) container.scrollLeft += speed;
                else if (e.clientX < rect.left + 84 + margin) container.scrollLeft = Math.max(0, container.scrollLeft - speed);

                // ⚠️ ベロシティ調整時（type === 'velocity'）は画面が勝手に上下スクロールしないように縦オートスクロールを無効化
                if (dragRef.current.type !== 'velocity') {
                    if (e.clientY > rect.bottom - margin) container.scrollTop += speed;
                    else if (e.clientY < rect.top + margin) container.scrollTop = Math.max(0, container.scrollTop - speed);
                }
            }

            const { type, noteIndex, startX, startY, origStart, origEnd, origMidi, origVel } = dragRef.current;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (type === 'move') {
                const dt = dx / pxPerSec;
                const dMidi = -Math.round(dy / rowHeight);
                const snapshots = dragRef.current.selectedSnapshots;

                if (snapshots && snapshots.length > 1) {
                    // 🎹 複数選択ノートの同時ずらし（時間移動 ＆ 音高変更）
                    setLocalNotes((prev) => {
                        const next = [...prev];
                        snapshots.forEach((snap) => {
                            if (next[snap.index]) {
                                const newMidi = Math.min(MAX_MIDI, Math.max(MIN_MIDI, snap.origMidi + dMidi));
                                const noteDur = snap.origEnd - snap.origStart;
                                const newStart = snapTime(snap.origStart + dt, e.shiftKey);
                                const newEnd = newStart + noteDur;
                                next[snap.index] = { ...next[snap.index], midi: newMidi, start: newStart, end: newEnd };
                            }
                        });
                        localNotesRef.current = next;
                        return next;
                    });
                } else {
                    const newMidi = Math.min(MAX_MIDI, Math.max(MIN_MIDI, origMidi + dMidi));
                    const noteDur = origEnd - origStart;
                    const newStart = snapTime(origStart + dt, e.shiftKey);
                    const newEnd = newStart + noteDur;

                    setLocalNotes((prev) => {
                        const next = [...prev];
                        if (next[noteIndex]) {
                            next[noteIndex] = { ...next[noteIndex], midi: newMidi, start: newStart, end: newEnd };
                        }
                        localNotesRef.current = next;
                        return next;
                    });

                    if (newMidi !== localNotesRef.current[noteIndex]?.midi && onPreviewNote) {
                        onPreviewNote(newMidi, origVel);
                    }
                }
            } else if (type === 'resize-start') {
                const dt = dx / pxPerSec;
                const newStart = snapTime(Math.min(origEnd - 0.05, Math.max(0, origStart + dt)), e.shiftKey);

                setLocalNotes((prev) => {
                    const next = [...prev];
                    if (next[noteIndex]) {
                        next[noteIndex] = { ...next[noteIndex], start: newStart };
                    }
                    localNotesRef.current = next;
                    return next;
                });
            } else if (type === 'resize-end') {
                const dt = dx / pxPerSec;
                const newEnd = snapTime(Math.max(origStart + 0.05, origEnd + dt), e.shiftKey);

                setLocalNotes((prev) => {
                    const next = [...prev];
                    if (next[noteIndex]) {
                        next[noteIndex] = { ...next[noteIndex], end: newEnd };
                    }
                    localNotesRef.current = next;
                    return next;
                });
            } else if (type === 'velocity') {
                // 上にドラッグで音量UP（+）、下にドラッグでDOWN（-）
                const dVel = -dy / 70.0;
                const snapshots = dragRef.current.selectedSnapshots;

                if (snapshots && snapshots.length > 1) {
                    // 🎛️ 複数選択ノートのベロシティ一括変更
                    setLocalNotes((prev) => {
                        const next = [...prev];
                        snapshots.forEach((snap) => {
                            if (next[snap.index]) {
                                const newVel = Math.min(1.0, Math.max(0.05, snap.origVel + dVel));
                                next[snap.index] = { ...next[snap.index], velocity: newVel };
                            }
                        });
                        localNotesRef.current = next;
                        return next;
                    });
                } else {
                    const newVel = Math.min(1.0, Math.max(0.05, origVel + dVel));
                    dragRef.current.currentVel = newVel;

                    setLocalNotes((prev) => {
                        const next = [...prev];
                        if (next[noteIndex]) {
                            next[noteIndex] = { ...next[noteIndex], velocity: newVel };
                        }
                        localNotesRef.current = next;
                        return next;
                    });
                }
            }
        };

        const onWindowPointerUp = () => {
            if (dragRef.current) {
                const snapshots = dragRef.current.selectedSnapshots;
                if (snapshots && snapshots.length > 1) {
                    // 複数ノートの一括保存
                    snapshots.forEach((snap) => {
                        const targetNote = localNotesRef.current[snap.index];
                        if (targetNote) {
                            onUpdateNote(
                                trackIndex,
                                clipIndex,
                                snap.index,
                                targetNote.midi,
                                targetNote.start,
                                targetNote.end,
                                targetNote.velocity ?? 0.8
                            );
                        }
                    });
                } else {
                    const { noteIndex } = dragRef.current;
                    const targetNote = localNotesRef.current[noteIndex];
                    if (targetNote) {
                        onUpdateNote(
                            trackIndex,
                            clipIndex,
                            noteIndex,
                            targetNote.midi,
                            targetNote.start,
                            targetNote.end,
                            targetNote.velocity ?? 0.8
                        );
                        if (dragRef.current.type === 'velocity' && onPreviewNote) {
                            onPreviewNote(targetNote.midi, targetNote.velocity ?? 0.8);
                        }
                    }
                }
                dragRef.current = null;
                setTimeout(() => {
                    isDraggingRef.current = false;
                }, 150);
            }
        };

        window.addEventListener('pointermove', onWindowPointerMove);
        window.addEventListener('pointerup', onWindowPointerUp);
        return () => {
            window.removeEventListener('pointermove', onWindowPointerMove);
            window.removeEventListener('pointerup', onWindowPointerUp);
        };
    }, [pxPerSec, rowHeight, snapTime, trackIndex, clipIndex, onUpdateNote, onPreviewNote]);

    // ノートドラッグ開始
    const handlePointerDownNote = (
        e: React.PointerEvent,
        noteIndex: number,
        type: 'move' | 'resize-start' | 'resize-end'
    ) => {
        e.stopPropagation();
        isDraggingRef.current = true;
        const n = localNotes[noteIndex];

        // 複数選択に含まれている場合は全選択ノートのスナップショットを作成
        let activeIndices = selectedNoteIndices;
        if (selectedNoteIndices.indexOf(noteIndex) === -1) {
            if (!e.shiftKey) {
                activeIndices = [noteIndex];
                setSelectedNoteIndices([noteIndex]);
            } else {
                activeIndices = [...selectedNoteIndices, noteIndex];
                setSelectedNoteIndices(activeIndices);
            }
        }
        setSelectedNoteIdx(noteIndex);

        const snapshots = activeIndices.map((idx) => {
            const item = localNotes[idx] || n;
            return {
                index: idx,
                origStart: item.start,
                origEnd: item.end,
                origMidi: item.midi,
                origVel: item.velocity ?? 0.8,
            };
        });

        dragRef.current = {
            type,
            noteIndex,
            startX: e.clientX,
            startY: e.clientY,
            origStart: n.start,
            origEnd: n.end,
            origMidi: n.midi,
            origVel: n.velocity ?? 0.8,
            currentVel: n.velocity ?? 0.8,
            selectedSnapshots: snapshots,
        };

        if (type === 'move' && onPreviewNote) {
            onPreviewNote(n.midi, n.velocity ?? 0.8);
        }
    };

    // ベロシティレーン全体のクリック＆ドラッグ
    const handleVelocityLanePointerDown = (e: React.PointerEvent) => {
        if (!velocityLaneInnerRef.current) return;
        const rect = velocityLaneInnerRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left + velocityLaneInnerRef.current.scrollLeft;
        const clickTime = clickX / pxPerSec;

        // クリック位置に最も近いノートを探索
        let closestIdx = -1;
        let minDiff = Infinity;
        localNotes.forEach((n, idx) => {
            const diff = Math.abs(n.start - clickTime);
            if (diff < minDiff && diff < 0.8) {
                minDiff = diff;
                closestIdx = idx;
            }
        });

        if (closestIdx !== -1) {
            isDraggingRef.current = true;
            const n = localNotes[closestIdx];
            const relY = Math.max(0, Math.min(VELOCITY_LANE_HEIGHT - 12, e.clientY - rect.top));
            const newVel = Math.min(1.0, Math.max(0.05, (VELOCITY_LANE_HEIGHT - 12 - relY) / (VELOCITY_LANE_HEIGHT - 24)));

            let activeIndices = selectedNoteIndices;
            if (selectedNoteIndices.indexOf(closestIdx) === -1) {
                activeIndices = [closestIdx];
                setSelectedNoteIndices([closestIdx]);
            }
            setSelectedNoteIdx(closestIdx);

            const snapshots = activeIndices.map((idx) => {
                const item = localNotes[idx] || n;
                return {
                    index: idx,
                    origStart: item.start,
                    origEnd: item.end,
                    origMidi: item.midi,
                    origVel: item.velocity ?? 0.8,
                };
            });

            setLocalNotes((prev) => {
                const next = [...prev];
                snapshots.forEach((snap) => {
                    if (next[snap.index]) {
                        next[snap.index] = { ...next[snap.index], velocity: newVel };
                    }
                });
                localNotesRef.current = next;
                return next;
            });

            dragRef.current = {
                type: 'velocity',
                noteIndex: closestIdx,
                startX: e.clientX,
                startY: e.clientY,
                origStart: n.start,
                origEnd: n.end,
                origMidi: n.midi,
                origVel: newVel,
                currentVel: newVel,
                selectedSnapshots: snapshots,
            };

            if (onPreviewNote) onPreviewNote(n.midi, newVel);
        }
    };

    // 🎹 グリッド余白でのマーキー範囲選択（一括選択）
    const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        // ノート上のクリックでなければ範囲選択開始
        if ((e.target as HTMLElement).dataset?.noteItem) return;
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch (_) { }

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        marqueeRef.current = { x1: x, y1: y, x2: x, y2: y };
        setMarquee({ x1: x, y1: y, x2: x, y2: y });

        if (!e.shiftKey) {
            setSelectedNoteIndices([]);
            setSelectedNoteIdx(null);
        }
    };

    const handleGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const cur = marqueeRef.current;
        if (!cur) return;

        // 🚀 画面端でのオートスクロール（Edge Auto-Scrolling）
        if (scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const scrollRect = container.getBoundingClientRect();
            const edgeMargin = 40;
            const scrollSpeed = 16;

            if (e.clientX > scrollRect.right - edgeMargin) container.scrollLeft += scrollSpeed;
            else if (e.clientX < scrollRect.left + 84 + edgeMargin) container.scrollLeft = Math.max(0, container.scrollLeft - scrollSpeed);

            if (e.clientY > scrollRect.bottom - edgeMargin) container.scrollTop += scrollSpeed;
            else if (e.clientY < scrollRect.top + edgeMargin) container.scrollTop = Math.max(0, container.scrollTop - scrollSpeed);
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const next = { x1: cur.x1, y1: cur.y1, x2: x, y2: y };
        marqueeRef.current = next;
        setMarquee(next);

        // 枠内に入ったノートをリアルタイム判定
        const minX = Math.min(next.x1, next.x2);
        const maxX = Math.max(next.x1, next.x2);
        const minY = Math.min(next.y1, next.y2);
        const maxY = Math.max(next.y1, next.y2);

        const matchedIndices: number[] = [];
        localNotes.forEach((n, idx) => {
            const noteLeft = n.start * pxPerSec;
            const noteRight = n.end * pxPerSec;
            const keyIndex = MAX_MIDI - n.midi;
            const noteTop = keyIndex * rowHeight;
            const noteBottom = noteTop + rowHeight;

            // 矩形の衝突判定（AABB）
            if (noteRight >= minX && noteLeft <= maxX && noteBottom >= minY && noteTop <= maxY) {
                matchedIndices.push(idx);
            }
        });

        setSelectedNoteIndices(matchedIndices);
        setSelectedNoteIdx(matchedIndices.length > 0 ? matchedIndices[0] : null);
    };

    const handleGridPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch (_) { }
        marqueeRef.current = null;
        setMarquee(null);
    };

    // グリッド空白ダブルクリックで新規ノート追加
    const handleGridDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        const midi = MAX_MIDI - Math.floor(clickY / rowHeight);
        const startTime = snapTime(clickX / pxPerSec);
        const endTime = startTime + (snapGrid > 0 ? snapGrid * 2 : 0.25);

        onAddNote(trackIndex, clipIndex, midi, startTime, endTime, 0.8);
        if (onPreviewNote) onPreviewNote(midi, 0.8);
    };

    // ノートダブルクリックでの削除（設定で ON の時のみ有効化して誤操作を完全防止）
    const handleNoteDoubleClick = (e: React.MouseEvent, noteIndex: number) => {
        e.stopPropagation();
        if (allowDblClickDelete) {
            onDeleteNote(trackIndex, clipIndex, noteIndex);
            setSelectedNoteIdx(null);
            setSelectedNoteIndices((prev) => prev.filter((i) => i !== noteIndex));
        }
    };

    // ルーラーの小節ステップ計算（ズームアウト時は小節番号を間引いて表示）
    const measurePx = 2.0 * pxPerSec; // 1小節（2秒）あたりのピクセル幅
    let measureStep = 1;
    if (measurePx < 8) measureStep = 16;
    else if (measurePx < 18) measureStep = 8;
    else if (measurePx < 40) measureStep = 4;
    else if (measurePx < 80) measureStep = 2;

    const totalMeasures = Math.ceil(maxTime / 2.0);

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9000,
                background: 'rgba(10, 13, 18, 0.96)',
                backdropFilter: 'blur(12px)',
                display: 'flex',
                flexDirection: 'column',
                animation: 'fadeIn 0.15s ease-out',
                userSelect: 'none',
            }}
        >
            {/* 上部ヘッダー・ツールバー */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 16px',
                    background: '#121620',
                    borderBottom: '1px solid #283344',
                    flexShrink: 0,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 900, color: '#70a1ff', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <IconPiano size={15} color="#70a1ff" />
                            <span>PIANO ROLL</span>
                        </span>
                        <span style={{ fontSize: 11, background: '#1c2434', color: '#c8d6e5', padding: '2px 8px', borderRadius: 4, border: '1px solid #33445c' }}>
                            {track.name || `Track ${trackIndex + 1}`} / クリップ {clipIndex + 1}
                        </span>
                        <span style={{ fontSize: 11, color: '#747d8c' }}>
                            ノート: <strong style={{ color: '#2ed573' }}>{localNotes.length}</strong> 個（ダブルクリックで削除）
                        </span>
                    </div>

                    {/* スナップ ON/OFF 切替 ＆ グリッド設定 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
                        {/* 🎛️ スナップ ON/OFF トグルボタン（スクショの青色アクティブボタン） */}
                        <button
                            onClick={() => setSnapEnabled(!snapEnabled)}
                            style={{
                                background: snapEnabled ? '#3b82f6' : '#1e2430',
                                color: snapEnabled ? '#ffffff' : '#8898aa',
                                border: snapEnabled ? '1px solid #60a5fa' : '1px solid #2d3748',
                                borderRadius: 4,
                                padding: '4px 8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                cursor: 'pointer',
                                boxShadow: snapEnabled ? '0 0 10px rgba(59, 130, 246, 0.6)' : 'none',
                                transition: 'all 0.15s ease',
                            }}
                            title={`スナップ（グリッド吸着）: ${snapEnabled ? 'ON (グリッドに吸着)' : 'OFF (完全フリー・滑らか移動)'} - Shiftキー押しながらでも一時的にフリードラッグ可能`}
                        >
                            <IconFollowPlayhead size={13} color={snapEnabled ? '#ffffff' : '#8898aa'} />
                            <span style={{ fontSize: 10, fontWeight: 900 }}>スナップ {snapEnabled ? 'ON' : 'OFF'}</span>
                        </button>

                        {/* グリッド刻み（1/16, 1/8, 1/4） */}
                        {snapEnabled && [
                            { label: '1/16', val: 0.125 },
                            { label: '1/8', val: 0.25 },
                            { label: '1/4', val: 0.5 },
                        ].map((s) => (
                            <button
                                key={s.label}
                                onClick={() => setSnapGrid(s.val)}
                                style={{
                                    background: snapGrid === s.val ? '#4d7cff' : '#1e2430',
                                    color: snapGrid === s.val ? '#ffffff' : '#8898aa',
                                    border: 'none',
                                    borderRadius: 3,
                                    padding: '3px 8px',
                                    fontSize: 10,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                }}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>

                    {/* 横ズーム（時間軸 5〜3000px/s） */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
                        <span style={{ fontSize: 10, color: '#8898aa', fontWeight: 700 }}>時間ズーム:</span>
                        <input
                            type="range"
                            min="5"
                            max="1000"
                            step="5"
                            value={pxPerSec}
                            onChange={(e) => changePxPerSec(Number(e.target.value))}
                            style={{ width: 70, accentColor: '#4d7cff' }}
                            title={`横ズーム: ${pxPerSec}px/秒 (ルーラー上のコロコロでもズーム可能)`}
                        />
                    </div>

                    {/* 縦ズーム（鍵盤高さ 4〜60px） */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 10 }}>
                        <span style={{ fontSize: 10, color: '#8898aa', fontWeight: 700 }}>音高ズーム:</span>
                        <input
                            type="range"
                            min="4"
                            max="50"
                            step="1"
                            value={rowHeight}
                            onChange={(e) => changeRowHeight(Number(e.target.value))}
                            style={{ width: 70, accentColor: '#2ed573' }}
                            title={`音高ズーム: ${rowHeight}px/半音 (鍵盤上のコロコロでもズーム可能)`}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* 🛡️ ダブルクリック削除の誤操作防止トグル */}
                    <button
                        onClick={() => setAllowDblClickDelete(!allowDblClickDelete)}
                        style={{
                            background: allowDblClickDelete ? '#3b1c20' : '#1e2430',
                            color: allowDblClickDelete ? '#ff6b81' : '#8898aa',
                            border: allowDblClickDelete ? '1px solid rgba(255, 71, 87, 0.4)' : '1px solid #2d3748',
                            borderRadius: 4,
                            padding: '4px 8px',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                        }}
                        title={`ダブルクリックで削除: ${allowDblClickDelete ? 'ON (ダブルクリックで即削除)' : 'OFF (誤操作防止中・Deleteキーまたは削除ボタンでのみ削除)'}`}
                    >
                        <span style={{ fontSize: 9, opacity: 0.8 }}>ダブルクリック削除:</span>
                        <strong style={{ color: allowDblClickDelete ? '#ff4757' : '#2ed573' }}>
                            {allowDblClickDelete ? 'ON' : 'OFF (保護中)'}
                        </strong>
                    </button>

                    {/* 🗑️ ノート一括削除ボタン */}
                    {(selectedNoteIndices.length > 0 || selectedNoteIdx !== null) && (
                        <button
                            onClick={() => {
                                if (selectedNoteIndices.length > 0) {
                                    const sortedIndices = [...selectedNoteIndices].sort((a, b) => b - a);
                                    sortedIndices.forEach((idx) => onDeleteNote(trackIndex, clipIndex, idx));
                                    setSelectedNoteIndices([]);
                                    setSelectedNoteIdx(null);
                                } else if (selectedNoteIdx !== null) {
                                    onDeleteNote(trackIndex, clipIndex, selectedNoteIdx);
                                    setSelectedNoteIdx(null);
                                }
                            }}
                            style={{
                                background: '#3b1c20',
                                color: '#ff6b81',
                                border: '1px solid rgba(255, 71, 87, 0.4)',
                                borderRadius: 4,
                                padding: '4px 10px',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                            }}
                            title="選択中のノートを削除 (Deleteキー)"
                        >
                            <IconTrash size={12} color="#ff6b81" />
                            <span>
                                {selectedNoteIndices.length > 1
                                    ? `${selectedNoteIndices.length} 個削除 (Del)`
                                    : 'ノート削除 (Del)'}
                            </span>
                        </button>
                    )}

                    <button
                        onClick={onClose}
                        style={{
                            background: '#2f3542',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 4,
                            width: 28,
                            height: 28,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        title="ピアノロールを閉じる"
                    >
                        <IconClose size={13} color="#fff" />
                    </button>
                </div>
            </div>

            {/* ⏱️ 上部タイムラインルーラー（コロコロホイール＆ドラッグズーム対応） */}
            <div
                style={{
                    height: RULER_HEIGHT,
                    background: '#161b26',
                    borderBottom: '1px solid #283344',
                    display: 'flex',
                    position: 'relative',
                    flexShrink: 0,
                }}
            >
                <div style={{ width: 84, flexShrink: 0, borderRight: '1px solid #283344', background: '#121620', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#70a1ff' }}>
                    BAR
                </div>

                <div
                    ref={rulerInnerRef}
                    onWheel={handleRulerWheel}
                    onPointerDown={handleRulerPointerDown}
                    onPointerMove={handleRulerPointerMove}
                    onPointerUp={handleRulerPointerUp}
                    style={{
                        flex: 1,
                        position: 'relative',
                        overflowX: 'hidden',
                        height: '100%',
                        cursor: 'ew-resize',
                    }}
                    title="ルーラー上でマウスホイール（コロコロ）または上下ドラッグで時間ズーム"
                >
                    <div
                        style={{
                            width: gridWidth,
                            height: '100%',
                            position: 'relative',
                        }}
                    >
                        {Array.from({ length: totalMeasures + 4 }).map((_, mi) => {
                            const measureNum = mi + 1;
                            const isVisibleStep = mi % measureStep === 0;
                            const left = mi * 2.0 * pxPerSec;

                            if (!isVisibleStep && measurePx < 30) return null;

                            return (
                                <React.Fragment key={mi}>
                                    {/* 小節番号 */}
                                    {isVisibleStep && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                left: left + 3,
                                                top: 4,
                                                fontSize: 10,
                                                fontWeight: 900,
                                                color: '#c8d6e5',
                                                pointerEvents: 'none',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {measureNum}
                                        </div>
                                    )}

                                    {/* 小節線 */}
                                    <div
                                        style={{
                                            position: 'absolute',
                                            left: left,
                                            bottom: 0,
                                            height: isVisibleStep ? 14 : 8,
                                            width: 1.5,
                                            background: isVisibleStep ? '#70a1ff' : 'rgba(255,255,255,0.2)',
                                            pointerEvents: 'none',
                                        }}
                                    />

                                    {/* 拍目盛り（十分なズーム時のみ） */}
                                    {measurePx >= 80 && [1, 2, 3].map((beat) => (
                                        <div
                                            key={beat}
                                            style={{
                                                position: 'absolute',
                                                left: left + (beat * 0.5) * pxPerSec,
                                                bottom: 0,
                                                height: 6,
                                                width: 1,
                                                background: 'rgba(255,255,255,0.2)',
                                                pointerEvents: 'none',
                                            }}
                                        />
                                    ))}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* メインピアノロール（左側キーボード ＋ 右側グリッド） */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                {/* スクロール連動コンテナ */}
                <div
                    ref={scrollContainerRef}
                    onWheel={handleGridWheel}
                    onScroll={(e) => {
                        if (rulerInnerRef.current) {
                            rulerInnerRef.current.scrollLeft = e.currentTarget.scrollLeft;
                        }
                        if (velocityLaneInnerRef.current) {
                            velocityLaneInnerRef.current.scrollLeft = e.currentTarget.scrollLeft;
                        }
                    }}
                    style={{
                        flex: 1,
                        display: 'flex',
                        overflow: 'auto',
                        background: '#0d1017',
                        position: 'relative',
                    }}
                >
                    {/* 左側：美しいリアルピアノ鍵盤エリア（固定幅 84px、sticky） */}
                    <div
                        onWheel={handleKeyboardWheel}
                        style={{
                            width: 84,
                            height: gridHeight,
                            flexShrink: 0,
                            position: 'sticky',
                            left: 0,
                            zIndex: 20,
                            background: '#151922',
                            boxShadow: '3px 0 10px rgba(0,0,0,0.6)',
                            display: 'flex',
                            flexDirection: 'column',
                            cursor: 'ns-resize',
                        }}
                        title="鍵盤の上でマウスホイール（コロコロ）で音高ズーム"
                    >
                        {Array.from({ length: TOTAL_KEYS }).map((_, i) => {
                            const midi = MAX_MIDI - i;
                            const isBlack = isBlackKey(midi);
                            const isC = midi % 12 === 0;
                            const name = noteName(midi);
                            return (
                                <div
                                    key={midi}
                                    onPointerDown={() => onPreviewNote && onPreviewNote(midi, 0.8)}
                                    style={{
                                        height: rowHeight,
                                        flexShrink: 0,
                                        background: isBlack
                                            ? 'linear-gradient(to right, #151921 0%, #222938 75%, #0d1117 100%)'
                                            : isC
                                            ? 'linear-gradient(to right, #e8f0fe 0%, #ffffff 80%, #cbd5e1 100%)'
                                            : 'linear-gradient(to right, #f8f9fa 0%, #ffffff 80%, #e2e8f0 100%)',
                                        color: isBlack ? '#70a1ff' : isC ? '#0d1117' : '#334155',
                                        borderBottom: isC
                                            ? '2px solid #70a1ff'
                                            : rowHeight > 8
                                            ? '1px solid rgba(0,0,0,0.15)'
                                            : 'none',
                                        borderRight: isBlack ? '5px solid #080b10' : '1px solid #94a3b8',
                                        boxShadow: isBlack ? 'inset 0 1px 1px rgba(255,255,255,0.1)' : 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: isC ? 'space-between' : 'flex-end',
                                        padding: '0 6px',
                                        fontSize: Math.max(7, Math.min(11, rowHeight - 6)),
                                        fontWeight: isC ? 900 : 700,
                                        cursor: 'pointer',
                                        userSelect: 'none',
                                        boxSizing: 'border-box',
                                    }}
                                    title={`${name} (MIDI: ${midi})`}
                                >
                                    {isC ? (
                                        <>
                                            <span style={{ color: '#000000', fontWeight: 900, fontSize: Math.max(8, Math.min(12, rowHeight - 4)) }}>{name}</span>
                                            {rowHeight >= 14 && <span style={{ opacity: 0.4 }}>{name}</span>}
                                        </>
                                    ) : (
                                        <span>{rowHeight >= 12 ? name : ''}</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* 右側：ノートグリッドエリア */}
                    <div
                        onPointerDown={handleGridPointerDown}
                        onPointerMove={handleGridPointerMove}
                        onPointerUp={handleGridPointerUp}
                        onDoubleClick={handleGridDoubleClick}
                        style={{
                            width: gridWidth,
                            height: gridHeight,
                            position: 'relative',
                            background: '#0e1118',
                            flexShrink: 0,
                            cursor: 'crosshair',
                        }}
                    >
                        {/* 🎹 マーキー範囲選択ボックス */}
                        {marquee && (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: Math.min(marquee.x1, marquee.x2),
                                    top: Math.min(marquee.y1, marquee.y2),
                                    width: Math.abs(marquee.x2 - marquee.x1),
                                    height: Math.abs(marquee.y2 - marquee.y1),
                                    background: 'rgba(77, 124, 255, 0.22)',
                                    border: '1px solid #70a1ff',
                                    borderRadius: 3,
                                    boxShadow: '0 0 14px rgba(112, 161, 255, 0.4)',
                                    pointerEvents: 'none',
                                    zIndex: 50,
                                }}
                            />
                        )}

                        {/* グリッド背景行（白鍵/黒鍵でトーン分け ＋ オクターブC境界強調） */}
                        {Array.from({ length: TOTAL_KEYS }).map((_, i) => {
                            const midi = MAX_MIDI - i;
                            const isBlack = isBlackKey(midi);
                            const isC = midi % 12 === 0;
                            return (
                                <div
                                    key={midi}
                                    style={{
                                        position: 'absolute',
                                        top: i * rowHeight,
                                        left: 0,
                                        right: 0,
                                        height: rowHeight,
                                        background: isC
                                            ? 'rgba(112, 161, 255, 0.09)'
                                            : isBlack
                                            ? '#0c0f16'
                                            : '#121620',
                                        borderBottom: isC
                                            ? '2px solid rgba(112, 161, 255, 0.4)'
                                            : rowHeight > 8
                                            ? '1px solid #1a202c'
                                            : 'none',
                                        pointerEvents: 'none',
                                        boxSizing: 'border-box',
                                    }}
                                />
                            );
                        })}

                        {/* 縦のグリッド線（小節線・拍線） */}
                        {Array.from({ length: totalMeasures + 4 }).map((_, mi) => {
                            const left = mi * 2.0 * pxPerSec;
                            const isVisibleStep = mi % measureStep === 0;
                            return (
                                <React.Fragment key={mi}>
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            bottom: 0,
                                            left,
                                            width: isVisibleStep ? 1.5 : 1,
                                            background: isVisibleStep ? 'rgba(112, 161, 255, 0.35)' : 'rgba(255,255,255,0.06)',
                                            pointerEvents: 'none',
                                        }}
                                    />
                                    {measurePx >= 80 && [1, 2, 3].map((b) => (
                                        <div
                                            key={b}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                bottom: 0,
                                                left: left + (b * 0.5) * pxPerSec,
                                                width: 1,
                                                background: 'rgba(255,255,255,0.03)',
                                                pointerEvents: 'none',
                                            }}
                                        />
                                    ))}
                                </React.Fragment>
                            );
                        })}

                        {/* 🎵 MIDI ノート */}
                        {localNotes.map((n, ni) => {
                            const isSel = selectedNoteIndices.indexOf(ni) !== -1 || selectedNoteIdx === ni;
                            const keyIndex = MAX_MIDI - n.midi;
                            const top = keyIndex * rowHeight + 1;
                            const left = n.start * pxPerSec;
                            const width = Math.max(3, (n.end - n.start) * pxPerSec);

                            if (n.midi < MIN_MIDI || n.midi > MAX_MIDI) return null;

                            return (
                                <div
                                    key={ni}
                                    data-note-item="true"
                                    onPointerDown={(e) => handlePointerDownNote(e, ni, 'move')}
                                    onDoubleClick={(e) => handleNoteDoubleClick(e, ni)}
                                    style={{
                                        position: 'absolute',
                                        top,
                                        left,
                                        width,
                                        height: Math.max(3, rowHeight - 2),
                                        background: isSel
                                            ? 'linear-gradient(135deg, #70a1ff 0%, #3742fa 100%)'
                                            : 'linear-gradient(135deg, #3867d6 0%, #2d98da 100%)',
                                        border: isSel ? '2px solid #ffffff' : rowHeight > 8 ? '1px solid #70a1ff' : 'none',
                                        borderRadius: rowHeight > 8 ? 3 : 1,
                                        boxShadow: isSel
                                            ? '0 0 14px rgba(112, 161, 255, 0.95)'
                                            : '0 2px 6px rgba(0,0,0,0.5)',
                                        zIndex: isSel ? 10 : 5,
                                        cursor: 'grab',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: rowHeight > 12 ? '0 4px' : 0,
                                        boxSizing: 'border-box',
                                        overflow: 'hidden',
                                        userSelect: 'none',
                                    }}
                                    title={`${noteName(n.midi)} (${n.start.toFixed(2)}s〜${n.end.toFixed(2)}s) / ベロシティ: ${Math.round((n.velocity ?? 0.8) * 100)}% （ダブルクリックで削除）`}
                                >
                                    {/* 🎛️ HUD フローティング情報バッジ [ P: G5 ] [ S: 2.1 ] */}
                                    {isSel && rowHeight >= 8 && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                bottom: '100%',
                                                left: 0,
                                                marginBottom: 4,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                background: 'rgba(20, 24, 34, 0.95)',
                                                border: '1px solid #4a5568',
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
                                                borderRadius: 5,
                                                padding: '2px 6px',
                                                fontSize: 10,
                                                fontWeight: 800,
                                                color: '#eee',
                                                zIndex: 30,
                                                pointerEvents: 'none',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            <span style={{ color: '#8898aa', fontSize: 9 }}>P:</span>
                                            <span style={{ background: '#11151e', border: '1px solid #2d3748', borderRadius: 3, padding: '0 4px', color: '#70a1ff' }}>
                                                {noteName(n.midi)}
                                            </span>
                                            <span style={{ color: '#8898aa', fontSize: 9, marginLeft: 2 }}>S:</span>
                                            <span style={{ background: '#11151e', border: '1px solid #2d3748', borderRadius: 3, padding: '0 4px', color: '#2ed573' }}>
                                                {Math.floor(n.start / 2) + 1}.{Math.floor(((n.start % 2) / 0.5)) + 1}
                                            </span>
                                        </div>
                                    )}

                                    {/* 左端リサイズハンドル */}
                                    {rowHeight >= 10 && width >= 14 && (
                                        <div
                                            onPointerDown={(e) => handlePointerDownNote(e, ni, 'resize-start')}
                                            style={{
                                                position: 'absolute',
                                                left: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: 5,
                                                cursor: 'ew-resize',
                                                background: 'rgba(255,255,255,0.25)',
                                                zIndex: 2,
                                            }}
                                            title="音の開始位置・長さを変更（左端ドラッグ）"
                                        />
                                    )}

                                    {width >= 24 && rowHeight >= 14 && (
                                        <span style={{ fontSize: Math.max(8, rowHeight - 13), fontWeight: 900, color: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,0.8)', paddingLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {noteName(n.midi)}
                                        </span>
                                    )}

                                    {/* 右端リサイズハンドル */}
                                    {rowHeight >= 10 && width >= 14 && (
                                        <div
                                            onPointerDown={(e) => handlePointerDownNote(e, ni, 'resize-end')}
                                            style={{
                                                position: 'absolute',
                                                right: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: 5,
                                                cursor: 'ew-resize',
                                                background: 'rgba(255,255,255,0.3)',
                                                zIndex: 2,
                                            }}
                                            title="音の終了位置・長さを変更（右端ドラッグ）"
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 下部：ベロシティ（Velocity）編集レーン */}
            <div
                style={{
                    height: VELOCITY_LANE_HEIGHT,
                    background: '#0a0d13',
                    borderTop: '1px solid #283344',
                    display: 'flex',
                    position: 'relative',
                    flexShrink: 0,
                }}
            >
                <div style={{ width: 84, padding: '6px 8px', borderRight: '1px solid #283344', fontSize: 10, fontWeight: 800, color: '#70a1ff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <span>VELOCITY</span>
                    <span style={{ fontSize: 8, color: '#8898aa' }}>100.00</span>
                    <span style={{ fontSize: 8, color: '#8898aa' }}>50.00</span>
                    <span style={{ fontSize: 8, color: '#8898aa' }}>0.00</span>
                </div>

                <div
                    ref={velocityLaneInnerRef}
                    onPointerDown={handleVelocityLanePointerDown}
                    style={{
                        flex: 1,
                        position: 'relative',
                        overflowX: 'hidden',
                        height: '100%',
                        cursor: 'ns-resize',
                    }}
                >
                    <div
                        style={{
                            width: gridWidth,
                            height: '100%',
                            position: 'relative',
                        }}
                    >
                        {/* 50% 基準線 */}
                        <div
                            style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                top: '50%',
                                height: 1,
                                background: 'rgba(255,255,255,0.06)',
                                pointerEvents: 'none',
                            }}
                        />

                        {localNotes.map((n, ni) => {
                            const isSel = selectedNoteIndices.indexOf(ni) !== -1 || selectedNoteIdx === ni;
                            const left = n.start * pxPerSec;
                            const vel = n.velocity ?? 0.8;
                            const barHeight = Math.max(6, vel * (VELOCITY_LANE_HEIGHT - 26));

                            return (
                                <div
                                    key={ni}
                                    onPointerDown={(e) => {
                                        e.stopPropagation();
                                        isDraggingRef.current = true;

                                        let activeIndices = selectedNoteIndices;
                                        if (selectedNoteIndices.indexOf(ni) === -1) {
                                            if (!e.shiftKey) {
                                                activeIndices = [ni];
                                                setSelectedNoteIndices([ni]);
                                            } else {
                                                activeIndices = [...selectedNoteIndices, ni];
                                                setSelectedNoteIndices(activeIndices);
                                            }
                                        }
                                        setSelectedNoteIdx(ni);

                                        const snapshots = activeIndices.map((idx) => {
                                            const item = localNotes[idx] || n;
                                            return {
                                                index: idx,
                                                origStart: item.start,
                                                origEnd: item.end,
                                                origMidi: item.midi,
                                                origVel: item.velocity ?? 0.8,
                                            };
                                        });

                                        dragRef.current = {
                                            type: 'velocity',
                                            noteIndex: ni,
                                            startX: e.clientX,
                                            startY: e.clientY,
                                            origStart: n.start,
                                            origEnd: n.end,
                                            origMidi: n.midi,
                                            origVel: vel,
                                            currentVel: vel,
                                            selectedSnapshots: snapshots,
                                        };
                                        if (onPreviewNote) onPreviewNote(n.midi, vel);
                                    }}
                                    style={{
                                        position: 'absolute',
                                        bottom: 4,
                                        left: isSel ? left : left + 1,
                                        width: isSel ? Math.max(10, Math.min(14, pxPerSec * 0.1)) : Math.max(3, Math.min(8, pxPerSec * 0.06)),
                                        height: barHeight,
                                        background: isSel
                                            ? 'linear-gradient(to top, #ff4757 0%, #ff9f43 100%)'
                                            : '#253346',
                                        borderRadius: '2px 2px 0 0',
                                        border: isSel ? '1px solid rgba(255,255,255,0.8)' : 'none',
                                        boxShadow: isSel ? '0 0 10px rgba(255, 71, 87, 0.7)' : 'none',
                                        zIndex: isSel ? 10 : 2,
                                        cursor: 'ns-resize',
                                    }}
                                    title={`${noteName(n.midi)}: ベロシティ ${Math.round(vel * 100)}%`}
                                >
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            right: 0,
                                            height: 3,
                                            background: isSel ? '#ffffff' : '#70a1ff',
                                            borderRadius: '2px 2px 0 0',
                                        }}
                                    />
                                    {/* 選択中のベロシティ数値バッジ */}
                                    {isSel && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                bottom: '100%',
                                                left: '50%',
                                                transform: 'translateX(-50%)',
                                                background: '#ff4757',
                                                color: '#ffffff',
                                                fontSize: 8,
                                                fontWeight: 900,
                                                padding: '1px 3px',
                                                borderRadius: 2,
                                                whiteSpace: 'nowrap',
                                                pointerEvents: 'none',
                                                marginBottom: 2,
                                            }}
                                        >
                                            {Math.round(vel * 100)}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
