//==============================================================================
// Web Studio 案内モーダル (デスクトップ DAW 向け)
// デスクトップ版の DAW 音源制作と、Web 版の外部音源/AI ステム分離の違いを
// わかりやすく案内し、誤タップを防止した上でブラウザ起動する。
//==============================================================================
import React from 'react';
import { useTheme } from '../../hooks/useTheme';
import { withAlpha } from '../../theme';
import {
    IconExternalLink,
    IconGlobe,
    IconSpectrum,
    IconWaveform,
} from '../Icons';
import { native } from '../../native';

export const WEB_STUDIO_URL = 'https://studio.voivent.com';

interface WebStudioGuideModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function WebStudioGuideModal({ isOpen, onClose }: WebStudioGuideModalProps) {
    const { theme } = useTheme();

    if (!isOpen) return null;

    const handleOpenInBrowser = () => {
        void native.openExternalUrl(WEB_STUDIO_URL);
        onClose();
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.72)',
                backdropFilter: 'blur(4px)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: theme.bgPanel,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 10,
                    width: 480,
                    maxWidth: '100%',
                    padding: 24,
                    boxShadow: '0 20px 48px rgba(0, 0, 0, 0.55)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.border}`, paddingBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <IconGlobe size={18} color={theme.accentSecondary} />
                        <span style={{ fontSize: 14, fontWeight: 900, color: theme.textMain, letterSpacing: '0.04em' }}>
                            Voivent Web Studio のご案内
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: theme.textMuted,
                            fontSize: 16,
                            cursor: 'pointer',
                            padding: '2px 6px',
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* 説明本文 */}
                <div style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.6 }}>
                    デスクトップ版 DAW ではプロジェクト内の各トラックから直接高音質な MV を生成します。
                    完成音源（2mix WAV/MP3）からの MV 制作や AI 音源分離を行いたい場合は、
                    専用の <strong>Web Studio</strong> をご利用いただけます。
                </div>

                {/* 機能ハイライト */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: theme.bgApp, padding: 14, borderRadius: 8, border: `1px solid ${theme.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ padding: 4, background: withAlpha(theme.accentInfo, 0.15), borderRadius: 4, marginTop: 1 }}>
                            <IconWaveform size={14} color={theme.accentInfo} />
                        </div>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 800, color: theme.textMain }}>
                                外部完成音源の取り込み
                            </div>
                            <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
                                お手持ちの 2mix 音源（WAV / MP3 / M4A 等）をブラウザへドラッグ＆ドロップして即座に解析。
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ padding: 4, background: withAlpha(theme.accentSecondary, 0.15), borderRadius: 4, marginTop: 1 }}>
                            <IconSpectrum size={14} color={theme.accentSecondary} />
                        </div>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 800, color: theme.textMain }}>
                                WebGPU AI 4ステム分離
                            </div>
                            <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
                                ボーカル・ドラム・ベース・その他へ約 37 秒で高速分離。ステムごとのビート・発声連動演出が可能。
                            </div>
                        </div>
                    </div>
                </div>

                {/* アクションボタン */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                    <button
                        onClick={onClose}
                        style={{
                            background: theme.bgControl,
                            border: `1px solid ${theme.border}`,
                            borderRadius: 6,
                            padding: '7px 14px',
                            color: theme.textMain,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        閉じる
                    </button>
                    <button
                        onClick={handleOpenInBrowser}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            background: theme.accentSecondary,
                            border: 'none',
                            borderRadius: 6,
                            padding: '7px 16px',
                            color: theme.bgApp,
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                        }}
                    >
                        <IconExternalLink size={13} color={theme.bgApp} />
                        <span>ブラウザで Web Studio を開く</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
