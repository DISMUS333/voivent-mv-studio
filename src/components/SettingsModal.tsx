import React from 'react';
import { ThemeId, THEMES } from '../theme';
import { IconSettings, IconPalette, IconKeyboard, IconClose, IconFollowPlayhead } from './Icons';
import { FloatingWindow } from './FloatingWindow';

interface SettingsModalProps {
    currentThemeId: ThemeId;
    onSelectTheme: (themeId: ThemeId) => void;
    onClose: () => void;
    audioInputDevice?: string;
    audioInputChannels?: string;
    audioInputPeak?: number;
    onOpenAudioSettings: () => void;
    followPlayhead?: boolean;
    onToggleFollowPlayhead?: () => void;
    zoomAnchorMode?: 'mouse' | 'playhead';
    onSetZoomAnchorMode?: (mode: 'mouse' | 'playhead') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    currentThemeId,
    onSelectTheme,
    onClose,
    audioInputDevice,
    audioInputChannels,
    audioInputPeak = 0,
    onOpenAudioSettings,
    followPlayhead = true,
    onToggleFollowPlayhead,
    zoomAnchorMode = 'mouse',
    onSetZoomAnchorMode,
}) => {
    const theme = THEMES[currentThemeId];

    return (
        <FloatingWindow
            title="設定 (Settings & Preferences)"
            icon={<IconSettings size={14} color={theme.accent} />}
            isOpen={true}
            onClose={onClose}
            initialWidth={580}
            initialHeight={480}
            minWidth={420}
            minHeight={320}
            zIndex={1200}
        >
            <div
                style={{
                    background: theme.bgPanel,
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    boxSizing: 'border-box',
                }}
            >
                {/* モーダルコンテンツ */}
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '75vh', overflowY: 'auto' }}>
                    {/* UI テーマ設定セクション */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: theme.accent, letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <IconPalette size={14} color={theme.accent} />
                                <span>UI テーマ & 配色カスタム</span>
                            </span>
                            <span style={{ fontSize: 10.5, color: theme.textMuted }}>
                                長時間作業・目の疲労度に合わせて瞬時に切り替え
                            </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {(Object.keys(THEMES) as ThemeId[]).map((tId) => {
                                const t = THEMES[tId];
                                const isSelected = currentThemeId === tId;

                                return (
                                    <div
                                        key={tId}
                                        onClick={() => onSelectTheme(tId)}
                                        style={{
                                            background: isSelected ? 'rgba(82, 148, 226, 0.12)' : theme.bgApp,
                                            border: `1.5px solid ${isSelected ? theme.accent : theme.border}`,
                                            borderRadius: 8,
                                            padding: '12px 14px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 12,
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontSize: 13, fontWeight: 800, color: isSelected ? theme.accent : theme.textMain }}>
                                                    {t.name}
                                                </span>
                                                {isSelected && (
                                                    <span style={{ fontSize: 9.5, fontWeight: 900, background: theme.accent, color: '#000', padding: '1px 6px', borderRadius: 3 }}>
                                                        ACTIVE
                                                    </span>
                                                )}
                                            </div>
                                            <span style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.35 }}>
                                                {t.description}
                                            </span>
                                        </div>

                                        {/* カラーパレットプレビュー */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                            {t.previewColors.map((c, i) => (
                                                <div
                                                    key={i}
                                                    style={{
                                                        width: 14,
                                                        height: 14,
                                                        borderRadius: 3,
                                                        background: c,
                                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* タイムライン動作設定 */}
                    <div style={{ background: theme.bgApp, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* ズーム基準設定 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 800, color: theme.accent, marginBottom: 3 }}>
                                    タイムライン・ズームの基準位置
                                </div>
                                <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.35 }}>
                                    ホイール等でズームする際の中心位置を設定します
                                </div>
                            </div>
                            <div style={{ display: 'flex', background: 'rgba(0, 0, 0, 0.25)', border: `1px solid ${theme.border}`, borderRadius: 6, padding: 2, gap: 2, flexShrink: 0 }}>
                                <button
                                    onClick={() => onSetZoomAnchorMode?.('mouse')}
                                    style={{
                                        background: zoomAnchorMode === 'mouse' ? theme.accent : 'transparent',
                                        color: zoomAnchorMode === 'mouse' ? '#000000' : theme.textMuted,
                                        border: 'none',
                                        borderRadius: 4,
                                        padding: '5px 10px',
                                        fontSize: 11,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                    }}
                                >
                                    マウス位置
                                </button>
                                <button
                                    onClick={() => onSetZoomAnchorMode?.('playhead')}
                                    style={{
                                        background: zoomAnchorMode === 'playhead' ? theme.accent : 'transparent',
                                        color: zoomAnchorMode === 'playhead' ? '#000000' : theme.textMuted,
                                        border: 'none',
                                        borderRadius: 4,
                                        padding: '5px 10px',
                                        fontSize: 11,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                    }}
                                >
                                    再生バー
                                </button>
                            </div>
                        </div>

                        <div style={{ height: 1, background: theme.border, opacity: 0.5 }} />

                        {/* 再生ヘッド自動追従設定 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 800, color: theme.accent, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <IconFollowPlayhead size={13} color={theme.accent} />
                                    <span>再生ヘッド自動追従（オートスクロール）</span>
                                </div>
                                <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.35 }}>
                                    再生・録音中に再生バーの進行に合わせてタイムライン画面を自動スクロールします
                                </div>
                            </div>
                            <button
                                onClick={onToggleFollowPlayhead}
                                style={{
                                    background: followPlayhead ? 'rgba(46, 213, 115, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                    color: followPlayhead ? '#2ed573' : theme.textMuted,
                                    border: `1px solid ${followPlayhead ? '#2ed573' : theme.border}`,
                                    borderRadius: 6,
                                    padding: '7px 14px',
                                    fontSize: 11,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    flexShrink: 0,
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                {followPlayhead ? '有効 (ON)' : '無効 (OFF)'}
                            </button>
                        </div>
                    </div>

                    {/* ショートカット・ヒント */}
                    <div style={{ background: theme.bgApp, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 800, color: theme.accent, marginBottom: 5 }}>オーディオ入力</div>
                                <div style={{ fontSize: 11, color: theme.textMain, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {audioInputDevice || '未選択'}
                                </div>
                                <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 3 }}>
                                    {audioInputChannels || '入力チャンネル情報なし'}
                                </div>
                                <div style={{ fontSize: 10, color: audioInputPeak > 0.0001 ? '#63d471' : theme.textMuted, marginTop: 4 }}>
                                    入力レベル: {audioInputPeak > 0.0001 ? audioInputPeak.toFixed(4) : '無信号'}
                                </div>
                            </div>
                            <button
                                onClick={onOpenAudioSettings}
                                style={{ background: 'rgba(82, 148, 226, 0.12)', color: theme.accent, border: `1px solid ${theme.accent}`, borderRadius: 6, padding: '8px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}
                            >
                                入出力を選ぶ
                            </button>
                        </div>
                    </div>

                    <div style={{ background: theme.bgApp, border: `1px solid ${theme.border}`, borderRadius: 8, padding: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: theme.textMuted, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                            <IconKeyboard size={13} color={theme.textMuted} />
                            <span>主なショートカット一覧</span>
                        </span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 10.5, color: theme.textMain }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textMuted }}>保存:</span>
                                <span style={{ fontWeight: 800 }}>Cmd/Ctrl + S</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textMuted }}>取り消し:</span>
                                <span style={{ fontWeight: 800 }}>Cmd/Ctrl + Z</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textMuted }}>やり直し:</span>
                                <span style={{ fontWeight: 800 }}>Cmd/Ctrl + Shift + Z / Ctrl + Y</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textMuted }}>選択項目を削除:</span>
                                <span style={{ fontWeight: 800 }}>Delete / Backspace</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textMuted }}>再生 / 停止:</span>
                                <span style={{ fontWeight: 800 }}>Space</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textMuted }}>最初へ戻る:</span>
                                <span style={{ fontWeight: 800 }}>Return / Enter</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textMuted }}>声シンセ開閉:</span>
                                <span style={{ fontWeight: 800 }}>ヘッダー [声シンセ]</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textMuted }}>音源配置:</span>
                                <span style={{ fontWeight: 800 }}>D&D でトラックへ配置</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* モーダルフッター */}
                <div
                    style={{
                        padding: '12px 18px',
                        background: theme.bgHeader,
                        borderTop: `1px solid ${theme.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                    }}
                >
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(82, 148, 226, 0.12)',
                            color: theme.accent,
                            border: `1px solid ${theme.accent}`,
                            borderRadius: 6,
                            padding: '6px 18px',
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: 'pointer',
                        }}
                    >
                        完了
                    </button>
                </div>
            </div>
        </FloatingWindow>
    );
};
