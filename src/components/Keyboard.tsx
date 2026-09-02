//==============================================================================
// クリック/タップで演奏できるフルワイド鍵盤（5オクターブ 61鍵盤 & オクターブ切替）。
// 画面横幅いっぱいにフィットし、左右の余白を解消。
//==============================================================================
import { useEffect, useRef, useState } from 'react';
import type { KeyLayout } from '../lib/music';
import { KEY_W, noteName } from '../lib/music';

export function Keyboard(props: {
    keys: KeyLayout[];
    kbWidth: number;
    selectedNote: number;
    pressedNotes?: number[];
    hasVoice: boolean;
    octaveShift: number;
    onOctaveChange: (shift: number) => void;
    onKeyDown: (note: number) => void;
    onKeyUp: (note: number) => void;
}) {
    const {
        keys,
        kbWidth,
        selectedNote,
        pressedNotes = [],
        hasVoice,
        octaveShift,
        onOctaveChange,
        onKeyDown,
        onKeyUp,
    } = props;

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const [containerWidth, setContainerWidth] = useState<number>(0);

    // コンテナ幅を監視して全画面時にも余白なくフルストレッチ
    useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // 白鍵の総数をカウントして動的なキー幅を算出
    const whiteKeysCount = keys.filter((k) => !k.black).length || 1;
    // コンテナ幅を満たすように 1 鍵あたりの幅を拡大（最低幅は KEY_W）
    const effectiveKeyW = containerWidth > 0
        ? Math.max(KEY_W, (containerWidth - 2) / whiteKeysCount)
        : KEY_W;
    const computedTotalWidth = whiteKeysCount * effectiveKeyW;

    // キーごとの座標を動的幅に基づいて計算
    let currentWhiteIdx = 0;
    const layoutKeys = keys.map((k) => {
        if (k.black) {
            const left = (currentWhiteIdx - 0.5) * effectiveKeyW;
            return { ...k, left, width: effectiveKeyW * 0.62 };
        } else {
            const left = currentWhiteIdx * effectiveKeyW;
            currentWhiteIdx++;
            return { ...k, left, width: effectiveKeyW };
        }
    });

    return (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, padding: '0 12px 6px 12px', width: '100%', boxSizing: 'border-box' }}>
            {/* オクターブシフト コントロール（左端にすっきり配置） */}
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 6,
                    background: '#151922',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid #2d3748',
                    flexShrink: 0,
                }}
            >
                <div style={{ fontSize: 9, fontWeight: 900, color: '#a4b0be', textAlign: 'center', letterSpacing: '0.5px' }}>
                    OCTAVE
                </div>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#ff4757', textAlign: 'center' }}>
                    {octaveShift > 0 ? `+${octaveShift}` : octaveShift}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button
                        onClick={() => onOctaveChange(Math.min(2, octaveShift + 1))}
                        disabled={octaveShift >= 2}
                        style={{
                            background: octaveShift >= 2 ? '#222834' : '#2f3542',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            width: 28,
                            height: 26,
                            fontSize: 12,
                            fontWeight: 900,
                            cursor: octaveShift >= 2 ? 'not-allowed' : 'pointer',
                        }}
                        title="1オクターブ上げる (高音域)"
                    >
                        ▲
                    </button>
                    <button
                        onClick={() => onOctaveChange(Math.max(-2, octaveShift - 1))}
                        disabled={octaveShift <= -2}
                        style={{
                            background: octaveShift <= -2 ? '#222834' : '#2f3542',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            width: 28,
                            height: 26,
                            fontSize: 12,
                            fontWeight: 900,
                            cursor: octaveShift <= -2 ? 'not-allowed' : 'pointer',
                        }}
                        title="1オクターブ下げる (低音域)"
                    >
                        ▼
                    </button>
                </div>
            </div>

            {/* 鍵盤本体（全画面時は余白なしでフルフィット、小画面時は横スクロール） */}
            <div
                ref={scrollContainerRef}
                style={{
                    flex: 1,
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    background: '#0d1017',
                    borderRadius: 8,
                    border: '1px solid #283344',
                    padding: '2px 0 2px 2px',
                }}
            >
                <div style={{ position: 'relative', width: computedTotalWidth, height: 130, minWidth: '100%' }}>
                    {layoutKeys.map((k) => {
                        const isPressed = pressedNotes.indexOf(k.note) >= 0;
                        const isSelected = selectedNote === k.note;
                        return k.black ? (
                            <div
                                key={k.note}
                                onPointerDown={() => onKeyDown(k.note)}
                                onPointerUp={() => onKeyUp(k.note)}
                                onPointerLeave={() => onKeyUp(k.note)}
                                style={{
                                    position: 'absolute',
                                    left: k.left,
                                    top: 0,
                                    width: k.width,
                                    height: 82,
                                    background: isPressed ? '#e55039' : isSelected ? '#528bff' : '#14171e',
                                    border: isPressed ? '2px solid #e8ebf0' : '1px solid #232730',
                                    borderTop: 'none',
                                    borderRadius: '0 0 4px 4px',
                                    zIndex: 2,
                                    cursor: 'pointer',
                                    opacity: 1,
                                    display: 'flex',
                                    alignItems: 'flex-end',
                                    justifyContent: 'center',
                                    paddingBottom: 4,
                                    fontSize: 9,
                                    color: isPressed || isSelected ? '#e8ebf0' : '#7f8c8d',
                                    userSelect: 'none',
                                    boxSizing: 'border-box',
                                }}
                            >
                                {noteName(k.note)}
                            </div>
                        ) : (
                            <div
                                key={k.note}
                                onPointerDown={() => onKeyDown(k.note)}
                                onPointerUp={() => onKeyUp(k.note)}
                                onPointerLeave={() => onKeyUp(k.note)}
                                style={{
                                    position: 'absolute',
                                    left: k.left,
                                    top: 0,
                                    width: k.width,
                                    height: 130,
                                    background: isPressed ? '#528bff' : isSelected ? '#9db4ff' : '#e5e8ee',
                                    border: isPressed ? '2px solid #e8ebf0' : '1px solid #2c3240',
                                    borderRadius: '0 0 4px 4px',
                                    zIndex: 1,
                                    cursor: 'pointer',
                                    opacity: 1,
                                    display: 'flex',
                                    alignItems: 'flex-end',
                                    justifyContent: 'center',
                                    paddingBottom: 6,
                                    fontSize: 10,
                                    color: isPressed ? '#ffffff' : '#2d3436',
                                    userSelect: 'none',
                                    boxSizing: 'border-box',
                                }}
                            >
                                {noteName(k.note)}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

