// 小節タイムルーラー（ループ範囲帯・小節目盛り・拍ティック・再生ヘッド三角マーカー）。
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { Status } from '../../types';
import type { ThemeConfig } from '../../theme';
import { formatTime } from '../../lib/music';

export function TimelineRuler(props: {
    theme?: ThemeConfig;
    status: Status | null;
    trackHeaderWidth: number;
    timelineWidthPx: number;
    totalBars: number;
    barSec: number;
    pxPerSec: number;
    currentHeadSec: number;
    loopActive: boolean;
    loopRange: { start: number; end: number };
    onRulerPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onRulerDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
    onRulerWheel: (e: React.WheelEvent) => void;
    onLoopHandlePointerDown: (e: ReactPointerEvent<HTMLDivElement>, mode: 'start' | 'end' | 'move') => void;
    onLoopHandlePointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onLoopHandlePointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onHeaderResizePointerDown?: (e: React.PointerEvent) => void;
    onHeaderResizePointerMove?: (e: React.PointerEvent) => void;
    onHeaderResizePointerUp?: (e: React.PointerEvent) => void;
}) {
    const {
        theme,
        status,
        trackHeaderWidth,
        timelineWidthPx,
        totalBars,
        barSec,
        pxPerSec,
        currentHeadSec,
        loopActive,
        loopRange,
        onRulerPointerDown,
        onRulerDoubleClick,
        onRulerWheel,
        onLoopHandlePointerDown,
        onLoopHandlePointerMove,
        onLoopHandlePointerUp,
        onHeaderResizePointerDown,
        onHeaderResizePointerMove,
        onHeaderResizePointerUp,
    } = props;

    return (
        <div style={{ display: 'flex', background: theme?.bgHeader || '#161920', borderBottom: `1px solid ${theme?.border || '#2d3648'}`, height: 32, userSelect: 'none', position: 'sticky', top: 0, zIndex: 12, transition: 'background-color 0.2s ease' }}>
            {/* 左側ヘッダー余白（左端に固定：可変幅 trackHeaderWidth） */}
            <div style={{ width: trackHeaderWidth, flexShrink: 0, borderRight: `1px solid ${theme?.border || '#2a2d34'}`, background: theme?.bgHeader || '#161920', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', fontSize: 10, color: theme?.textMuted || '#747d8c', fontWeight: 800, position: 'sticky', left: 0, zIndex: 15 }}>
                <span>TRACKS / 小節 (BARS)</span>
                {/* スプリッターリサイズハンドル */}
                {onHeaderResizePointerDown && (
                    <div
                        onPointerDown={onHeaderResizePointerDown}
                        onPointerMove={onHeaderResizePointerMove}
                        onPointerUp={onHeaderResizePointerUp}
                        style={{
                            width: 8,
                            height: '100%',
                            cursor: 'col-resize',
                            marginRight: -10,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        title="ドラッグしてトラックヘッダー幅を変更"
                    >
                        <div style={{ width: 2, height: 16, background: '#3d4a5d', borderRadius: 1 }} />
                    </div>
                )}
            </div>

            {/* 小節目盛りルーラー（クリックでシーク移動 ＆ コロコロでズーム） */}
            <div
                style={{ width: Math.max(600, timelineWidthPx), position: 'relative', height: 32, cursor: 'pointer', flexShrink: 0 }}
                onDoubleClick={onRulerDoubleClick}
                onPointerDown={onRulerPointerDown}
                onWheel={onRulerWheel}
                title="クリックして再生位置を移動 / ホイール（コロコロ）でズーム"
            >
                {/* ネオンループ範囲帯（掴んでドラッグ移動・伸縮可能） */}
                <div
                    style={{
                        position: 'absolute',
                        left: loopRange.start * pxPerSec,
                        top: 0,
                        width: Math.max(16, (loopRange.end - loopRange.start) * pxPerSec),
                        height: 8,
                        background: loopActive
                            ? 'linear-gradient(180deg, rgba(108, 92, 231, 0.75) 0%, rgba(162, 155, 254, 0.4) 100%)'
                            : 'rgba(75, 85, 99, 0.55)',
                        borderTop: `2px solid ${loopActive ? '#a29bfe' : '#718093'}`,
                        borderBottom: `1px solid ${loopActive ? '#6c5ce7' : '#353b48'}`,
                        borderRadius: '2px 2px 0 0',
                        boxShadow: loopActive ? '0 0 8px rgba(108, 92, 231, 0.7)' : undefined,
                        zIndex: 10,
                        cursor: 'grab',
                    }}
                    onPointerDown={(e) => onLoopHandlePointerDown(e, 'move')}
                    onPointerMove={onLoopHandlePointerMove}
                    onPointerUp={onLoopHandlePointerUp}
                    title={`ループ区間: ${formatTime(loopRange.start)} 〜 ${formatTime(loopRange.end)}（ドラッグで移動）`}
                >
                    {/* 左端ハンドル */}
                    <div
                        onPointerDown={(e) => onLoopHandlePointerDown(e, 'start')}
                        onPointerMove={onLoopHandlePointerMove}
                        onPointerUp={onLoopHandlePointerUp}
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: 8,
                            cursor: 'ew-resize',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                        }}
                        title="ドラッグしてループ開始位置を変更"
                    >
                        <div style={{ width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderLeft: `5px solid ${loopActive ? '#a29bfe' : '#95a5a6'}` }} />
                    </div>

                    {/* 右端ハンドル */}
                    <div
                        onPointerDown={(e) => onLoopHandlePointerDown(e, 'end')}
                        onPointerMove={onLoopHandlePointerMove}
                        onPointerUp={onLoopHandlePointerUp}
                        style={{
                            position: 'absolute',
                            right: 0,
                            top: 0,
                            bottom: 0,
                            width: 8,
                            cursor: 'ew-resize',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                        }}
                        title="ドラッグしてループ終了位置を変更"
                    >
                        <div style={{ width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderRight: `5px solid ${loopActive ? '#a29bfe' : '#95a5a6'}` }} />
                    </div>
                </div>
                {(() => {
                    const singleBarPx = barSec * pxPerSec;
                    // ズームに応じた滑らかな小節ステップ（16, 8, 4, 2, 1）
                    const barStep = singleBarPx < 8 ? 16 : singleBarPx < 18 ? 8 : singleBarPx < 40 ? 4 : singleBarPx < 80 ? 2 : 1;
                    const showSubBeatTicks = singleBarPx >= 60;
                    const showSubBeatText = singleBarPx >= 280;

                    return Array.from({ length: Math.ceil(totalBars / barStep) }).map((_, stepIdx) => {
                        const barIdx = stepIdx * barStep;
                        const barNum = barIdx + 1;
                        const left = barIdx * barSec * pxPerSec;

                        return (
                            <div key={barIdx} style={{ position: 'absolute', left, top: 0, bottom: 0, pointerEvents: 'none' }}>
                                {/* 大目盛り（小節番号） */}
                                <div style={{ position: 'absolute', left: 4, top: 12, fontSize: 11, fontWeight: 900, color: theme?.id === 'slate' ? '#abb2bf' : theme?.id === 'charcoal' ? '#828997' : '#70a1ff', whiteSpace: 'nowrap', lineHeight: 1 }}>
                                    {barNum}
                                </div>
                                <div style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 14, background: theme?.id === 'slate' ? '#5c6370' : theme?.id === 'charcoal' ? '#3e4249' : '#4d7cff' }} />

                                {/* 小節内の拍目盛り（幅があるときはティック線、超拡大時のみ 1.2 などの文字を表示） */}
                                {showSubBeatTicks && barStep === 1 && [1, 2, 3].map((beat) => {
                                    const beatLeft = (beat * (barSec / 4)) * pxPerSec;
                                    return (
                                        <div key={beat} style={{ position: 'absolute', left: beatLeft, top: 0, bottom: 0 }}>
                                            {showSubBeatText && (
                                                <div style={{ position: 'absolute', left: 2, top: 14, fontSize: 9, color: '#57606f', fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1 }}>
                                                    {barNum}.{beat + 1}
                                                </div>
                                            )}
                                            <div style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: showSubBeatText ? 7 : 5, background: '#353b48' }} />
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    });
                })()}

                {/* ルーラー上の再生/録音ヘッド三角マーカー */}
                <div
                    style={{
                        position: 'absolute',
                        left: currentHeadSec * pxPerSec - 5,
                        top: 0,
                        width: 0,
                        height: 0,
                        borderLeft: '5px solid transparent',
                        borderRight: '5px solid transparent',
                        borderTop: `10px solid ${status?.isRecording ? '#ff3838' : (status?.isSessionPlaying || status?.isPlaying) ? '#ffd32a' : '#ffffff'}`,
                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))',
                        zIndex: 10,
                        pointerEvents: 'none',
                    }}
                />
            </div>
        </div>
    );
}
