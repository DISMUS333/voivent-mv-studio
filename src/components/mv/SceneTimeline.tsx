//==============================================================================
// MV シーン＆歌詞タイムライン（マルチトラック・ドラッグ編集 UI）。
// - 上段: 🎙 歌詞テキストレーン（字幕クリップの移動・伸縮）
// - 下段: 🎬 シーン背景レーン（シーンバーの移動・伸縮）
// - BPM 同期グリッドスナップ（1拍・1小節）
// - 再生ヘッド（プレイヘッド）表示
// - ロジックは mvSceneUtils の純粋関数へ委譲（単一責務・保守性重視）。
//==============================================================================
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { IconClose, IconFollowPlayhead, IconMagnet, IconMic, IconMinus, IconPlus, IconRedo, IconSparkles, IconTrash, IconUndo, IconVideo, IconWaveform } from '../Icons';
import type { LyricItem, MvImageAsset, MvScene, MvEffectClip } from './types';
import type { Analysis } from '../../types';
import { MvEffectsLane } from './effects/MvEffectsLane';
import {
    deleteScene,
    deleteScenes,
    gridSecondsFromBpm,
    LYRIC_DEFAULT_DURATION,
    moveLyricTimeSnapped,
    moveSceneTimeSnapped,
    resizeLyricSnapped,
    resizeLyricStartSnapped,
    resizeSceneSnapped,
    resizeSceneStartSnapped,
    splitSceneAtTime,
    sortLyrics,
    sortScenes,
} from './mvSceneUtils';

/** グリッド分解能 */
type GridMode = 'off' | 'beat' | 'bar';

interface SceneTimelineProps {
    scenes: MvScene[];
    lyrics?: LyricItem[];
    assets?: MvImageAsset[];
    effects?: MvEffectClip[];
    selectedEffectId?: string | null;
    onSelectEffect?: (id: string | null) => void;
    onUpdateEffects?: (effects: MvEffectClip[]) => void;
    onOpenEffectAssetLibrary?: () => void;
    totalDuration: number;
    bpm: number;
    selectedSceneId: string | null;
    selectedLyricId?: string | null;
    onSelectScene: (id: string | null) => void;
    onSelectLyric?: (id: string | null) => void;
    onUpdateScenes: (scenes: MvScene[]) => void;
    onUpdateLyrics?: (lyrics: LyricItem[]) => void;
    onUpdateAssets?: (assets: MvImageAsset[]) => void;
    /** 現在の再生位置（秒）。未指定時は再生ヘッド非表示 */
    playheadSec?: number | null;
    /** 再生中フラグ（再生ヘッド追従に使用） */
    isPlaying?: boolean;
    /** 再生位置シーク要求（ルーラー／レーンクリック時に発火） */
    onSeek?: (sec: number) => void;
    /** 再生/一時停止トグル（Space キー連動） */
    onTogglePlay?: () => void;
    /** 楽曲解析データ（波形ピーク描画用） */
    analysis?: Analysis | null;
    /** Undo コールバック */
    onUndo?: () => void;
    /** Redo コールバック */
    onRedo?: () => void;
    /** Undo 可能フラグ */
    canUndo?: boolean;
    /** Redo 可能フラグ */
    canRedo?: boolean;
}

interface DragState {
    target: 'scene' | 'lyric';
    kind: 'move' | 'resize-start' | 'resize-end';
    id: string;
    /** ドラッグ開始時のポインタ X 座標 */
    startX: number;
    /** ドラッグ開始時の startTime */
    origStart: number;
    /** ドラッグ開始時の endTime */
    origEnd: number;
    /** ドラッグ開始時の px→秒 変換レート */
    secPerPx: number;
}

const LYRIC_TRACK_HEIGHT = 24;
const WAVE_TRACK_HEIGHT = 24;
const SCENE_TRACK_HEIGHT = 28;
const RULER_HEIGHT = 16;
/** ズーム倍率の範囲（0.5 = 全体俯瞰、32 = 超拡大精密編集） */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 32;

const TimelineWaveform: React.FC<{
    peaks?: Array<[number, number]>;
    width: number;
    height: number;
    duration: number;
}> = memo(({ peaks, width, height, duration }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !peaks || peaks.length === 0 || duration <= 0) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);
        const midY = height / 2;
        const totalPeaks = peaks.length;

        // エメラルド〜シアンの高級インダストリアルグラデーション波形
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#38bdf8');
        grad.addColorStop(0.5, '#2ed573');
        grad.addColorStop(1, '#38bdf8');
        ctx.fillStyle = grad;

        // 1px ごとに正確なピーク範囲を集計描画（時間軸と完全 1:1 一致）
        for (let x = 0; x < width; x++) {
            const startRatio = x / width;
            const endRatio = (x + 1) / width;
            const startIdx = Math.floor(startRatio * totalPeaks);
            const endIdx = Math.min(totalPeaks - 1, Math.ceil(endRatio * totalPeaks));

            let maxAmp = 0.03;
            for (let i = startIdx; i <= endIdx && i < totalPeaks; i++) {
                const p = peaks[i];
                if (!p) continue;
                const amp = Math.max(Math.abs(p[0]), Math.abs(p[1]));
                if (amp > maxAmp) maxAmp = amp;
            }

            const barH = Math.max(1, maxAmp * (midY - 2));
            ctx.fillRect(x, midY - barH, 1, barH * 2);
        }
    }, [peaks, width, height, duration]);

    if (!peaks || peaks.length === 0) return null;
    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width,
                height,
                pointerEvents: 'none',
                zIndex: 1,
            }}
        />
    );
});

export const SceneTimeline: React.FC<SceneTimelineProps> = ({
    scenes,
    lyrics = [],
    assets = [],
    effects = [],
    selectedEffectId = null,
    onSelectEffect = () => {},
    onUpdateEffects = () => {},
    onOpenEffectAssetLibrary = () => {},
    totalDuration,
    bpm,
    selectedSceneId,
    selectedLyricId = null,
    onSelectScene,
    onSelectLyric,
    onUpdateScenes,
    onUpdateLyrics,
    onUpdateAssets,
    playheadSec = null,
    onSeek,
    onTogglePlay,
    analysis,
    isPlaying = false,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
}) => {
    const laneRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const [gridMode, setGridMode] = useState<GridMode>('off');
    const [dragging, setDragging] = useState(false);
    const [followPlayhead, setFollowPlayhead] = useState(true);
    const { t } = useI18n();

    // ── 📦 範囲選択（Marquee Selection）＆複数選択状態 ─────────────────────────
    const [selectedLyricIds, setSelectedLyricIds] = useState<Set<string>>(new Set());
    const [selectedEffectIds, setSelectedEffectIds] = useState<Set<string>>(new Set());
    const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set());
    const [marquee, setMarquee] = useState<{
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
    } | null>(null);

    const trackLyricsRef = useRef<HTMLDivElement | null>(null);
    const trackEffectsRef = useRef<HTMLDivElement | null>(null);
    const trackScenesRef = useRef<HTMLDivElement | null>(null);

    // 🗑️ 2段階削除確認 (ミスポチ防止)
    const [confirmDeleteSceneId, setConfirmDeleteSceneId] = useState<string | null>(null);
    const [confirmDeleteLyricId, setConfirmDeleteLyricId] = useState<string | null>(null);
    const confirmTimerRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
        };
    }, []);

    const effectsRef = useRef(effects);
    effectsRef.current = effects;

    // 🎹 キーボードショートカット（Space: 再生/一時停止, Delete/Backspace: 選択中クリップ・シーン一括削除）
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

            if (e.code === 'Space') {
                e.preventDefault();
                onTogglePlay?.();
            } else if (e.code === 'Delete' || e.code === 'Backspace') {
                let deletedCount = 0;

                // 🎬 シーン削除（最低1シーンは保護）
                const targetSceneIds = selectedSceneIds.size > 0
                    ? selectedSceneIds
                    : (selectedSceneId ? new Set([selectedSceneId]) : new Set<string>());
                if (targetSceneIds.size > 0 && scenesRef.current.length > 1) {
                    const updated = deleteScenes(scenesRef.current, targetSceneIds);
                    onUpdateScenes(updated);
                    setSelectedSceneIds(new Set());
                    onSelectScene(null);
                    deletedCount += targetSceneIds.size;
                }

                // 🎙 歌詞削除
                if (selectedLyricIds.size > 0 && onUpdateLyrics) {
                    onUpdateLyrics(lyricsRef.current.filter((l) => !selectedLyricIds.has(l.id || `ly_${l.time}`)));
                    setSelectedLyricIds(new Set());
                    deletedCount += selectedLyricIds.size;
                } else if (selectedLyricId && onUpdateLyrics) {
                    onUpdateLyrics(lyricsRef.current.filter((l) => (l.id || `ly_${l.time}`) !== selectedLyricId));
                    onSelectLyric?.(null);
                    deletedCount += 1;
                }

                // ✨ エフェクト削除
                if (selectedEffectIds.size > 0 && onUpdateEffects) {
                    onUpdateEffects(effectsRef.current.filter((fx) => !selectedEffectIds.has(fx.id)));
                    setSelectedEffectIds(new Set());
                    deletedCount += selectedEffectIds.size;
                } else if (selectedEffectId && onUpdateEffects) {
                    onUpdateEffects(effectsRef.current.filter((fx) => fx.id !== selectedEffectId));
                    onSelectEffect(null);
                    deletedCount += 1;
                }

                if (deletedCount > 0) {
                    e.preventDefault();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onTogglePlay, onUpdateLyrics, onUpdateEffects, onUpdateScenes, selectedLyricId, selectedEffectId, selectedSceneId, selectedLyricIds, selectedEffectIds, selectedSceneIds, onSelectLyric, onSelectEffect, onSelectScene]);

    const GRID_LABELS: Record<GridMode, string> = useMemo(() => ({
        off: t.snapOff,
        beat: t.snapBeat,
        bar: t.snapBar,
    }), [t]);

    const [zoom, setZoom] = useState(1);

    const baseWidthPx = Math.max(640, Math.min(1600, totalDuration * 26));
    const widthPx = Math.round(baseWidthPx * zoom);

    // 🚀 再生ヘッド自動追従（Follow Playhead）：デスクトップ完全準拠（再生中＆停止中シーク両対応）
    useEffect(() => {
        if (!followPlayhead || playheadSec == null || !timelineBodyRef.current) return;
        const container = timelineBodyRef.current;
        const headX = (playheadSec / Math.max(0.001, totalDuration)) * widthPx;
        const scrollLeft = container.scrollLeft;
        const visibleWidth = container.clientWidth;

        if (isPlaying) {
            if (headX > scrollLeft + visibleWidth * 0.8) {
                container.scrollLeft = headX - visibleWidth * 0.3;
            } else if (headX < scrollLeft) {
                container.scrollLeft = Math.max(0, headX - 50);
            }
        } else {
            // 停止中のシークで再生ヘッドが視野から外れている場合はスムーズに画面内へ
            if (headX < scrollLeft || headX > scrollLeft + visibleWidth) {
                container.scrollLeft = Math.max(0, headX - visibleWidth * 0.25);
            }
        }
    }, [isPlaying, followPlayhead, playheadSec, totalDuration, widthPx]);

    const gridSec = useMemo(() => {
        if (gridMode === 'off') return 0;
        return gridSecondsFromBpm(bpm, gridMode === 'bar' ? 4 : 1);
    }, [bpm, gridMode]);

    const sortedScenes = useMemo(() => sortScenes(scenes), [scenes]);
    const sortedLyrics = useMemo(() => sortLyrics(lyrics), [lyrics]);

    const scenesRef = useRef(scenes);
    scenesRef.current = scenes;
    const lyricsRef = useRef(lyrics);
    lyricsRef.current = lyrics;
    const gridSecRef = useRef(gridSec);
    gridSecRef.current = gridSec;

    const [isLyricDropOver, setIsLyricDropOver] = useState(false);
    const [lyricDropHoverTime, setLyricDropHoverTime] = useState<number | null>(null);
    const [isSceneDropOver, setIsSceneDropOver] = useState(false);
    const [sceneDropHoverTime, setSceneDropHoverTime] = useState<number | null>(null);

    const handleAddLyricAtTime = useCallback((timeSec: number) => {
        if (!onUpdateLyrics) return;
        const finalTime = Math.max(0, Math.min(totalDuration - 0.5, Number(timeSec.toFixed(2))));
        const newId = `ly_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newLyric: LyricItem = {
            id: newId,
            text: t.newLyricPhrase,
            time: finalTime,
            duration: 2.0,
        };
        const next = sortLyrics([...lyricsRef.current, newLyric]);
        onUpdateLyrics(next);
        onSelectLyric?.(newId);
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('voivent:focus-lyric', { detail: { id: newId } }));
        }, 50);
    }, [onUpdateLyrics, onSelectLyric, totalDuration]);

    const timeToX = useCallback((t: number) => (t / Math.max(0.001, totalDuration)) * widthPx, [totalDuration, widthPx]);

    // ---- ドラッグ制御 -------------------------------------------------------
    const endDrag = useCallback(() => {
        dragRef.current = null;
        setDragging(false);
        window.removeEventListener('pointermove', onPointerMoveRef.current!);
        window.removeEventListener('pointerup', onPointerUpRef.current!);
    }, []);

    const onPointerMoveRef = useRef<(e: PointerEvent) => void>(() => { });
    const onPointerUpRef = useRef<(e: PointerEvent) => void>(() => { });

    const beginSceneDrag = (
        e: React.PointerEvent,
        scene: MvScene,
        kind: 'move' | 'resize-start' | 'resize-end',
    ) => {
        if (!laneRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        onSelectScene(scene.id);
        onSelectLyric?.(null);

        const state: DragState = {
            target: 'scene',
            kind,
            id: scene.id,
            startX: e.clientX,
            origStart: scene.startTime,
            origEnd: scene.endTime,
            secPerPx: totalDuration / Math.max(1, widthPx),
        };
        dragRef.current = state;
        setDragging(true);

        const handleMove = (ev: PointerEvent) => {
            const st = dragRef.current;
            if (!st || st.target !== 'scene') return;
            const deltaSec = (ev.clientX - st.startX) * st.secPerPx;

            if (st.kind === 'move') {
                const next = moveSceneTimeSnapped(scenesRef.current, st.id, st.origStart + deltaSec, totalDuration, gridSecRef.current);
                onUpdateScenes(next);
            } else if (st.kind === 'resize-start') {
                const next = resizeSceneStartSnapped(scenesRef.current, st.id, st.origStart + deltaSec, gridSecRef.current);
                onUpdateScenes(next);
            } else {
                const next = resizeSceneSnapped(scenesRef.current, st.id, st.origEnd + deltaSec, gridSecRef.current);
                onUpdateScenes(next);
            }
        };

        onPointerMoveRef.current = handleMove;
        onPointerUpRef.current = endDrag;
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', endDrag);
    };

    const beginLyricDrag = (
        e: React.PointerEvent,
        lyric: LyricItem,
        kind: 'move' | 'resize-start' | 'resize-end',
    ) => {
        if (!laneRef.current || !onUpdateLyrics) return;
        const lyricId = lyric.id || `ly_${lyric.time}_${lyric.text}`;
        e.preventDefault();
        e.stopPropagation();
        onSelectLyric?.(lyricId);
        onSelectScene(null);

        const dur = lyric.duration ?? LYRIC_DEFAULT_DURATION;
        const state: DragState = {
            target: 'lyric',
            kind,
            id: lyricId,
            startX: e.clientX,
            origStart: lyric.time,
            origEnd: lyric.time + dur,
            secPerPx: totalDuration / Math.max(1, widthPx),
        };
        dragRef.current = state;
        setDragging(true);

        const handleMove = (ev: PointerEvent) => {
            const st = dragRef.current;
            if (!st || st.target !== 'lyric') return;
            const deltaSec = (ev.clientX - st.startX) * st.secPerPx;

            if (st.kind === 'move') {
                const next = moveLyricTimeSnapped(lyricsRef.current, st.id, st.origStart + deltaSec, totalDuration, gridSecRef.current);
                onUpdateLyrics(next);
            } else if (st.kind === 'resize-start') {
                const next = resizeLyricStartSnapped(lyricsRef.current, st.id, st.origStart + deltaSec, gridSecRef.current);
                onUpdateLyrics(next);
            } else {
                const next = resizeLyricSnapped(lyricsRef.current, st.id, st.origEnd + deltaSec, gridSecRef.current);
                onUpdateLyrics(next);
            }
        };

        const handleUp = (ev: PointerEvent) => {
            const st = dragRef.current;
            if (st && st.target === 'lyric') {
                const movedPx = Math.abs(ev.clientX - st.startX);
                if (movedPx < 4) {
                    // クリック時: 右ペインの該当フレーズ文字入力欄へフォーカス＆スクロール
                    window.dispatchEvent(new CustomEvent('voivent:focus-lyric', { detail: { id: lyric.id || `ly_${lyric.time}` } }));
                }
            }
            endDrag();
        };

        onPointerMoveRef.current = handleMove;
        onPointerUpRef.current = handleUp;
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
    };

    const handleLanePointerDown = (e: React.PointerEvent) => {
        if (!laneRef.current) return;

        // 中クリック (button 1): パン操作
        if (e.button === 1) {
            if (!timelineBodyRef.current) return;
            e.preventDefault();
            const startX = e.clientX;
            const startScrollLeft = timelineBodyRef.current.scrollLeft;
            const handlePanMove = (ev: PointerEvent) => {
                if (!timelineBodyRef.current) return;
                timelineBodyRef.current.scrollLeft = startScrollLeft - (ev.clientX - startX);
            };
            const handlePanUp = () => {
                window.removeEventListener('pointermove', handlePanMove);
                window.removeEventListener('pointerup', handlePanUp);
            };
            window.addEventListener('pointermove', handlePanMove);
            window.addEventListener('pointerup', handlePanUp);
            return;
        }

        // 左クリック (button 0): 範囲選択 (Marquee) またはクリックシーク
        if (e.button !== 0) return;
        e.preventDefault();

        const laneRect = laneRef.current.getBoundingClientRect();
        const startLocalX = e.clientX - laneRect.left;
        const startLocalY = e.clientY - laneRect.top;
        let hasMoved = false;

        const handleMarqueeMove = (ev: PointerEvent) => {
            if (!laneRef.current) return;
            const currentRect = laneRef.current.getBoundingClientRect();
            const curX = ev.clientX - currentRect.left;
            const curY = ev.clientY - currentRect.top;

            if (Math.abs(curX - startLocalX) > 4 || Math.abs(curY - startLocalY) > 4) {
                hasMoved = true;
                setMarquee({
                    startX: startLocalX,
                    startY: startLocalY,
                    currentX: curX,
                    currentY: curY,
                });

                const minX = Math.min(startLocalX, curX);
                const maxX = Math.max(startLocalX, curX);
                const selStartSec = (minX / Math.max(1, widthPx)) * totalDuration;
                const selEndSec = (maxX / Math.max(1, widthPx)) * totalDuration;

                const minClientY = Math.min(e.clientY, ev.clientY);
                const maxClientY = Math.max(e.clientY, ev.clientY);

                const newLyricIds = new Set<string>();
                if (trackLyricsRef.current) {
                    const r = trackLyricsRef.current.getBoundingClientRect();
                    const hitLyrics = minClientY <= r.bottom && maxClientY >= r.top;
                    if (hitLyrics) {
                        for (const l of lyricsRef.current) {
                            const dur = l.duration ?? LYRIC_DEFAULT_DURATION;
                            if (l.time < selEndSec && l.time + dur > selStartSec) {
                                newLyricIds.add(l.id || `ly_${l.time}`);
                            }
                        }
                    }
                }

                const newEffectIds = new Set<string>();
                if (trackEffectsRef.current) {
                    const r = trackEffectsRef.current.getBoundingClientRect();
                    const hitEffects = minClientY <= r.bottom && maxClientY >= r.top;
                    if (hitEffects) {
                        for (const fx of (effectsRef.current ?? [])) {
                            if (fx.startTime < selEndSec && fx.endTime > selStartSec) {
                                newEffectIds.add(fx.id);
                            }
                        }
                    }
                }

                const newSceneIds = new Set<string>();
                if (trackScenesRef.current) {
                    const r = trackScenesRef.current.getBoundingClientRect();
                    const hitScenes = minClientY <= r.bottom && maxClientY >= r.top;
                    if (hitScenes) {
                        for (const s of scenesRef.current) {
                            if (s.startTime < selEndSec && s.endTime > selStartSec) {
                                newSceneIds.add(s.id);
                            }
                        }
                    }
                }

                setSelectedLyricIds(newLyricIds);
                setSelectedEffectIds(newEffectIds);
                setSelectedSceneIds(newSceneIds);
            }
        };

        const handleMarqueeUp = (ev: PointerEvent) => {
            window.removeEventListener('pointermove', handleMarqueeMove);
            window.removeEventListener('pointerup', handleMarqueeUp);
            setMarquee(null);

            if (!hasMoved) {
                // 単体クリック: 選択解除 & シーク
                setSelectedLyricIds(new Set());
                setSelectedEffectIds(new Set());
                setSelectedSceneIds(new Set());
                onSelectScene(null);
                onSelectLyric?.(null);
                onSelectEffect(null);
                seekFromClientX(ev.clientX);
            }
        };

        window.addEventListener('pointermove', handleMarqueeMove);
        window.addEventListener('pointerup', handleMarqueeUp);
    };

    const seekFromClientX = (clientX: number) => {
        if (!laneRef.current || !onSeek) return;
        const rect = laneRef.current.getBoundingClientRect();
        const ratio = (clientX - rect.left) / Math.max(1, rect.width);
        const sec = Math.max(0, Math.min(totalDuration, ratio * totalDuration));
        onSeek(sec);
    };

    // ---- アセットドラッグ＆ドロップ（素材ライブラリ・外部画像ドロップ） -----
    const [isDragOver, setIsDragOver] = useState(false);
    const [dragOverSec, setDragOverSec] = useState<number | null>(null);

    const timeFromClientX = useCallback((clientX: number) => {
        if (!laneRef.current) return 0;
        const rect = laneRef.current.getBoundingClientRect();
        const ratio = (clientX - rect.left) / Math.max(1, rect.width);
        const sec = Math.max(0, Math.min(totalDuration, ratio * totalDuration));
        if (gridSecRef.current > 0) {
            return Math.round(sec / gridSecRef.current) * gridSecRef.current;
        }
        return Number(sec.toFixed(2));
    }, [totalDuration]);

    const applyAssetAtTime = useCallback((asset: MvImageAsset, dropSec: number) => {
        const curScenes = scenesRef.current;
        const splitRes = splitSceneAtTime(curScenes, dropSec, { backgroundImageId: asset.id, name: asset.name });
        if (splitRes.newSceneId) {
            onUpdateScenes(splitRes.scenes);
            onSelectScene(splitRes.newSceneId);
            if (!isPlaying) onSeek?.(dropSec);
        } else {
            // シーンの端（先頭/末尾0.2秒付近）の場合は該当シーンの背景画像を差し替え
            const targetIdx = curScenes.findIndex((s) => dropSec >= s.startTime && dropSec <= s.endTime);
            if (targetIdx !== -1) {
                const next = [...curScenes];
                next[targetIdx] = { ...next[targetIdx], backgroundImageId: asset.id };
                onUpdateScenes(next);
                onSelectScene(next[targetIdx].id);
                if (!isPlaying) onSeek?.(dropSec);
            } else {
                // シーン外（もしあれば）は新規シーン作成
                const newSceneId = `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
                const newScene: MvScene = {
                    id: newSceneId,
                    name: asset.name,
                    startTime: dropSec,
                    endTime: Math.min(totalDuration, dropSec + 4),
                    backgroundImageId: asset.id,
                };
                onUpdateScenes(sortScenes([...curScenes, newScene]));
                onSelectScene(newSceneId);
                if (!isPlaying) onSeek?.(dropSec);
            }
        }
    }, [isPlaying, onSeek, onSelectScene, onUpdateScenes, totalDuration]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
        const sec = timeFromClientX(e.clientX);
        setDragOverSec(sec);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
            setDragOverSec(null);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        setDragOverSec(null);

        const dropSec = timeFromClientX(e.clientX);

        // 1. アプリ内素材ライブラリからのドロップ (JSON)
        const rawJson = e.dataTransfer.getData('application/json');
        if (rawJson) {
            try {
                const data = JSON.parse(rawJson);
                if (data.type === 'mv-asset' && data.asset) {
                    applyAssetAtTime(data.asset, dropSec);
                    return;
                }
            } catch {
                // ignore
            }
        }

        // 2. アセットIDからのドロップ (text/plain)
        const plainId = e.dataTransfer.getData('text/plain');
        if (plainId && assets) {
            const found = assets.find((a) => a.id === plainId);
            if (found) {
                applyAssetAtTime(found, dropSec);
                return;
            }
        }

        // 3. 外部画像ファイルの直接ドロップ
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
        if (files.length > 0) {
            const file = files[0];
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                const newAsset: MvImageAsset = {
                    id: `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    dataUrl,
                    addedAt: Date.now(),
                };
                if (onUpdateAssets) {
                    onUpdateAssets([...(assets ?? []), newAsset]);
                }
                applyAssetAtTime(newAsset, dropSec);
            };
            reader.readAsDataURL(file);
        }
    };

    const timelineBodyRef = useRef<HTMLDivElement | null>(null);
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    const baseWidthRef = useRef(baseWidthPx);
    baseWidthRef.current = baseWidthPx;
    const totalDurationRef = useRef(totalDuration);
    totalDurationRef.current = totalDuration;
    const zoomPendingAnchorRef = useRef<{ anchorTimeSec: number; mouseOffsetX: number } | null>(null);

    const changeZoom = useCallback((nextZoom: number, mouseClientX?: number) => {
        const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(nextZoom.toFixed(2))));
        if (clampedZoom === zoomRef.current) return;

        const container = timelineBodyRef.current;
        if (!container) {
            setZoom(clampedZoom);
            return;
        }

        const oldZoom = zoomRef.current;
        const oldWidth = baseWidthRef.current * oldZoom;
        const rect = container.getBoundingClientRect();
        const scrollLeft = container.scrollLeft;

        let anchorTimeSec: number;
        let mouseOffsetX: number;

        if (mouseClientX !== undefined) {
            mouseOffsetX = Math.max(0, Math.min(container.clientWidth, mouseClientX - rect.left));
            const currentContentX = scrollLeft + mouseOffsetX;
            anchorTimeSec = (currentContentX / Math.max(1, oldWidth)) * totalDurationRef.current;
        } else {
            mouseOffsetX = container.clientWidth / 2;
            const currentContentX = scrollLeft + mouseOffsetX;
            anchorTimeSec = (currentContentX / Math.max(1, oldWidth)) * totalDurationRef.current;
        }

        zoomPendingAnchorRef.current = { anchorTimeSec, mouseOffsetX };
        zoomRef.current = clampedZoom;
        setZoom(clampedZoom);
    }, []);

    // 🚀 DOM 描画直前に同期的に scrollLeft を確定（マウスカーソル位置が 1px もズレずに静止）
    useLayoutEffect(() => {
        const pending = zoomPendingAnchorRef.current;
        if (!pending || !timelineBodyRef.current) return;
        zoomPendingAnchorRef.current = null;

        const newWidth = baseWidthRef.current * zoom;
        const newContentX = (pending.anchorTimeSec / Math.max(0.001, totalDuration)) * newWidth;
        const targetScrollLeft = Math.max(0, newContentX - pending.mouseOffsetX);
        timelineBodyRef.current.scrollLeft = targetScrollLeft;
    }, [zoom, widthPx, totalDuration]);

    const changeZoomRef = useRef(changeZoom);
    changeZoomRef.current = changeZoom;

    // ルーラー上でのホイール（コロコロ）ズーム: マウスカーソル位置を中心に極上ズーム！
    const handleRulerWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY * 0.015 * (zoomRef.current < 4 ? 1 : zoomRef.current * 0.2);
        changeZoomRef.current(zoomRef.current + delta, e.clientX);
    };

    // タイムライン全体でのホイール（コロコロ）: マウスカーソル位置を中心に直感ズーム ＆ トラックパッド左右スクロール
    useEffect(() => {
        const el = timelineBodyRef.current;
        if (!el) return;

        const onWheel = (e: WheelEvent) => {
            // トラックパッドのピンチ操作 (ctrlKey) または 修飾キー または 上下ホイール回転
            const hasHorizontalScroll = Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 2;

            if (hasHorizontalScroll) {
                // 左右スワイプ・チルト時は横スクロール
                return;
            }

            // 上下ホイール回転はマウスカーソル位置を中心としたズーム
            e.preventDefault();
            e.stopPropagation();
            const delta = -e.deltaY * 0.015 * (zoomRef.current < 4 ? 1 : zoomRef.current * 0.2);
            changeZoomRef.current(zoomRef.current + delta, e.clientX);
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const rulerStep = useMemo(() => {
        const candidates = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 5, 10, 15, 30, 60];
        for (const c of candidates) {
            if (widthPx / (totalDuration / c) >= 50) return c;
        }
        return 120;
    }, [widthPx, totalDuration]);

    const rulerMarks: number[] = [];
    for (let t = 0; t <= totalDuration + 0.001; t += rulerStep) {
        rulerMarks.push(Number(t.toFixed(3)));
    }

    const gridLines: number[] = [];
    if (gridSec > 0 && totalDuration / gridSec <= 1000) {
        for (let t = 0; t <= totalDuration + 0.001; t += gridSec) {
            gridLines.push(Number(t.toFixed(3)));
        }
    }

    const fmtMark = (t: number) => {
        const m = Math.floor(t / 60);
        const s = t % 60;
        if (rulerStep < 0.5) {
            return `${m}:${s < 10 ? `0${s.toFixed(2)}` : s.toFixed(2)}`;
        }
        return m > 0 || Number.isInteger(t) ? `${m}:${s < 10 ? `0${s}` : s}` : `${s}`;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, userSelect: 'none', WebkitUserSelect: 'none' }}>
            {/* ツールバー */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', WebkitUserSelect: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none', WebkitUserSelect: 'none' }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: '#38bdf8', userSelect: 'none', WebkitUserSelect: 'none' }}>{t.sceneTimeline}</span>
                    <span style={{ fontSize: 9, color: '#64748b', fontWeight: 800, userSelect: 'none', WebkitUserSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        (<IconMic size={10} color="#f472b6" /> {lyrics.length} · <IconVideo size={10} color="#38bdf8" /> {scenes.length} · <IconSparkles size={10} color="#38bdf8" /> {effects.length})
                    </span>
                    <button
                        onClick={onOpenEffectAssetLibrary}
                        title={t.fxLibraryHint}
                        style={{
                            background: 'rgba(56, 189, 248, 0.12)',
                            border: '1px solid rgba(56, 189, 248, 0.35)',
                            borderRadius: 4,
                            color: '#38bdf8',
                            fontSize: 9.5,
                            fontWeight: 800,
                            padding: '2px 8px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            transition: 'all 0.15s ease',
                        }}
                    >
                        <IconSparkles size={10} color="#38bdf8" />
                        <span>{t.fxLibrary}</span>
                    </button>

                    {/* 🎙 ドラッグ配置対応「+ フレーズ追加」ボタン */}
                    {onUpdateLyrics && (
                        <button
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', 'voivent:add-lyric');
                                e.dataTransfer.effectAllowed = 'copy';
                                // 💡 巨大なボタン名ゴーストが目印・タイムラインを遮らないよう、透明なドラッグ画像をセット
                                const blank = document.createElement('canvas');
                                blank.width = 1;
                                blank.height = 1;
                                e.dataTransfer.setDragImage(blank, 0, 0);
                            }}
                            onClick={() => handleAddLyricAtTime(typeof playheadSec === 'number' && Number.isFinite(playheadSec) ? playheadSec : 0)}
                            title={t.addPhraseHint}
                            style={{
                                background: 'rgba(244, 114, 182, 0.15)',
                                border: '1px solid rgba(244, 114, 182, 0.45)',
                                borderRadius: 4,
                                color: '#f472b6',
                                fontSize: 9.5,
                                fontWeight: 800,
                                padding: '2px 8px',
                                cursor: 'grab',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <IconPlus size={10} color="#f472b6" />
                            <span>{t.addPhrase}</span>
                        </button>
                    )}

                    {/* 🗑 範囲選択中のインライン一括削除バッジ（ツールバー内に統合して上下のガタつきを完全防止） */}
                    {(selectedLyricIds.size > 0 || selectedEffectIds.size > 0 || selectedSceneIds.size > 0) && (
                        <div
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                background: 'rgba(225, 29, 72, 0.16)',
                                border: '1px solid rgba(244, 63, 94, 0.5)',
                                borderRadius: 4,
                                padding: '2px 8px',
                            }}
                        >
                            <span style={{ fontSize: 9.5, fontWeight: 800, color: '#fda4af' }}>
                                {t.selectionCount(selectedSceneIds.size, selectedLyricIds.size, selectedEffectIds.size)}
                            </span>
                            <button
                                onClick={() => {
                                    if (selectedSceneIds.size > 0 && scenesRef.current.length > 1) {
                                        onUpdateScenes(deleteScenes(scenesRef.current, selectedSceneIds));
                                    }
                                    if (selectedLyricIds.size > 0 && onUpdateLyrics) {
                                        onUpdateLyrics(lyricsRef.current.filter((l) => !selectedLyricIds.has(l.id || `ly_${l.time}`)));
                                    }
                                    if (selectedEffectIds.size > 0 && onUpdateEffects) {
                                        onUpdateEffects(effectsRef.current.filter((fx) => !selectedEffectIds.has(fx.id)));
                                    }
                                    setSelectedSceneIds(new Set());
                                    setSelectedLyricIds(new Set());
                                    setSelectedEffectIds(new Set());
                                    onSelectScene(null);
                                }}
                                title={t.deleteSelectedHint}
                                style={{
                                    background: '#e11d48',
                                    border: 'none',
                                    borderRadius: 3,
                                    color: '#e7edf4',
                                    fontSize: 9,
                                    fontWeight: 800,
                                    padding: '1px 6px',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                }}
                            >
                                <IconTrash size={9} color="#e7edf4" />
                                <span>{t.delete}</span>
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedSceneIds(new Set());
                                    setSelectedLyricIds(new Set());
                                    setSelectedEffectIds(new Set());
                                }}
                                title={t.deselect}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#fda4af',
                                    fontSize: 10,
                                    cursor: 'pointer',
                                    padding: 0,
                                    lineHeight: 1,
                                }}
                            >
                                ✕
                            </button>
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* ↩️ Undo / ↪️ Redo ボタン */}
                    {onUndo && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            <button
                                onClick={onUndo}
                                disabled={!canUndo}
                                title={t.undoTitle}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#161c28',
                                    color: canUndo ? '#38bdf8' : '#475569',
                                    border: `1px solid ${canUndo ? '#283548' : '#1e2735'}`,
                                    borderRadius: 4,
                                    padding: '3px 6px',
                                    cursor: canUndo ? 'pointer' : 'not-allowed',
                                    opacity: canUndo ? 1 : 0.45,
                                    transition: 'all 0.12s ease',
                                }}
                            >
                                <IconUndo size={11} color="currentColor" />
                            </button>
                            <button
                                onClick={onRedo}
                                disabled={!canRedo}
                                title={t.redoTitle}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#161c28',
                                    color: canRedo ? '#38bdf8' : '#475569',
                                    border: `1px solid ${canRedo ? '#283548' : '#1e2735'}`,
                                    borderRadius: 4,
                                    padding: '3px 6px',
                                    cursor: canRedo ? 'pointer' : 'not-allowed',
                                    opacity: canRedo ? 1 : 0.45,
                                    transition: 'all 0.12s ease',
                                }}
                            >
                                <IconRedo size={11} color="currentColor" />
                            </button>
                            <span style={{ width: 1, height: 14, background: '#283548', margin: '0 2px' }} />
                        </div>
                    )}

                    <span style={{ fontSize: 9.5, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <IconMagnet size={11} color={gridMode === 'off' ? '#64748b' : '#38bdf8'} />
                        {t.snap}:
                    </span>
                    {(Object.keys(GRID_LABELS) as GridMode[]).map((m) => (
                        <button
                            key={m}
                            onClick={() => setGridMode(m)}
                            title={t.snapTitle(GRID_LABELS[m])}
                            style={{
                                background: gridMode === m ? 'rgba(56, 189, 248, 0.2)' : '#161c28',
                                color: gridMode === m ? '#7dd3fc' : '#94a3b8',
                                border: `1px solid ${gridMode === m ? '#38bdf8' : '#283548'}`,
                                borderRadius: 4,
                                padding: '2px 8px',
                                fontSize: 9.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                            }}
                        >
                            {GRID_LABELS[m]}
                        </button>
                    ))}
                    <span style={{ width: 1, height: 14, background: '#283548' }} />
                    {/* 再生ヘッド追従ボタン */}
                    <button
                        onClick={() => setFollowPlayhead((prev) => !prev)}
                        title={t.followPlayheadHint}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: followPlayhead ? 'rgba(56, 189, 248, 0.2)' : '#161c28',
                            color: followPlayhead ? '#7dd3fc' : '#64748b',
                            border: `1px solid ${followPlayhead ? '#38bdf8' : '#283548'}`,
                            borderRadius: 4,
                            padding: '2px 7px',
                            fontSize: 9.5,
                            fontWeight: 800,
                            cursor: 'pointer',
                        }}
                    >
                        <IconFollowPlayhead size={11} color="currentColor" />
                        <span>{t.followPlayhead}</span>
                    </button>
                    <span style={{ width: 1, height: 14, background: '#283548' }} />
                    <button
                        onClick={() => changeZoom(zoom <= 2 ? zoom - 0.25 : zoom * 0.8)}
                        disabled={zoom <= MIN_ZOOM}
                        title={t.zoomOutTitle}
                        style={{
                            display: 'flex', alignItems: 'center',
                            background: '#161c28', color: zoom <= MIN_ZOOM ? '#475569' : '#94a3b8',
                            border: '1px solid #283548', borderRadius: 4,
                            padding: '2px 6px', fontSize: 10, fontWeight: 800,
                            cursor: zoom <= MIN_ZOOM ? 'not-allowed' : 'pointer',
                        }}
                    >
                        <IconMinus size={10} color="currentColor" />
                    </button>
                    <input
                        type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.2}
                        value={zoom}
                        onChange={(e) => changeZoom(Number(e.target.value))}
                        title={t.zoomLevelTitle(zoom.toFixed(1))}
                        style={{ width: 75, accentColor: '#38bdf8' }}
                    />
                    <button
                        onClick={() => changeZoom(zoom < 2 ? zoom + 0.25 : zoom * 1.25)}
                        disabled={zoom >= MAX_ZOOM}
                        title={t.zoomInTitle}
                        style={{
                            display: 'flex', alignItems: 'center',
                            background: '#161c28', color: zoom >= MAX_ZOOM ? '#475569' : '#94a3b8',
                            border: '1px solid #283548', borderRadius: 4,
                            padding: '2px 6px', fontSize: 10, fontWeight: 800,
                            cursor: zoom >= MAX_ZOOM ? 'not-allowed' : 'pointer',
                        }}
                    >
                        <IconPlus size={10} color="currentColor" />
                    </button>
                </div>
            </div>

            {/* タイムライン本体 */}
            <div
                ref={timelineBodyRef}
                style={{
                    border: '1px solid #283548',
                    borderRadius: 6,
                    background: '#0a0d14',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                }}
            >
                <div style={{ position: 'relative', width: widthPx }}>
                    {/* ルーラー（クリックでシーク ＆ ダブルクリックで再生/一時停止 ＆ ホイールで極上ズーム） */}
                    <div
                        onClick={(e) => seekFromClientX(e.clientX)}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            onTogglePlay?.();
                        }}
                        onWheel={handleRulerWheel}
                        title={t.rulerSeekTitle}
                        style={{ height: RULER_HEIGHT, position: 'relative', borderBottom: '1px solid #1e2735', cursor: 'pointer' }}
                    >
                        {rulerMarks.map((t) => (
                            <span
                                key={`mark-${t}`}
                                style={{
                                    position: 'absolute',
                                    left: timeToX(t) + (t === 0 ? 4 : 0),
                                    top: 2,
                                    fontSize: 8.5,
                                    color: '#64748b',
                                    fontWeight: 700,
                                    transform: t === 0
                                        ? 'translateX(0)'
                                        : t >= totalDuration
                                            ? 'translateX(-100%)'
                                            : 'translateX(-50%)',
                                    whiteSpace: 'nowrap',
                                    pointerEvents: 'none',
                                }}
                            >
                                {fmtMark(t)}
                            </span>
                        ))}
                    </div>

                    {/* マルチトラック領域 */}
                    <div
                        ref={laneRef}
                        onPointerDown={handleLanePointerDown}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        style={{
                            position: 'relative',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            padding: '4px 0',
                            cursor: dragging ? 'grabbing' : 'default',
                            userSelect: 'none',
                            outline: isDragOver ? '2px dashed #38bdf8' : 'none',
                            outlineOffset: -2,
                            background: isDragOver ? 'rgba(56, 189, 248, 0.05)' : undefined,
                            transition: 'background 0.15s ease',
                        }}
                    >
                        {/* 📦 範囲選択（Marquee）矩形 */}
                        {marquee && (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: Math.min(marquee.startX, marquee.currentX),
                                    top: Math.min(marquee.startY, marquee.currentY),
                                    width: Math.abs(marquee.currentX - marquee.startX),
                                    height: Math.abs(marquee.currentY - marquee.startY),
                                    background: 'rgba(56, 189, 248, 0.18)',
                                    border: '1px solid #38bdf8',
                                    borderRadius: 4,
                                    boxShadow: '0 0 10px rgba(56, 189, 248, 0.4)',
                                    pointerEvents: 'none',
                                    zIndex: 100,
                                }}
                            />
                        )}

                        {/* アセットドロップ予定インジケーター */}
                        {isDragOver && dragOverSec !== null && (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: timeToX(dragOverSec),
                                    top: 0,
                                    bottom: 0,
                                    width: 2,
                                    background: '#38bdf8',
                                    boxShadow: '0 0 8px #38bdf8',
                                    zIndex: 50,
                                    pointerEvents: 'none',
                                }}
                            >
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: 2,
                                        left: 4,
                                        background: 'rgba(14, 165, 233, 0.95)',
                                        color: '#e7edf4',
                                        fontSize: 9,
                                        fontWeight: 800,
                                        padding: '1px 5px',
                                        borderRadius: 3,
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {t.tlDropAsset(fmtMark(dragOverSec))}
                                </div>
                            </div>
                        )}

                        {/* BPM グリッド線（全トラック貫通） */}
                        {gridLines.map((t, i) => (
                            <div
                                key={`grid-${i}`}
                                style={{
                                    position: 'absolute',
                                    left: timeToX(t),
                                    top: 0,
                                    bottom: 0,
                                    width: 1,
                                    background: i % 4 === 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                                    pointerEvents: 'none',
                                    zIndex: 0,
                                }}
                            />
                        ))}

                        {/* 🎙 1段目：歌詞テキストトラック（ドラッグ＆ドロップ配置対応） */}
                        <div
                            ref={trackLyricsRef}
                            onDragOver={(e) => {
                                if (e.dataTransfer.types.includes('text/plain')) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'copy';
                                    setIsLyricDropOver(true);
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const xInContainer = e.clientX - rect.left;
                                    const rawTime = (xInContainer / Math.max(1, widthPx)) * totalDuration;
                                    const snappedTime = gridSec > 0 ? Math.round(rawTime / gridSec) * gridSec : rawTime;
                                    setLyricDropHoverTime(Math.max(0, Math.min(totalDuration - 0.5, Number(snappedTime.toFixed(2)))));
                                }
                            }}
                            onDragLeave={() => {
                                setIsLyricDropOver(false);
                                setLyricDropHoverTime(null);
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                setIsLyricDropOver(false);
                                setLyricDropHoverTime(null);
                                const data = e.dataTransfer.getData('text/plain');
                                if (data === 'voivent:add-lyric') {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const clientX = e.clientX;
                                    const xInContainer = clientX - rect.left;
                                    const rawTime = (xInContainer / Math.max(1, widthPx)) * totalDuration;
                                    const snappedTime = gridSec > 0 ? Math.round(rawTime / gridSec) * gridSec : rawTime;
                                    handleAddLyricAtTime(snappedTime);
                                }
                            }}
                            style={{
                                position: 'relative',
                                height: LYRIC_TRACK_HEIGHT + 6,
                                borderRadius: 4,
                                border: isLyricDropOver ? '1px dashed #f472b6' : '1px solid rgba(244, 114, 182, 0.15)',
                                background: isLyricDropOver ? 'rgba(244, 114, 182, 0.12)' : 'rgba(244, 114, 182, 0.03)',
                                transition: 'border 0.12s ease, background 0.12s ease',
                            }}
                        >
                            <div style={{ position: 'absolute', left: 4, top: 3, display: 'flex', alignItems: 'center', gap: 3, opacity: 0.35, pointerEvents: 'none' }}>
                                <IconMic size={10} color="#f472b6" />
                                <span style={{ fontSize: 8, fontWeight: 900, color: '#f472b6' }}>LYRICS</span>
                            </div>

                            {/* 🎯 ドラッグ中のドロップ位置リアルタイムプレビューガイド */}
                            {isLyricDropOver && lyricDropHoverTime != null && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        left: timeToX(lyricDropHoverTime),
                                        top: 3,
                                        width: Math.max(20, timeToX(lyricDropHoverTime + 2.0) - timeToX(lyricDropHoverTime)),
                                        height: LYRIC_TRACK_HEIGHT,
                                        background: 'rgba(244, 114, 182, 0.35)',
                                        border: '1.5px dashed #f472b6',
                                        borderRadius: 4,
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '0 6px',
                                        fontSize: 9,
                                        fontWeight: 800,
                                        color: '#e7edf4',
                                        pointerEvents: 'none',
                                        zIndex: 10,
                                        boxShadow: '0 0 10px rgba(244, 114, 182, 0.5)',
                                    }}
                                >
                                    <span>+ {t.newLyricPhrase}</span>
                                </div>
                            )}

                            {sortedLyrics.map((l) => {
                                const dur = l.duration ?? LYRIC_DEFAULT_DURATION;
                                const left = timeToX(l.time);
                                const right = timeToX(l.time + dur);
                                const w = Math.max(16, right - left);
                                const isSel = selectedLyricId === l.id || selectedLyricIds.has(l.id || `ly_${l.time}`);
                                return (
                                    <div
                                        key={l.id || `ly_${l.time}`}
                                        onPointerDown={(e) => beginLyricDrag(e, l, 'move')}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const lyricId = l.id || `ly_${l.time}`;
                                            onSelectLyric?.(lyricId);
                                            window.dispatchEvent(new CustomEvent('voivent:focus-lyric', { detail: { id: lyricId } }));
                                        }}
                                        style={{
                                            position: 'absolute',
                                            left,
                                            top: 3,
                                            width: w,
                                            height: LYRIC_TRACK_HEIGHT,
                                            background: isSel
                                                ? 'linear-gradient(180deg, #ec4899, #db2777)'
                                                : 'linear-gradient(180deg, rgba(236, 72, 153, 0.75), rgba(168, 85, 247, 0.75))',
                                            border: `1px solid ${isSel ? '#fbcfe8' : 'rgba(255, 255, 255, 0.22)'}`,
                                            borderRadius: 4,
                                            boxShadow: isSel ? '0 0 10px rgba(236, 72, 153, 0.6)' : 'none',
                                            cursor: dragging ? 'grabbing' : 'grab',
                                            display: 'flex',
                                            alignItems: 'center',
                                            overflow: 'hidden',
                                            touchAction: 'none',
                                            zIndex: isSel ? 3 : 2,
                                        }}
                                    >
                                        {/* 左リサイズハンドル */}
                                        <div
                                            onPointerDown={(e) => beginLyricDrag(e, l, 'resize-start')}
                                            title={t.tlDragStart}
                                            style={{
                                                position: 'absolute',
                                                left: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: 8,
                                                cursor: 'ew-resize',
                                                background: 'linear-gradient(270deg, transparent, rgba(255,255,255,0.35))',
                                                borderTopLeftRadius: 4,
                                                borderBottomLeftRadius: 4,
                                                zIndex: 4,
                                            }}
                                        />
                                        <span
                                            style={{
                                                paddingLeft: 9,
                                                paddingRight: (isSel || confirmDeleteLyricId === (l.id || `ly_${l.time}`)) ? 30 : 9,
                                                fontSize: 9,
                                                fontWeight: 800,
                                                color: '#e7edf4',
                                                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                pointerEvents: 'none',
                                            }}
                                        >
                                            {l.text || t.tlEmptyLyric}
                                        </span>

                                        {/* 🗑️ 歌詞個別削除ボタン（選択時または確認時に表示） */}
                                        {(isSel || confirmDeleteLyricId === (l.id || `ly_${l.time}`)) && (() => {
                                            const lyricKey = l.id || `ly_${l.time}`;
                                            const isConfirming = confirmDeleteLyricId === lyricKey;
                                            return (
                                                <button
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        if (isConfirming) {
                                                            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
                                                            setConfirmDeleteLyricId(null);
                                                            if (onUpdateLyrics && lyrics) {
                                                                onUpdateLyrics(lyrics.filter((it) => (it.id || `it_${it.time}`) !== lyricKey && it.id !== l.id));
                                                            }
                                                            onSelectLyric?.(null);
                                                        } else {
                                                            setConfirmDeleteLyricId(lyricKey);
                                                            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
                                                            confirmTimerRef.current = window.setTimeout(() => {
                                                                setConfirmDeleteLyricId(null);
                                                            }, 3000);
                                                        }
                                                    }}
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    title={isConfirming ? t.deleteConfirmPrompt : t.delete}
                                                    style={{
                                                        position: 'absolute',
                                                        right: 9,
                                                        top: '50%',
                                                        transform: 'translateY(-50%)',
                                                        height: 16,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: 2,
                                                        background: isConfirming ? '#dc2626' : 'rgba(0, 0, 0, 0.45)',
                                                        border: isConfirming ? '1px solid #f87171' : '1px solid rgba(255, 255, 255, 0.25)',
                                                        borderRadius: 3,
                                                        color: '#e7edf4',
                                                        cursor: 'pointer',
                                                        padding: isConfirming ? '0 5px' : '0 3px',
                                                        fontSize: 8.5,
                                                        fontWeight: 900,
                                                        zIndex: isConfirming ? 10 : 5,
                                                        boxShadow: isConfirming ? '0 0 8px rgba(239, 68, 68, 0.8)' : 'none',
                                                        transition: 'all 0.12s ease',
                                                    }}
                                                >
                                                    <IconTrash size={9} color="#e7edf4" />
                                                    {isConfirming && <span>{t.deleteConfirmPrompt}</span>}
                                                </button>
                                            );
                                        })()}
                                        {/* 右リサイズハンドル */}
                                        <div
                                            onPointerDown={(e) => beginLyricDrag(e, l, 'resize-end')}
                                            title={t.tlDragEnd}
                                            style={{
                                                position: 'absolute',
                                                right: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: 8,
                                                cursor: 'ew-resize',
                                                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35))',
                                                borderTopRightRadius: 4,
                                                borderBottomRightRadius: 4,
                                                zIndex: 4,
                                            }}
                                        />
                                    </div>
                                );
                            })}
                        </div>

                        {/* 🌊 2段目：専用オーディオ波形トラック（独立階層・クリアな高視認性） */}
                        <div
                            onClick={(e) => seekFromClientX(e.clientX)}
                            title={t.rulerSeekTitle}
                            style={{
                                position: 'relative',
                                height: WAVE_TRACK_HEIGHT,
                                borderRadius: 4,
                                border: '1px solid rgba(56, 189, 248, 0.12)',
                                background: 'rgba(56, 189, 248, 0.02)',
                                cursor: 'pointer',
                            }}
                        >
                            <div style={{ position: 'absolute', left: 4, top: 5, display: 'flex', alignItems: 'center', gap: 3, opacity: 0.35, pointerEvents: 'none', zIndex: 2 }}>
                                <IconWaveform size={10} color="#38bdf8" />
                                <span style={{ fontSize: 8, fontWeight: 900, color: '#38bdf8' }}>AUDIO</span>
                            </div>

                            <TimelineWaveform
                                peaks={analysis?.peaks}
                                width={widthPx}
                                height={WAVE_TRACK_HEIGHT}
                                duration={totalDuration}
                            />
                        </div>

                        {/* ✨ 3段目：エフェクト (FX) トラック */}
                        <MvEffectsLane
                            ref={trackEffectsRef}
                            effects={effects}
                            totalDurationSec={totalDuration}
                            timeToX={timeToX}
                            xToTime={(x) => (x / Math.max(1, widthPx)) * totalDuration}
                            snapTime={(t) => (gridSec > 0 ? Math.round(t / gridSec) * gridSec : t)}
                            selectedEffectId={selectedEffectId}
                            selectedEffectIds={selectedEffectIds}
                            onSelectEffect={onSelectEffect}
                            onUpdateEffects={onUpdateEffects}
                            onOpenAssetLibrary={onOpenEffectAssetLibrary}
                        />

                        {/* 🎬 4段目：シーン背景トラック（画像ドラッグ＆ドロップによる自動分割・適用対応） */}
                        <div
                            ref={trackScenesRef}
                            onDragOver={(e) => {
                                const hasJson = e.dataTransfer.types.includes('application/json');
                                const hasFiles = e.dataTransfer.types.includes('Files');
                                if (hasJson || hasFiles) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.dataTransfer.dropEffect = 'copy';
                                    setIsSceneDropOver(true);
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const xInContainer = e.clientX - rect.left;
                                    const rawTime = (xInContainer / Math.max(1, widthPx)) * totalDuration;
                                    const snappedTime = gridSec > 0 ? Math.round(rawTime / gridSec) * gridSec : rawTime;
                                    setSceneDropHoverTime(Math.max(0, Math.min(totalDuration - 0.5, Number(snappedTime.toFixed(2)))));
                                }
                            }}
                            onDragLeave={() => {
                                setIsSceneDropOver(false);
                                setSceneDropHoverTime(null);
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsSceneDropOver(false);
                                setSceneDropHoverTime(null);
                                const rect = e.currentTarget.getBoundingClientRect();
                                const xInContainer = e.clientX - rect.left;
                                const rawTime = (xInContainer / Math.max(1, widthPx)) * totalDuration;
                                const dropTime = gridSec > 0 ? Math.round(rawTime / gridSec) * gridSec : rawTime;

                                const applyImageToSceneAtTime = (assetId: string) => {
                                    const splitRes = splitSceneAtTime(scenesRef.current, dropTime, { backgroundImageId: assetId });
                                    if (splitRes.newSceneId) {
                                        onUpdateScenes(splitRes.scenes);
                                        onSelectScene(splitRes.newSceneId);
                                        if (!isPlaying) onSeek?.(dropTime);
                                    } else {
                                        // 分割範囲外（先頭や末尾付近など）は対象シーンの背景画像を差し替え
                                        const curScenes = [...scenesRef.current];
                                        const targetIdx = curScenes.findIndex((s) => dropTime >= s.startTime && dropTime <= s.endTime);
                                        if (targetIdx !== -1) {
                                            curScenes[targetIdx] = { ...curScenes[targetIdx], backgroundImageId: assetId };
                                            onUpdateScenes(curScenes);
                                            onSelectScene(curScenes[targetIdx].id);
                                            if (!isPlaying) onSeek?.(dropTime);
                                        }
                                    }
                                };

                                // 1. 素材ライブラリからのドラッグ (JSON形式)
                                const jsonStr = e.dataTransfer.getData('application/json');
                                if (jsonStr) {
                                    try {
                                        const parsed = JSON.parse(jsonStr);
                                        if (parsed?.type === 'mv-asset' && parsed.asset?.id) {
                                            applyImageToSceneAtTime(parsed.asset.id);
                                            return;
                                        }
                                    } catch { /* noop */ }
                                }

                                // 2. ローカル画像ファイルの直接ドロップ
                                const file = e.dataTransfer.files?.[0];
                                if (file && file.type.startsWith('image/')) {
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                        if (typeof reader.result === 'string') {
                                            const newAssetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                                            const newAsset: MvImageAsset = {
                                                id: newAssetId,
                                                name: file.name.replace(/\.[^.]+$/, ''),
                                                dataUrl: reader.result,
                                                addedAt: Date.now(),
                                            };
                                            if (onUpdateAssets && assets) {
                                                onUpdateAssets([...assets, newAsset]);
                                            }
                                            applyImageToSceneAtTime(newAssetId);
                                        }
                                    };
                                    reader.readAsDataURL(file);
                                }
                            }}
                            style={{
                                position: 'relative',
                                height: SCENE_TRACK_HEIGHT + 6,
                                borderRadius: 4,
                                border: isSceneDropOver ? '1px dashed #38bdf8' : '1px solid rgba(56, 189, 248, 0.12)',
                                background: isSceneDropOver ? 'rgba(56, 189, 248, 0.12)' : 'rgba(56, 189, 248, 0.02)',
                                transition: 'border 0.12s ease, background 0.12s ease',
                            }}
                        >
                            <div style={{ position: 'absolute', left: 4, top: 3, display: 'flex', alignItems: 'center', gap: 3, opacity: 0.35, pointerEvents: 'none' }}>
                                <IconVideo size={10} color="#38bdf8" />
                                <span style={{ fontSize: 8, fontWeight: 900, color: '#38bdf8' }}>SCENES</span>
                            </div>

                            {/* 🎯 画像ドラッグ時のドロップ分割プレビューガイド */}
                            {isSceneDropOver && sceneDropHoverTime != null && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        left: timeToX(sceneDropHoverTime),
                                        top: 0,
                                        bottom: 0,
                                        width: 2,
                                        background: '#38bdf8',
                                        boxShadow: '0 0 12px #38bdf8',
                                        zIndex: 20,
                                        pointerEvents: 'none',
                                    }}
                                >
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: -18,
                                            left: -40,
                                            background: '#0284c7',
                                            color: '#e7edf4',
                                            fontSize: 8.5,
                                            fontWeight: 900,
                                            padding: '1px 5px',
                                            borderRadius: 3,
                                            whiteSpace: 'nowrap',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                                        }}
                                    >
                                        {t.tlDropImageToSplit}
                                    </div>
                                </div>
                            )}

                            {sortedScenes.map((s, idx) => {
                                const left = timeToX(s.startTime);
                                const right = timeToX(s.endTime);
                                const w = Math.max(14, right - left);
                                const isSel = selectedSceneIds.has(s.id) || selectedSceneId === s.id;
                                const hue = (idx * 47) % 360;
                                const baseColor = `hsl(${hue}, 55%, ${isSel ? 52 : 40}%)`;
                                return (
                                    <div
                                        key={s.id}
                                        onPointerDown={(e) => {
                                            if (e.shiftKey || e.metaKey || e.ctrlKey) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setSelectedSceneIds((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(s.id)) next.delete(s.id);
                                                    else next.add(s.id);
                                                    return next;
                                                });
                                                return;
                                            }
                                            beginSceneDrag(e, s, 'move');
                                        }}
                                        onContextMenu={(e) => {
                                            if (scenes.length > 1) {
                                                e.preventDefault();
                                                onUpdateScenes(deleteScene(scenesRef.current, s.id));
                                                onSelectScene(null);
                                            }
                                        }}
                                        style={{
                                            position: 'absolute',
                                            left,
                                            top: 3,
                                            width: w,
                                            height: SCENE_TRACK_HEIGHT,
                                            background: `linear-gradient(180deg, ${baseColor}, hsl(${hue}, 50%, ${isSel ? 36 : 26}%))`,
                                            border: `1px solid ${isSel ? '#7dd3fc' : 'rgba(255,255,255,0.18)'}`,
                                            borderRadius: 4,
                                            boxShadow: isSel ? '0 0 10px rgba(56, 189, 248, 0.45)' : 'none',
                                            cursor: dragging ? 'grabbing' : 'grab',
                                            display: 'flex',
                                            alignItems: 'center',
                                            overflow: 'hidden',
                                            touchAction: 'none',
                                            zIndex: isSel ? 3 : 2,
                                        }}
                                    >
                                        {/* 左リサイズハンドル */}
                                        <div
                                            onPointerDown={(e) => beginSceneDrag(e, s, 'resize-start')}
                                            title={t.tlDragStart}
                                            style={{
                                                position: 'absolute',
                                                left: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: 8,
                                                cursor: 'ew-resize',
                                                background: 'linear-gradient(270deg, transparent, rgba(255,255,255,0.3))',
                                                borderTopLeftRadius: 4,
                                                borderBottomLeftRadius: 4,
                                                zIndex: 4,
                                            }}
                                        />
                                        {/* 背景画像サムネイル（バー幅が 50px 以上ある時のみ表示） */}
                                        {(() => {
                                            if (w < 50) return null;
                                            const bgAsset = s.backgroundImageId ? (assets ?? []).find((a) => a.id === s.backgroundImageId) : null;
                                            if (!bgAsset) return null;
                                            return (
                                                <img
                                                    src={bgAsset.dataUrl}
                                                    alt={bgAsset.name}
                                                    style={{
                                                        width: 18,
                                                        height: 18,
                                                        borderRadius: 3,
                                                        objectFit: 'cover',
                                                        marginLeft: 11,
                                                        border: '1px solid rgba(255, 255, 255, 0.45)',
                                                        boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                                                        pointerEvents: 'none',
                                                        flexShrink: 0,
                                                    }}
                                                />
                                            );
                                        })()}
                                        <span
                                            style={{
                                                paddingLeft: s.backgroundImageId && w >= 50 ? 5 : 11,
                                                paddingRight: scenes.length > 1 ? 22 : 11,
                                                fontSize: 9.5,
                                                fontWeight: 900,
                                                color: '#e7edf4',
                                                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                pointerEvents: 'none',
                                                flex: 1,
                                            }}
                                        >
                                            {s.name}
                                        </span>

                                        {/* 🗑️ シーン個別削除ボタン（2シーン以上ある時のみ表示・2段階確認） */}
                                        {scenes.length > 1 && (() => {
                                            const isConfirming = confirmDeleteSceneId === s.id;
                                            return (
                                                <button
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        if (isConfirming) {
                                                            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
                                                            setConfirmDeleteSceneId(null);
                                                            onUpdateScenes(deleteScene(scenesRef.current, s.id));
                                                            onSelectScene(null);
                                                        } else {
                                                            setConfirmDeleteSceneId(s.id);
                                                            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
                                                            confirmTimerRef.current = window.setTimeout(() => {
                                                                setConfirmDeleteSceneId(null);
                                                            }, 3000);
                                                        }
                                                    }}
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    title={isConfirming ? t.deleteConfirmPrompt : t.delete}
                                                    style={{
                                                        position: 'absolute',
                                                        right: 9,
                                                        top: '50%',
                                                        transform: 'translateY(-50%)',
                                                        height: 16,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: 2,
                                                        background: isConfirming ? '#dc2626' : 'rgba(0, 0, 0, 0.45)',
                                                        border: isConfirming ? '1px solid #f87171' : '1px solid rgba(255, 255, 255, 0.25)',
                                                        borderRadius: 3,
                                                        color: '#e7edf4',
                                                        cursor: 'pointer',
                                                        padding: isConfirming ? '0 5px' : '0 3px',
                                                        fontSize: 8.5,
                                                        fontWeight: 900,
                                                        zIndex: isConfirming ? 10 : 5,
                                                        boxShadow: isConfirming ? '0 0 8px rgba(239, 68, 68, 0.8)' : 'none',
                                                        transition: 'all 0.12s ease',
                                                    }}
                                                >
                                                    <IconTrash size={9} color="#e7edf4" />
                                                    {isConfirming && <span>{t.deleteConfirmPrompt}</span>}
                                                </button>
                                            );
                                        })()}

                                        {/* 右リサイズハンドル */}
                                        <div
                                            onPointerDown={(e) => beginSceneDrag(e, s, 'resize-end')}
                                            title={t.resizeHandleTitle}
                                            style={{
                                                position: 'absolute',
                                                right: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: 8,
                                                cursor: 'ew-resize',
                                                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3))',
                                                borderTopRightRadius: 4,
                                                borderBottomRightRadius: 4,
                                                zIndex: 4,
                                            }}
                                        />
                                    </div>
                                );
                            })}
                        </div>

                        {/* 再生ヘッド（全トラック貫通 ＆ ルーラー上の逆三角バッジ） */}
                        {playheadSec != null && playheadSec >= 0 && playheadSec <= totalDuration && (
                            <div
                                style={{
                                    position: 'absolute',
                                    left: timeToX(playheadSec) - 1,
                                    top: 0,
                                    bottom: 0,
                                    width: 2,
                                    background: '#f43f5e',
                                    boxShadow: '0 0 6px rgba(244, 63, 94, 0.8)',
                                    pointerEvents: 'none',
                                    zIndex: 20,
                                }}
                            >
                                {/* ルーラー上の逆三角ヘッドバッジ */}
                                <div
                                    style={{
                                        position: 'absolute',
                                        left: -4,
                                        top: -RULER_HEIGHT,
                                        width: 0,
                                        height: 0,
                                        borderLeft: '5px solid transparent',
                                        borderRight: '5px solid transparent',
                                        borderTop: '7px solid #f43f5e',
                                        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ fontSize: 9, color: '#64748b', lineHeight: 1.45, whiteSpace: 'pre-line' }}>
                {t.tlHint(bpm)}
            </div>
        </div>
    );
};
