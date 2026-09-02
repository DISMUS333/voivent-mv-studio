// トランスポートバー（再生・停止・録音・カウントイン・ループ・テンポ）とトラック追加ボタン。
import type { ReactNode } from 'react';

import type { Status } from '../../types';
import type { ThemeConfig } from '../../theme';
import {
    IconReturnToStart,
    IconStop,
    IconPlay,
    IconRecord,
    IconTimer,
    IconLoopCycle,
    IconPlus,
} from '../Icons';

export function TransportBar(props: {
    theme?: ThemeConfig;
    status: Status | null;
    countInEnabled: boolean;
    loopActive: boolean;
    bpm: number;
    onSeek?: (seconds: number) => void;
    onSessionPlayToggle: () => void;
    onRecordToggle?: () => void;
    onToggleCountIn?: () => void;
    onToggleLoop: () => void;
    onBpmChange?: (bpm: number) => void;
    onAddTrack: () => void;
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    children?: ReactNode;
}) {
    const {
        theme,
        status,
        countInEnabled,
        loopActive,
        bpm,
        onSeek,
        onSessionPlayToggle,
        onRecordToggle,
        onToggleCountIn,
        onToggleLoop,
        onBpmChange,
        onAddTrack,
        scrollContainerRef,
        children,
    } = props;

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: `1px solid ${theme?.border || '#1f2735'}`, background: theme?.bgPanel || 'linear-gradient(180deg, #161b24 0%, #11151d 100%)', flexWrap: 'wrap', flexShrink: 0, transition: 'background-color 0.2s ease' }}>
            {/* プレミアムトランスポートバー */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: theme?.id === 'slate' ? '#282c34' : theme?.id === 'charcoal' ? '#181a1d' : 'linear-gradient(180deg, #181d28 0%, #0f1219 100%)',
                    border: `1px solid ${theme?.id === 'slate' ? '#434956' : theme?.id === 'charcoal' ? '#2e3137' : 'rgba(112, 161, 255, 0.18)'}`,
                    borderRadius: 8,
                    padding: '4px 6px',
                    flexShrink: 0,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 12px rgba(0,0,0,0.5)',
                    transition: 'background-color 0.2s ease, border-color 0.2s ease',
                }}
            >
                {/* 先頭へ戻る (Return to Zero 0:00.0) */}
                <button
                    onClick={() => {
                        onSeek?.(0);
                        if (scrollContainerRef.current) scrollContainerRef.current.scrollLeft = 0;
                    }}
                    title="先頭へ戻る (0:00.0)"
                    style={{
                        background: 'transparent',
                        color: theme?.textMuted || '#c8d6e5',
                        border: 'none',
                        borderRadius: 6,
                        padding: '7px 11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                    }}
                >
                    <IconReturnToStart size={15} color={theme?.textMuted || '#c8d6e5'} />
                </button>

                {/* 停止 */}
                <button
                    onClick={() => {
                        if (status?.isSessionPlaying) {
                            onSessionPlayToggle();
                        } else {
                            onSeek?.(0);
                            if (scrollContainerRef.current) scrollContainerRef.current.scrollLeft = 0;
                        }
                    }}
                    title="停止 (Stop)"
                    style={{
                        background: (!status?.isSessionPlaying && !status?.isRecording)
                            ? (theme?.id === 'slate' ? '#528bff' : theme?.id === 'charcoal' ? '#7b97aa' : '#0abde3')
                            : 'transparent',
                        color: (!status?.isSessionPlaying && !status?.isRecording) ? '#ffffff' : (theme?.textMuted || '#8395a7'),
                        border: 'none',
                        borderRadius: 6,
                        padding: '7px 13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        transition: 'all 0.15s ease',
                    }}
                >
                    <IconStop size={15} color={(!status?.isSessionPlaying && !status?.isRecording) ? '#ffffff' : (theme?.textMuted || '#8395a7')} />
                </button>

                {/* 再生 */}
                <button
                    onClick={onSessionPlayToggle}
                    title="セッション再生 / 一時停止 (Space)"
                    style={{
                        background: status?.isSessionPlaying
                            ? '#2ed573'
                            : 'transparent',
                        color: status?.isSessionPlaying ? '#ffffff' : '#c8d6e5',
                        border: 'none',
                        borderRadius: 6,
                        padding: '7px 13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        transition: 'all 0.15s ease',
                    }}
                >
                    <IconPlay size={15} color={status?.isSessionPlaying ? '#ffffff' : '#c8d6e5'} />
                </button>

                {/* マスター録音ボタン（全アームトラック一括同時録音） */}
                <button
                    onClick={onRecordToggle}
                    title="マスター録音（アーム中の全トラックを一括同時録音 / ショートカット: R）"
                    style={{
                        background: status?.isRecording
                            ? '#c23616'
                            : 'transparent',
                        color: status?.isRecording ? '#ffffff' : '#eb4d4b',
                        border: 'none',
                        borderRadius: 6,
                        padding: '7px 13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                        boxShadow: status?.isRecording ? '0 0 10px rgba(194, 54, 22, 0.45)' : 'none',
                    }}
                >
                    <IconRecord size={16} color={status?.isRecording ? '#ffffff' : '#eb4d4b'} />
                </button>

                {/* カウントイン切替 */}
                <button
                    onClick={onToggleCountIn}
                    title={countInEnabled ? 'カウントイン: 4拍ON（クリックでOFF）' : 'カウントイン: OFF（クリックで4拍カウントON）'}
                    style={{
                        background: countInEnabled
                            ? 'rgba(77, 124, 255, 0.2)'
                            : 'transparent',
                        color: countInEnabled ? '#70a1ff' : '#576574',
                        border: `1px solid ${countInEnabled ? '#4d7cff' : 'transparent'}`,
                        borderRadius: 6,
                        padding: '6px 9px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 800,
                        transition: 'all 0.15s ease',
                    }}
                >
                    <IconTimer size={13} color={countInEnabled ? '#70a1ff' : '#576574'} />
                    <span>{countInEnabled ? '4拍' : 'COUNT'}</span>
                </button>

                {/* ループ再生 (Cycle) */}
                <button
                    onClick={onToggleLoop}
                    title={`ループ再生: ${loopActive ? 'ON' : 'OFF'} (ルーラー上部で範囲指定)`}
                    style={{
                        background: loopActive
                            ? 'linear-gradient(135deg, rgba(108, 92, 231, 0.4) 0%, rgba(162, 155, 254, 0.3) 100%)'
                            : 'transparent',
                        color: loopActive ? '#a29bfe' : '#576574',
                        border: `1px solid ${loopActive ? '#6c5ce7' : 'transparent'}`,
                        borderRadius: 6,
                        padding: '6px 11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: loopActive
                            ? '0 0 12px rgba(108, 92, 231, 0.6)'
                            : undefined,
                        transition: 'all 0.15s ease',
                    }}
                >
                    <IconLoopCycle size={16} color={loopActive ? '#a29bfe' : '#576574'} />
                </button>

                {/* テンポ (BPM) 直接入力ボックス */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'rgba(0, 0, 0, 0.4)',
                        border: '1px solid #283344',
                        borderRadius: 6,
                        padding: '3px 7px',
                        fontSize: 10,
                        fontWeight: 800,
                    }}
                >
                    <span style={{ color: '#70a1ff' }}>TEMPO</span>
                    <input
                        type="number"
                        min={20}
                        max={400}
                        step={0.1}
                        value={bpm ? (Math.round(bpm * 10) / 10) : 120}
                        onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) onBpmChange?.(Math.max(20, Math.min(400, val)));
                        }}
                        title="プロジェクトテンポ (20.0〜400.0 BPM、クリックして直接入力)"
                        style={{
                            width: 48,
                            background: '#0d1017',
                            color: '#ffffff',
                            border: '1px solid #3d4758',
                            borderRadius: 4,
                            padding: '2px 4px',
                            fontSize: 11,
                            fontWeight: 800,
                            textAlign: 'right',
                            outline: 'none',
                        }}
                    />
                    <span style={{ color: '#747d8c', fontSize: 9 }}>BPM</span>
                </div>
            </div>

            <button
                onClick={onAddTrack}
                style={{
                    background: 'linear-gradient(180deg, #2d3648 0%, #1e2430 100%)',
                    color: '#eee',
                    border: '1px solid #3d4a63',
                    borderRadius: 7,
                    padding: '7px 16px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                }}
            >
                <IconPlus size={13} color="#eee" />
                <span>トラック</span>
            </button>

            {children}
        </div>
    );
}
