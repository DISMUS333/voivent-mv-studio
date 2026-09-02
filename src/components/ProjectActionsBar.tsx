import { useState, useRef, useEffect } from 'react';
import type { RecentProject } from '../project/ProjectTypes';
import { IconSave, IconCheck, IconFolder, IconPlus } from './Icons';

type ProjectActionsBarProps = {
    project: RecentProject | null;
    saveState: 'saved' | 'unsaved' | 'unavailable';
    noticeText?: string | null;
    noticeTone?: 'info' | 'success' | 'error';
    onBackToProjects: () => void;
    onSave: () => void;
    onSaveAs?: () => void;
    onOpenProject?: () => void;
    onNewProject?: () => void;
};

export function ProjectActionsBar({
    project,
    saveState,
    noticeText,
    noticeTone = 'info',
    onBackToProjects,
    onSave,
    onSaveAs,
    onOpenProject,
    onNewProject,
}: ProjectActionsBarProps) {
    const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // メニュー外クリックで閉じる
    useEffect(() => {
        if (!isFileMenuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsFileMenuOpen(false);
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => window.removeEventListener('mousedown', handleClickOutside);
    }, [isFileMenuOpen]);

    const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdKey = isMac ? '⌘' : 'Ctrl+';

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '3px 10px',
                background: '#0d1017',
                borderBottom: '1px solid #1f2735',
                flexShrink: 0,
                height: 32,
                boxSizing: 'border-box',
                userSelect: 'none',
                zIndex: 200,
                position: 'relative',
            }}
        >
            {/* 左側：本格DAWメニューバー（ファイルメニュー等） */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* ファイルメニュー ドロップダウン */}
                <div ref={menuRef} style={{ position: 'relative' }}>
                    <button
                        type="button"
                        onClick={() => setIsFileMenuOpen((v) => !v)}
                        style={{
                            border: '1px solid',
                            borderColor: isFileMenuOpen ? '#3b82f6' : 'transparent',
                            borderRadius: 4,
                            background: isFileMenuOpen ? '#1a2230' : 'transparent',
                            color: isFileMenuOpen ? '#60a5fa' : '#cbd5e1',
                            padding: '3px 8px',
                            fontSize: 11.5,
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'all 0.12s ease',
                        }}
                        onMouseEnter={(e) => {
                            if (!isFileMenuOpen) {
                                e.currentTarget.style.background = '#151b26';
                                e.currentTarget.style.color = '#ffffff';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!isFileMenuOpen) {
                                e.currentTarget.style.background = 'transparent';
                                e.currentTarget.style.color = '#cbd5e1';
                            }
                        }}
                    >
                        ファイル
                    </button>

                    {/* ドロップダウンメニュー */}
                    {isFileMenuOpen && (
                        <div
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: 4,
                                background: '#121722',
                                border: '1px solid #2a364a',
                                borderRadius: 8,
                                padding: '4px 0',
                                width: 220,
                                boxShadow: '0 10px 30px rgba(0,0,0,0.8), 0 0 1px rgba(255,255,255,0.1)',
                                zIndex: 1000,
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            {/* 新規プロジェクト */}
                            {onNewProject && (
                                <button
                                    type="button"
                                    onClick={() => { setIsFileMenuOpen(false); onNewProject(); }}
                                    style={menuItemStyle}
                                    onMouseEnter={menuItemHover}
                                    onMouseLeave={menuItemLeave}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <IconPlus size={12} color="#94a3b8" />
                                        <span>新規プロジェクト...</span>
                                    </div>
                                    <span style={shortcutStyle}>{cmdKey}N</span>
                                </button>
                            )}

                            {/* 開く */}
                            {onOpenProject && (
                                <button
                                    type="button"
                                    onClick={() => { setIsFileMenuOpen(false); onOpenProject(); }}
                                    style={menuItemStyle}
                                    onMouseEnter={menuItemHover}
                                    onMouseLeave={menuItemLeave}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <IconFolder size={12} color="#94a3b8" />
                                        <span>プロジェクトを開く...</span>
                                    </div>
                                    <span style={shortcutStyle}>{cmdKey}O</span>
                                </button>
                            )}

                            <div style={menuDividerStyle} />

                            {/* 保存 */}
                            <button
                                type="button"
                                onClick={() => { setIsFileMenuOpen(false); onSave(); }}
                                disabled={saveState === 'unavailable'}
                                style={menuItemStyle}
                                onMouseEnter={menuItemHover}
                                onMouseLeave={menuItemLeave}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <IconSave size={12} color={saveState === 'unsaved' ? '#60a5fa' : '#94a3b8'} />
                                    <span style={{ fontWeight: saveState === 'unsaved' ? 800 : 500 }}>保存</span>
                                </div>
                                <span style={shortcutStyle}>{cmdKey}S</span>
                            </button>

                            {/* 別名で保存 */}
                            {onSaveAs && (
                                <button
                                    type="button"
                                    onClick={() => { setIsFileMenuOpen(false); onSaveAs(); }}
                                    style={menuItemStyle}
                                    onMouseEnter={menuItemHover}
                                    onMouseLeave={menuItemLeave}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <IconSave size={12} color="#94a3b8" />
                                        <span>別名で保存...</span>
                                    </div>
                                    <span style={shortcutStyle}>{cmdKey}⇧S</span>
                                </button>
                            )}

                            <div style={menuDividerStyle} />

                            {/* スタート画面へ戻る */}
                            <button
                                type="button"
                                onClick={() => { setIsFileMenuOpen(false); onBackToProjects(); }}
                                style={menuItemStyle}
                                onMouseEnter={menuItemHover}
                                onMouseLeave={menuItemLeave}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span>‹</span>
                                    <span>プロジェクト一覧に戻る</span>
                                </div>
                            </button>
                        </div>
                    )}
                </div>

                <div style={{ width: 1, height: 14, background: '#242e40', margin: '0 2px' }} />

                {/* クイック：プロジェクト一覧へ戻る */}
                <button
                    type="button"
                    onClick={onBackToProjects}
                    title="スタート画面（プロジェクト一覧）へ戻る"
                    style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#94a3b8',
                        padding: '2px 6px',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ffffff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; }}
                >
                    <span>‹ スタート画面</span>
                </button>
            </div>

            {/* 中央：プロジェクト名（タイトルバー風表示） */}
            <div
                style={{
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    pointerEvents: 'none',
                }}
            >
                <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, letterSpacing: '0.4px' }}>PROJECT:</span>
                <strong style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 800, letterSpacing: '0.3px' }}>
                    {project?.name ?? '名称未設定'}
                </strong>
                {saveState === 'unsaved' && (
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            color: '#f59e0b',
                            fontSize: 9.5,
                            fontWeight: 800,
                            background: 'rgba(245, 158, 11, 0.12)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            padding: '1px 5px',
                            borderRadius: 4,
                        }}
                    >
                        ● 未保存
                    </span>
                )}
            </div>

            {/* 右側：保存ボタン ＋ インライン通知 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* 🔔 インライン通知メッセージ（保存ボタンのすぐ横にスマート表示） */}
                {noticeText && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 11,
                            fontWeight: 700,
                            color: noticeTone === 'success' ? '#4ade80' : noticeTone === 'error' ? '#f87171' : '#93c5fd',
                            background: noticeTone === 'success' ? 'rgba(74, 222, 128, 0.12)' : noticeTone === 'error' ? 'rgba(248, 113, 113, 0.12)' : 'rgba(147, 197, 253, 0.12)',
                            border: `1px solid ${noticeTone === 'success' ? 'rgba(74, 222, 128, 0.3)' : noticeTone === 'error' ? 'rgba(248, 113, 113, 0.3)' : 'rgba(147, 197, 253, 0.3)'}`,
                            padding: '2px 8px',
                            borderRadius: 4,
                            animation: 'fadeIn 0.2s ease-out',
                        }}
                    >
                        {noticeTone === 'success' && <IconCheck size={11} color="#4ade80" />}
                        <span>{noticeText}</span>
                    </div>
                )}

                {/* 💾 保存ボタン */}
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saveState === 'unavailable'}
                    title={`プロジェクトを保存 (${cmdKey}S)`}
                    style={{
                        border: '1px solid',
                        borderColor: saveState === 'unsaved' ? '#3b82f6' : '#22c55e',
                        borderRadius: 5,
                        background: saveState === 'unsaved'
                            ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.35) 0%, rgba(37, 99, 235, 0.2) 100%)'
                            : 'rgba(34, 197, 94, 0.12)',
                        color: saveState === 'unsaved' ? '#93c5fd' : '#86efac',
                        padding: '3px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: saveState === 'unavailable' ? 'not-allowed' : 'pointer',
                        opacity: saveState === 'unavailable' ? 0.6 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        boxShadow: saveState === 'unsaved' ? '0 0 10px rgba(59, 130, 246, 0.25)' : 'none',
                        transition: 'all 0.15s ease',
                    }}
                >
                    <IconSave size={12} color={saveState === 'unsaved' ? '#93c5fd' : '#86efac'} />
                    <span>{saveState === 'unsaved' ? '保存' : '保存済み'}</span>
                    <span style={{ fontSize: 9.5, opacity: 0.7, marginLeft: 2, background: 'rgba(0,0,0,0.25)', padding: '0 3px', borderRadius: 3 }}>
                        {cmdKey}S
                    </span>
                </button>
            </div>
        </div>
    );
}

const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '7px 12px',
    background: 'transparent',
    border: 'none',
    color: '#e2e8f0',
    fontSize: 11.5,
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'background-color 0.1s ease',
};

const menuItemHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = '#2563eb';
    e.currentTarget.style.color = '#ffffff';
};

const menuItemLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.color = '#e2e8f0';
};

const shortcutStyle: React.CSSProperties = {
    fontSize: 10,
    color: '#64748b',
    marginLeft: 16,
    fontFamily: 'monospace',
};

const menuDividerStyle: React.CSSProperties = {
    height: 1,
    background: '#1e293b',
    margin: '3px 0',
};