//==============================================================================
// MV シーンエディタ用ライブプレビュープレイヤー。
// 1280x720 仮想キャンバスを小窓に縮小フィット。
// 【プロ仕様ズーム】
// 1. カーソル位置追従ズーム（Zoom to Mouse Cursor: Figma / Google Maps 方式）
// 2. 固定幅・極小スマートミニバッジ（[−] 100% [+] [リセット]）※幅が一切ブレない
// 3. Cmd / Ctrl + ホイール時のみズーム（通常ホイールは親スクロールを許可）
// 4. ドラッグによるパン移動 ＆ ダブルクリック/リセットボタンで 100% フィット
//==============================================================================
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useI18n } from '../../i18n';
import { IconMinus, IconPlus, IconReset } from '../Icons';
import type { LyricItem, MvProjectConfig, MvScene, VisemeKind } from './types';
import { AudioReactiveSandbox } from './AudioReactiveSandbox';
import type { AudioSignals } from './types';
import { lyricsVisemeAtTime } from './lyricsToViseme';

function buildPreviewSignals(timeSec: number, bpm: number, lyrics: LyricItem[] | undefined): AudioSignals {
    const beatPeriod = bpm > 0 ? 60 / bpm : 0.5;
    const phase = beatPeriod > 0 ? (timeSec % beatPeriod) / beatPeriod : 0;
    const beat = Math.exp(-phase * 6);
    const wobble = 0.5 + 0.5 * Math.sin(timeSec * 2.4);
    const peak = 0.35 + beat * 0.45 + wobble * 0.1;

    const hasAnyLyrics = Array.isArray(lyrics) && lyrics.length > 0
        && lyrics.some(l => (l.text ?? '').trim().length > 0);
    const lyricSnap = hasAnyLyrics ? lyricsVisemeAtTime(lyrics, timeSec) : null;
    let viseme: VisemeKind;
    let visemeStrength: number;
    if (lyricSnap) {
        viseme = lyricSnap.viseme;
        visemeStrength = lyricSnap.visemeStrength;
    } else if (!hasAnyLyrics) {
        const seq: VisemeKind[] = ['a', 'i', 'u', 'e', 'o'];
        const periodSec = 0.32;
        viseme = peak >= 0.04
            ? (seq[Math.floor(timeSec / periodSec) % seq.length] as VisemeKind)
            : 'sil';
        visemeStrength = viseme === 'sil' ? 0 : Math.max(0.25, Math.min(1.0, peak));
    } else {
        viseme = 'sil';
        visemeStrength = 0;
    }
    return {
        peak,
        low: 0.3 + beat * 0.5,
        mid: 0.3 + wobble * 0.35,
        high: 0.2 + wobble * 0.3,
        beat,
        isPlaying: true,
        timeSeconds: timeSec,
        bpm,
        viseme,
        visemeStrength,
    };
}

interface LivePreviewPlayerProps {
    config: MvProjectConfig;
    scene: MvScene;
    loopSeconds?: number;
    bpm?: number;
}

export const LivePreviewPlayer: React.FC<LivePreviewPlayerProps> = ({
    config,
    scene,
    loopSeconds,
    bpm = 120,
}) => {
    const { t } = useI18n();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [baseScale, setBaseScale] = useState(1);
    const [zoomMultiplier, setZoomMultiplier] = useState(1.0);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

    const [timeSec, setTimeSec] = useState(scene.startTime);

    const duration = Math.max(0.5, Math.min(loopSeconds ?? scene.endTime - scene.startTime, 12));
    const endSec = scene.startTime + duration;

    // 小窓の幅に合わせてベース縮小率を算出
    useEffect(() => {
        const updateScale = () => {
            if (containerRef.current) {
                const w = containerRef.current.clientWidth;
                setBaseScale(w / 1280);
            }
        };
        updateScale();
        window.addEventListener('resize', updateScale);
        return () => window.removeEventListener('resize', updateScale);
    }, []);

    // ネイティブ wheel リスナーによる「カーソル位置吸い付きズーム (Zoom to Cursor)」
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onNativeWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();

                const rect = el.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const delta = -e.deltaY * 0.0015;
                setZoomMultiplier((prevZoom) => {
                    const nextZoom = Math.max(0.6, Math.min(3.5, prevZoom + delta));
                    const roundedNext = parseFloat(nextZoom.toFixed(3));
                    if (roundedNext === prevZoom) return prevZoom;

                    // カーソル位置をコンテンツ上で固定するためのパン座標変換
                    setPanOffset((prevPan) => {
                        const ratio = roundedNext / prevZoom;
                        return {
                            x: mouseX - (mouseX - prevPan.x) * ratio,
                            y: mouseY - (mouseY - prevPan.y) * ratio,
                        };
                    });

                    return roundedNext;
                });
            }
        };

        el.addEventListener('wheel', onNativeWheel, { passive: false });
        return () => el.removeEventListener('wheel', onNativeWheel);
    }, []);

    // rAF による仮想時間ループ
    useEffect(() => {
        let rafId = 0;
        let last = performance.now();
        let t = timeRef.current;

        const tick = () => {
            const now = performance.now();
            const dt = Math.min(0.25, (now - last) / 1000);
            last = now;
            t += dt;
            if (t >= endSec) t = scene.startTime;
            timeRef.current = t;
            setTimeSec(t);
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [endSec, scene.startTime]);

    const timeRef = useRef(timeSec);
    timeRef.current = timeSec;

    // ボタンによる中心ズーム
    const handleZoomStep = useCallback((delta: number) => {
        const el = containerRef.current;
        const centerX = el ? el.clientWidth / 2 : 148;
        const centerY = el ? el.clientHeight / 2 : 83;

        setZoomMultiplier((prevZoom) => {
            const nextZoom = Math.max(0.6, Math.min(3.5, prevZoom + delta));
            const roundedNext = parseFloat(nextZoom.toFixed(2));
            if (roundedNext === prevZoom) return prevZoom;

            setPanOffset((prevPan) => {
                const ratio = roundedNext / prevZoom;
                return {
                    x: centerX - (centerX - prevPan.x) * ratio,
                    y: centerY - (centerY - prevPan.y) * ratio,
                };
            });

            return roundedNext;
        });
    }, []);

    const zoomIn = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        handleZoomStep(0.25);
    }, [handleZoomStep]);

    const zoomOut = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        handleZoomStep(-0.25);
    }, [handleZoomStep]);

    // リセット（100% 中央フィット）
    const handleReset = useCallback((e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setZoomMultiplier(1.0);
        setPanOffset({ x: 0, y: 0 });
    }, []);

    // ドラッグによるパン移動
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return; // 左クリックのみ
        setIsDragging(true);
        dragStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            panX: panOffset.x,
            panY: panOffset.y,
        };
    }, [panOffset]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        setPanOffset({
            x: dragStartRef.current.panX + dx,
            y: dragStartRef.current.panY + dy,
        });
    }, [isDragging]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    const signals = useMemo(
        () => buildPreviewSignals(timeSec, bpm, config.lyrics),
        [timeSec, bpm, config.lyrics],
    );

    const totalScale = baseScale * zoomMultiplier;

    return (
        <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => {
                setIsHovered(false);
                setIsDragging(false);
            }}
            onDoubleClick={handleReset}
            title={t.pvZoomHint}
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                background: '#000000',
                overscrollBehavior: 'none',
                cursor: isDragging ? 'grabbing' : zoomMultiplier > 1.05 ? 'grab' : 'default',
                userSelect: 'none',
            }}
        >
            {/* 1280x720 の仮想キャンバスをズーム＆パン */}
            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: 1280,
                    height: 720,
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${totalScale})`,
                    transformOrigin: 'top left',
                    pointerEvents: 'none',
                }}
            >
                <AudioReactiveSandbox
                    scenes={config.scenes}
                    lyrics={config.lyrics}
                    globalCss={config.globalCss || ''}
                    signals={signals}
                    assets={config.assets ?? []}
                    lyricStyle={config.lyricStyle ?? {}}
                />
            </div>

            {/* 極小・固定幅スマートミニバッジ（ホバー時または非等倍時に常時安定表示） */}
            {(isHovered || zoomMultiplier !== 1.0) && (
                <div
                    onMouseDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 104, // 幅完全固定（レイアウトシフト・位置ズレ 100% ゼロ）
                        height: 20,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'rgba(15, 23, 42, 0.92)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        borderRadius: 4,
                        padding: '0 4px',
                        fontSize: 9,
                        fontWeight: 900,
                        color: '#38bdf8',
                        zIndex: 20,
                        backdropFilter: 'blur(6px)',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                        boxSizing: 'border-box',
                    }}
                >
                    {/* 縮小ボタン */}
                    <button
                        onClick={zoomOut}
                        title={t.pvZoomOut}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 14,
                            height: 14,
                        }}
                    >
                        <IconMinus size={10} color="#94a3b8" />
                    </button>

                    {/* 倍率表示（クリックで 100% リセット） */}
                    <button
                        onClick={handleReset}
                        title={t.pvResetClick}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: zoomMultiplier !== 1.0 ? '#38bdf8' : '#94a3b8',
                            fontSize: 9,
                            fontWeight: 900,
                            cursor: 'pointer',
                            padding: '0 2px',
                            width: 36,
                            textAlign: 'center',
                        }}
                    >
                        {Math.round(zoomMultiplier * 100)}%
                    </button>

                    {/* 拡大ボタン */}
                    <button
                        onClick={zoomIn}
                        title={t.pvZoomIn}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 14,
                            height: 14,
                        }}
                    >
                        <IconPlus size={10} color="#94a3b8" />
                    </button>

                    {/* リセットアイコンボタン */}
                    <button
                        onClick={handleReset}
                        title={t.pvResetFit}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: zoomMultiplier !== 1.0 ? '#38bdf8' : '#475569',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 14,
                            height: 14,
                            opacity: zoomMultiplier !== 1.0 ? 1 : 0.4,
                        }}
                    >
                        <IconReset size={10} color={zoomMultiplier !== 1.0 ? '#38bdf8' : '#64748b'} />
                    </button>
                </div>
            )}
        </div>
    );
};