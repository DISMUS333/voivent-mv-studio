//==============================================================================
// MvEffectsLane.tsx - タイムライン専用エフェクト (FX) トラック
//==============================================================================

import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { MvEffectClip } from './types';
import { IconSparkles, IconTrash } from '../../Icons';
import { useI18n } from '../../../i18n';

export interface MvEffectsLaneProps {
    effects: MvEffectClip[];
    totalDurationSec: number;
    timeToX: (time: number) => number;
    xToTime: (x: number) => number;
    snapTime: (t: number) => number;
    trackHeight?: number;
    selectedEffectId: string | null;
    selectedEffectIds?: Set<string>;
    onSelectEffect: (id: string | null) => void;
    onUpdateEffects: (effects: MvEffectClip[]) => void;
    onOpenAssetLibrary: () => void;
}

export const MvEffectsLane = React.forwardRef<HTMLDivElement, MvEffectsLaneProps>(({
    effects,
    totalDurationSec,
    timeToX,
    xToTime,
    snapTime,
    trackHeight = 28,
    selectedEffectId,
    selectedEffectIds,
    onSelectEffect,
    onUpdateEffects,
    onOpenAssetLibrary,
}, forwardedRef) => {
    const { t } = useI18n();
    const internalLaneRef = useRef<HTMLDivElement>(null);
    const laneRef = (forwardedRef as React.RefObject<HTMLDivElement>) || internalLaneRef;
    const [dragging, setDragging] = useState<{
        clipId: string;
        mode: 'move' | 'resize-start' | 'resize-end';
        startX: number;
        origStart: number;
        origEnd: number;
    } | null>(null);

    // 🗑️ 2段階削除確認 (ミスポチ防止)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const confirmTimerRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
        };
    }, []);

    const sortedEffects = [...effects].sort((a, b) => a.startTime - b.startTime);

    // クリップのドラッグ開始
    const beginDrag = (
        e: React.PointerEvent,
        clip: MvEffectClip,
        mode: 'move' | 'resize-start' | 'resize-end'
    ) => {
        e.stopPropagation();
        onSelectEffect(clip.id);
        setDragging({
            clipId: clip.id,
            mode,
            startX: e.clientX,
            origStart: clip.startTime,
            origEnd: clip.endTime,
        });
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    // ポインター移動
    const handlePointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!dragging) return;
            const deltaX = e.clientX - dragging.startX;
            const deltaTime = xToTime(timeToX(0) + deltaX) - 0;

            const nextEffects = effects.map((fx) => {
                if (fx.id !== dragging.clipId) return fx;

                if (dragging.mode === 'move') {
                    const dur = dragging.origEnd - dragging.origStart;
                    let newStart = snapTime(Math.max(0, dragging.origStart + deltaTime));
                    if (totalDurationSec > 0) {
                        newStart = Math.min(newStart, Math.max(0, totalDurationSec - dur));
                    }
                    return { ...fx, startTime: newStart, endTime: newStart + dur };
                } else if (dragging.mode === 'resize-start') {
                    let newStart = snapTime(Math.max(0, dragging.origStart + deltaTime));
                    newStart = Math.min(newStart, dragging.origEnd - 0.5);
                    return { ...fx, startTime: newStart };
                } else if (dragging.mode === 'resize-end') {
                    let newEnd = snapTime(Math.max(dragging.origStart + 0.5, dragging.origEnd + deltaTime));
                    if (totalDurationSec > 0) {
                        newEnd = Math.min(newEnd, totalDurationSec);
                    }
                    return { ...fx, endTime: newEnd };
                }
                return fx;
            });

            onUpdateEffects(nextEffects);
        },
        [dragging, effects, onUpdateEffects, snapTime, timeToX, totalDurationSec, xToTime]
    );

    const handlePointerUp = useCallback(
        (e: React.PointerEvent) => {
            if (dragging) {
                try {
                    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                } catch {
                    // pointer capture release fallback
                }
                setDragging(null);
            }
        },
        [dragging]
    );

    // クリップ削除 (2段階確認)
    const handleDeleteEffect = (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirmDeleteId === id) {
            // 2回目のクリック：確定削除
            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
            setConfirmDeleteId(null);
            onUpdateEffects(effects.filter((fx) => fx.id !== id));
            if (selectedEffectId === id) onSelectEffect(null);
        } else {
            // 1回目のクリック：確認待機
            setConfirmDeleteId(id);
            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
            confirmTimerRef.current = window.setTimeout(() => {
                setConfirmDeleteId(null);
            }, 3000);
        }
    };

    return (
        <div
            ref={laneRef}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
                position: 'relative',
                height: trackHeight + 6,
                borderRadius: 4,
                border: '1px solid rgba(56, 189, 248, 0.12)',
                background: 'rgba(56, 189, 248, 0.03)',
                userSelect: 'none',
            }}
        >
            {/* トラック名ラベル（透かし・クリップ操作を邪魔しない） */}
            <div
                style={{
                    position: 'absolute',
                    left: 4,
                    top: 3,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    opacity: 0.35,
                    pointerEvents: 'none',
                    zIndex: 1,
                }}
            >
                <IconSparkles size={10} color="#38bdf8" />
                <span style={{ fontSize: 8, fontWeight: 900, color: '#38bdf8' }}>
                    EFFECTS
                </span>
            </div>

            {/* エフェクトクリップ一覧 */}
            {sortedEffects.map((fx) => {
                const dur = Math.max(0.5, fx.endTime - fx.startTime);
                const left = timeToX(fx.startTime);
                const right = timeToX(fx.startTime + dur);
                const w = Math.max(20, right - left);
                const isSel = selectedEffectId === fx.id || (selectedEffectIds?.has(fx.id) ?? false);
                const isConfirming = confirmDeleteId === fx.id;

                return (
                    <div
                        key={fx.id}
                        onPointerDown={(e) => beginDrag(e, fx, 'move')}
                        style={{
                            position: 'absolute',
                            left,
                            top: 3,
                            width: w,
                            height: trackHeight,
                            background: isConfirming
                                ? 'linear-gradient(180deg, #991b1b, #7f1d1d)'
                                : isSel
                                    ? 'linear-gradient(180deg, #0284c7, #0369a1)'
                                    : 'linear-gradient(180deg, rgba(14, 165, 233, 0.75), rgba(2, 132, 199, 0.75))',
                            border: `1px solid ${isConfirming ? '#f87171' : isSel ? '#7dd3fc' : 'rgba(255, 255, 255, 0.25)'}`,
                            borderRadius: 4,
                            boxShadow: isConfirming
                                ? '0 0 12px rgba(239, 68, 68, 0.7)'
                                : isSel
                                    ? '0 0 12px rgba(56, 189, 248, 0.6)'
                                    : 'none',
                            cursor: dragging ? 'grabbing' : 'grab',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            overflow: 'hidden',
                            touchAction: 'none',
                            zIndex: isConfirming ? 10 : isSel ? 5 : 3,
                            padding: '0 4px',
                        }}
                    >
                        {/* 左リサイズハンドル */}
                        <div
                            onPointerDown={(e) => beginDrag(e, fx, 'resize-start')}
                            title="開始時間を伸縮"
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: 7,
                                cursor: 'ew-resize',
                                background: 'linear-gradient(270deg, transparent, rgba(255,255,255,0.4))',
                                zIndex: 6,
                            }}
                        />

                        {/* クリップ名 */}
                        <span
                            style={{
                                paddingLeft: 6,
                                paddingRight: 4,
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
                            {fx.name}
                        </span>

                        {/* 削除ボタン（選択時または確認時に表示） */}
                        {(isSel || isConfirming) && (
                            <button
                                onClick={(e) => handleDeleteEffect(e, fx.id)}
                                onPointerDown={(e) => e.stopPropagation()}
                                title={isConfirming ? t.deleteConfirmPrompt : t.delete}
                                style={{
                                    background: isConfirming ? '#dc2626' : 'rgba(0,0,0,0.45)',
                                    border: isConfirming ? '1px solid #f87171' : 'none',
                                    borderRadius: 3,
                                    padding: isConfirming ? '1px 5px' : '1px 3px',
                                    cursor: 'pointer',
                                    color: '#e7edf4',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    fontSize: 8.5,
                                    fontWeight: 900,
                                    zIndex: 7,
                                    boxShadow: isConfirming ? '0 0 8px rgba(239, 68, 68, 0.8)' : 'none',
                                    transition: 'all 0.12s ease',
                                }}
                            >
                                <IconTrash size={9} color="#e7edf4" />
                                {isConfirming && <span>{t.deleteConfirmPrompt}</span>}
                            </button>
                        )}

                        {/* 右リサイズハンドル */}
                        <div
                            onPointerDown={(e) => beginDrag(e, fx, 'resize-end')}
                            title="終了時間を伸縮"
                            style={{
                                position: 'absolute',
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: 7,
                                cursor: 'ew-resize',
                                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4))',
                                zIndex: 6,
                            }}
                        />
                    </div>
                );
            })}
        </div>
    );
});
