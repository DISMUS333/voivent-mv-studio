// ツール切替ボタン群・選択中クリップ/ノートの操作・ズームスライダー・位置表示。
import type { ThemeConfig } from '../../theme';
import { formatTime } from '../../lib/music';
import {
    IconMagnet,
    IconFollowPlayhead,
    IconMarquee,
    IconScissors,
    IconTrash,
} from '../Icons';
import type { NoteSelection } from './types';

export function TimelineToolbar(props: {
    theme?: ThemeConfig;
    sessionDuration: number;
    sessionPosition: number;
    snapEnabled: boolean;
    followPlayhead: boolean;
    rangeToolActive: boolean;
    cutToolActive: boolean;
    zoomPercent: number;
    selectedNotes: NoteSelection;
    selectedClips: Array<{ track: number; clip: number }>;
    selectedClip: { track: number; clip: number } | null;
    onToggleSnap?: () => void;
    onToggleFollowPlayhead?: () => void;
    onToggleRangeTool: () => void;
    onToggleCutTool: () => void;
    onChangeZoom: (newPercent: number) => void;
    onDeleteNotes?: () => void;
    onDeleteClip?: (track: number, clip: number) => void;
    onDeleteClips?: (clips: Array<{ track: number; clip: number }>) => void;
}) {
    const {
        theme,
        sessionDuration,
        sessionPosition,
        snapEnabled,
        followPlayhead,
        rangeToolActive,
        cutToolActive,
        zoomPercent,
        selectedNotes,
        selectedClips,
        selectedClip,
        onToggleSnap,
        onToggleFollowPlayhead,
        onToggleRangeTool,
        onToggleCutTool,
        onChangeZoom,
        onDeleteNotes,
        onDeleteClip,
        onDeleteClips,
    } = props;

    return (
        <>
            {/* ツール切替ボタン群 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, background: '#171a21', border: '1px solid #2e3846', borderRadius: 6, padding: 3 }}>
                <button
                    onClick={onToggleSnap}
                    title={snapEnabled ? "グリッドスナップ吸着: ON（16分音符に吸着）" : "グリッドスナップ吸着: OFF（ミリ秒フリー任意移動）"}
                    style={{
                        background: snapEnabled ? 'rgba(46, 213, 115, 0.2)' : 'transparent',
                        color: snapEnabled ? '#2ed573' : '#747d8c',
                        border: `1px solid ${snapEnabled ? '#2ed573' : 'transparent'}`,
                        borderRadius: 4,
                        padding: '5px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <IconMagnet size={13} color={snapEnabled ? '#2ed573' : '#747d8c'} />
                </button>
                <button
                    onClick={onToggleFollowPlayhead}
                    title={followPlayhead ? "再生ヘッド自動追従（オートスクロール）: ON" : "再生ヘッド自動追従（オートスクロール）: OFF"}
                    style={{
                        background: followPlayhead ? 'rgba(112, 161, 255, 0.2)' : 'transparent',
                        color: followPlayhead ? '#70a1ff' : '#747d8c',
                        border: `1px solid ${followPlayhead ? '#70a1ff' : 'transparent'}`,
                        borderRadius: 4,
                        padding: '5px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <IconFollowPlayhead size={13} color={followPlayhead ? '#70a1ff' : '#747d8c'} />
                </button>
                <button
                    onClick={onToggleRangeTool}
                    title={rangeToolActive ? "範囲選択モード: ON" : "範囲選択モード: OFF（クリックで有効化）"}
                    style={{
                        background: rangeToolActive ? 'rgba(77, 124, 255, 0.25)' : 'transparent',
                        color: rangeToolActive ? '#70a1ff' : '#747d8c',
                        border: `1px solid ${rangeToolActive ? '#4d7cff' : 'transparent'}`,
                        borderRadius: 4,
                        padding: '5px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                    }}
                >
                    <IconMarquee size={12} color={rangeToolActive ? '#70a1ff' : '#747d8c'} />
                    <span>範囲選択 {rangeToolActive ? 'ON' : 'OFF'}</span>
                </button>
                <button
                    onClick={onToggleCutTool}
                    title="カットツール（クリックで分割）"
                    style={{
                        background: cutToolActive ? '#ffc857' : 'transparent',
                        color: cutToolActive ? '#111' : '#a4b0be',
                        border: 'none',
                        borderRadius: 4,
                        padding: '5px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                    }}
                >
                    <IconScissors size={12} color={cutToolActive ? '#111' : '#a4b0be'} />
                    <span>カット</span>
                </button>
            </div>

            {/* 選択中のクリップ / ノートの操作ボタン（削除） */}
            {selectedNotes != null && selectedNotes.notes.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: '#a4b0be' }}>
                        ノート {selectedNotes.notes.length} 個選択
                    </span>
                    <button
                        onClick={onDeleteNotes}
                        style={{
                            background: '#e5484d',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '5px 12px',
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            boxShadow: '0 2px 6px rgba(229, 72, 77, 0.4)',
                        }}
                        title="選択したノートを削除 (Deleteキーでも可)"
                    >
                        <IconTrash size={12} color="#fff" />
                        <span>ノート削除</span>
                    </button>
                </div>
            ) : (selectedClips.length > 0 || selectedClip) ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {selectedClips.length > 1 && (
                        <span style={{ fontSize: 11, color: '#a4b0be', fontWeight: 700 }}>
                            {selectedClips.length} クリップ選択中
                        </span>
                    )}
                    <button
                        onClick={() => {
                            if (selectedClips.length > 1) {
                                onDeleteClips?.(selectedClips);
                            } else if (selectedClip) {
                                onDeleteClip?.(selectedClip.track, selectedClip.clip);
                            }
                        }}
                        style={{
                            background: '#e5484d',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '5px 12px',
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            boxShadow: '0 2px 6px rgba(229, 72, 77, 0.4)',
                        }}
                        title="選択したクリップを削除 (Deleteキーでも可)"
                    >
                        <IconTrash size={12} color="#fff" />
                        <span>{selectedClips.length > 1 ? `選択クリップ (${selectedClips.length}) を削除` : 'クリップ削除'}</span>
                    </button>
                </div>
            ) : null}

            {/* 本格DAWスタイル：ミニマル水平ズームスライダー */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#181b22', padding: '4px 10px', borderRadius: 6, border: '1px solid #283344' }} title="タイムラインの拡大・縮小（Option + ホイールでもズーム可能）">
                {/* 小さな丸（縮小） */}
                <div
                    onClick={() => onChangeZoom(zoomPercent - 10)}
                    style={{ width: 6, height: 6, borderRadius: '50%', background: '#747d8c', cursor: 'pointer' }}
                    title="縮小"
                />
                <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={zoomPercent}
                    onChange={(e) => onChangeZoom(Number(e.target.value))}
                    style={{
                        width: 80,
                        accentColor: '#70a1ff',
                        cursor: 'ew-resize',
                    }}
                />
                {/* 大きな丸（拡大） */}
                <div
                    onClick={() => onChangeZoom(zoomPercent + 10)}
                    style={{ width: 10, height: 10, borderRadius: '50%', background: '#70a1ff', cursor: 'pointer' }}
                    title="拡大"
                />
            </div>

            <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto', flexShrink: 0 }}>
                位置: {formatTime(sessionPosition)} / {formatTime(sessionDuration)}
            </span>
        </>
    );
}
