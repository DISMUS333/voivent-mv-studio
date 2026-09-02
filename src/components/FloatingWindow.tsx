import React, { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { IconClose } from './Icons';

export interface FloatingWindowProps {
    title: string;
    icon?: ReactNode;
    isOpen: boolean;
    onClose: () => void;
    initialWidth?: number;
    initialHeight?: number;
    initialX?: number;
    initialY?: number;
    minWidth?: number;
    minHeight?: number;
    zIndex?: number;
    onFocus?: () => void;
    headerRight?: ReactNode;
    children: ReactNode;
    resizable?: boolean;
}

export const FloatingWindow: React.FC<FloatingWindowProps> = ({
    title,
    icon,
    isOpen,
    onClose,
    initialWidth = 560,
    initialHeight = 420,
    initialX,
    initialY,
    minWidth = 320,
    minHeight = 220,
    zIndex = 1000,
    onFocus,
    headerRight,
    children,
    resizable = true,
}) => {
    // 画面中央または指定位置で初期化
    const [pos, setPos] = useState<{ x: number; y: number }>(() => {
        const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
        return {
            x: initialX ?? Math.max(20, Math.round((winW - initialWidth) / 2)),
            y: initialY ?? Math.max(50, Math.round((winH - initialHeight) / 2.5)),
        };
    });

    const [size, setSize] = useState<{ w: number; h: number }>({
        w: initialWidth,
        h: initialHeight,
    });

    const isDraggingRef = useRef(false);
    const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    const isResizingRef = useRef(false);
    const resizeStartRef = useRef<{ w: number; h: number; x: number; y: number }>({ w: 0, h: 0, x: 0, y: 0 });

    // タイトルバードラッグ開始
    const handleHeaderPointerDown = (e: React.PointerEvent) => {
        // ボタン類クリック時はドラッグしない
        if ((e.target as HTMLElement).closest('button, input, select, a')) return;
        onFocus?.();
        isDraggingRef.current = true;
        dragOffsetRef.current = {
            x: e.clientX - pos.x,
            y: e.clientY - pos.y,
        };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    };

    // リサイズ開始
    const handleResizePointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        onFocus?.();
        isResizingRef.current = true;
        resizeStartRef.current = {
            w: size.w,
            h: size.h,
            x: e.clientX,
            y: e.clientY,
        };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    };

    // ドラッグ＆リサイズ追従
    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (isDraggingRef.current) {
                const nextX = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dragOffsetRef.current.x));
                const nextY = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffsetRef.current.y));
                setPos({ x: nextX, y: nextY });
            } else if (isResizingRef.current) {
                const deltaX = e.clientX - resizeStartRef.current.x;
                const deltaY = e.clientY - resizeStartRef.current.y;
                const nextW = Math.max(minWidth, Math.min(window.innerWidth - pos.x - 10, resizeStartRef.current.w + deltaX));
                const nextH = Math.max(minHeight, Math.min(window.innerHeight - pos.y - 10, resizeStartRef.current.h + deltaY));
                setSize({ w: nextW, h: nextH });
            }
        };

        const handlePointerUp = () => {
            isDraggingRef.current = false;
            isResizingRef.current = false;
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [pos.x, pos.y, minWidth, minHeight]);

    if (!isOpen) return null;

    return (
        <div
            onPointerDown={() => onFocus?.()}
            style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                width: size.w,
                height: size.h,
                zIndex,
                display: 'flex',
                flexDirection: 'column',
                background: '#161922',
                border: '1px solid #2d3748',
                borderRadius: 10,
                boxShadow: '0 18px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08)',
                overflow: 'hidden',
                userSelect: 'none',
                animation: 'floatingFadeIn 0.12s ease-out',
            }}
        >
            {/* 🎛️ フローティング・タイトルバー（掴んでドラッグ移動） */}
            <div
                onPointerDown={handleHeaderPointerDown}
                style={{
                    height: 36,
                    minHeight: 36,
                    background: 'linear-gradient(180deg, #222836 0%, #1a1f2c 100%)',
                    borderBottom: '1px solid #2d3748',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 10px',
                    cursor: 'grab',
                    touchAction: 'none',
                }}
            >
                {/* 左側：アイコン & タイトル */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {icon && <div style={{ display: 'flex', alignItems: 'center', opacity: 0.85 }}>{icon}</div>}
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#f1f2f6', letterSpacing: '0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {title}
                    </span>
                </div>

                {/* 右側：ヘッダー拡張エリア & シンプルな閉じる（✕）ボタン */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {headerRight}
                    <button
                        onClick={onClose}
                        title="閉じる"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#8395a7',
                            width: 22,
                            height: 22,
                            borderRadius: 4,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#ffffff';
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = '#8395a7';
                            e.currentTarget.style.background = 'transparent';
                        }}
                    >
                        <IconClose size={13} color="currentColor" />
                    </button>
                </div>
            </div>

            {/* 📦 コンテンツ領域（スクロール可能 & 背後演奏可能） */}
            <div
                style={{
                    flex: 1,
                    overflow: 'auto',
                    userSelect: 'auto',
                    position: 'relative',
                    background: '#12151c',
                }}
            >
                {children}
            </div>

            {/* 📏 右下リサイズハンドル */}
            {resizable && (
                <div
                    onPointerDown={handleResizePointerDown}
                    style={{
                        position: 'absolute',
                        right: 0,
                        bottom: 0,
                        width: 16,
                        height: 16,
                        cursor: 'nwse-resize',
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'flex-end',
                        padding: 3,
                        zIndex: 10,
                    }}
                >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <line x1="1" y1="7" x2="7" y2="1" stroke="#718096" strokeWidth="1.5" />
                        <line x1="4" y1="7" x2="7" y2="4" stroke="#718096" strokeWidth="1.5" />
                    </svg>
                </div>
            )}
        </div>
    );
};
