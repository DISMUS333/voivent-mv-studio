//==============================================================================
// ステム分離の任意オファーダイアログ。
// 音源ロード直後に 1 回だけ表示し、「ステム分離?」となる初心者向けに
// やり取りなしで要点 (何が起きるか / 初回のみモデル取得 / 音声は端末内処理) を説明する。
// 「今後表示しない」は localStorage に永続化される。
//==============================================================================
import React from 'react';
import { IconSparkles, IconClose } from '../Icons';
import { useTheme } from '../../hooks/useTheme';
import { withAlpha } from '../../theme';
import { useI18n } from '../../i18n';

const DISMISS_KEY = 'voivent.mv.stemOffer.dismissed';

/** 「今後表示しない」が選択済みか */
export function isStemOfferDismissed(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
        return false;
    }
}

/** 「今後表示しない」を記録する */
export function setStemOfferDismissed(): void {
    try {
        localStorage.setItem(DISMISS_KEY, '1');
    } catch { /* ストレージ無効環境では毎回表示になるが致命的ではない */ }
}

interface MvStemOfferDialogProps {
    isOpen: boolean;
    /** 「精度アップする」(パネルを開いて分離を開始) */
    onAccept: () => void;
    /** 「あとで」(今回だけ閉じる) */
    onLater: () => void;
    /** 「今後表示しない」*/
    onNever: () => void;
}

export const MvStemOfferDialog: React.FC<MvStemOfferDialogProps> = ({
    isOpen,
    onAccept,
    onLater,
    onNever,
}) => {
    const { theme } = useTheme();
    const { t } = useI18n();

    if (!isOpen) return null;

    const buttonStyle = (primary: boolean): React.CSSProperties => ({
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        background: primary ? theme.accent : theme.bgControl,
        color: primary ? theme.bgApp : theme.textMain,
        border: primary ? 'none' : `1px solid ${theme.border}`,
        borderRadius: 6,
        padding: '7px 10px',
        fontSize: 10.5,
        fontWeight: 900,
        cursor: 'pointer',
    });

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 210,
                background: withAlpha(theme.bgApp, 0.72),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onLater(); }}
        >
            <div style={{
                width: 400,
                background: theme.bgPanel,
                border: `1px solid ${theme.borderLight}`,
                borderRadius: 10,
                padding: 16,
                display: 'flex', flexDirection: 'column', gap: 12,
                boxShadow: `0 12px 40px ${withAlpha(theme.bgApp, 0.6)}`,
                position: 'relative',
            }}>
                <button
                    onClick={onLater}
                    title={t.stemOfferLater}
                    style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', padding: 2 }}
                >
                    <IconClose size={12} color={theme.textMuted} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IconSparkles size={15} color={theme.accent} />
                    <span style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: '0.03em', color: theme.textMain }}>
                        {t.stemOfferTitle}
                    </span>
                </div>

                <div style={{ fontSize: 10.5, lineHeight: 1.65, color: theme.textMain, fontWeight: 600 }}>
                    {t.stemOfferBody}
                </div>

                <div style={{
                    display: 'flex', gap: 10, fontSize: 9.5, fontWeight: 700, color: theme.textMuted,
                    background: theme.bgControl, border: `1px solid ${theme.border}`,
                    borderRadius: 6, padding: '7px 10px', lineHeight: 1.6,
                }}>
                    <span style={{ flex: 1 }}>{t.stemOfferPoint1}</span>
                    <span style={{ flex: 1 }}>{t.stemOfferPoint2}</span>
                </div>

                {/* 💡 推奨スペック・メモリ消費の案内 */}
                <div style={{
                    display: 'flex', flexDirection: 'column', gap: 3,
                    background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.22)',
                    borderRadius: 6, padding: '7px 10px',
                }}>
                    <div style={{ fontSize: 9.5, fontWeight: 900, color: '#38bdf8' }}>
                        {t.stemOfferSpecLabel}
                    </div>
                    <div style={{ fontSize: 8.5, color: theme.textMuted, lineHeight: 1.45 }}>
                        {t.stemOfferSpecDetails}
                    </div>
                </div>

                <div style={{
                    fontSize: 9.5, fontWeight: 800, color: theme.accentInfo,
                }}>
                    {t.stemOfferNote}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={onAccept} style={buttonStyle(true)}>
                        {t.stemOfferAccept}
                    </button>
                    <button onClick={onLater} style={buttonStyle(false)}>
                        {t.stemOfferLater}
                    </button>
                    <button onClick={onNever} style={buttonStyle(false)}>
                        {t.stemOfferNever}
                    </button>
                </div>
            </div>
        </div>
    );
};
