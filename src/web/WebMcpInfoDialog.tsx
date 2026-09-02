import React, { useEffect } from 'react';
import { IconClose, IconCode, IconGlobe, IconSparkles } from '../components/Icons';
import { useI18n } from '../i18n';

interface WebMcpInfoDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export const WebMcpInfoDialog: React.FC<WebMcpInfoDialogProps> = ({ isOpen, onClose }) => {
    const { t } = useI18n();

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            role="presentation"
            onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 20, background: 'rgba(5, 8, 13, 0.78)', backdropFilter: 'blur(8px)',
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="webmcp-info-title"
                style={{
                    position: 'relative', width: 'min(620px, 100%)',
                    maxHeight: 'min(720px, calc(100dvh - 40px))', overflowY: 'auto', boxSizing: 'border-box',
                    padding: 'clamp(22px, 4vw, 34px)', color: '#e8ebf0',
                    background: 'linear-gradient(145deg, rgba(19,24,34,0.98), rgba(10,14,21,0.98))',
                    border: '1px solid rgba(56,189,248,0.42)', borderRadius: 14,
                    boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
                    fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif",
                }}
            >
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t.close}
                    style={{
                        position: 'absolute', top: 16, right: 16, display: 'grid', placeItems: 'center',
                        width: 32, height: 32, color: '#8395a7', background: 'rgba(35,45,61,0.55)',
                        border: '1px solid #232d3d', borderRadius: 7, cursor: 'pointer',
                    }}
                >
                    <IconClose size={14} color="currentColor" />
                </button>

                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#38bdf8', fontSize: 11, fontWeight: 900, letterSpacing: '0.14em' }}>
                    <IconSparkles size={14} color="currentColor" />
                    <span>{t.welcomeWebMcpBadge}</span>
                </div>
                <h2 id="webmcp-info-title" style={{ margin: '14px 46px 10px 0', fontSize: 'clamp(20px, 3vw, 29px)', lineHeight: 1.25, letterSpacing: '0.02em' }}>
                    {t.welcomeWebMcpDialogTitle}
                </h2>
                <p style={{ margin: 0, color: '#abb8c6', fontSize: 13, lineHeight: 1.75 }}>
                    {t.welcomeWebMcpDialogLead}
                </p>

                <div style={{ display: 'grid', gap: 9, marginTop: 22 }}>
                    <InfoStep icon={<IconCode size={16} color="#38bdf8" />} title={t.welcomeWebMcpStep1Title} body={t.welcomeWebMcpStep1Body} />
                    <InfoStep icon={<IconGlobe size={16} color="#2ed573" />} title={t.welcomeWebMcpStep2Title} body={t.welcomeWebMcpStep2Body} />
                    <InfoStep icon={<IconSparkles size={16} color="#f59e0b" />} title={t.welcomeWebMcpStep3Title} body={t.welcomeWebMcpStep3Body} />
                </div>

                <div style={{ marginTop: 18, padding: '12px 14px', color: '#d5dde6', background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.22)', borderRadius: 8, fontSize: 11.5, lineHeight: 1.65 }}>
                    {t.welcomeWebMcpHowTo}
                </div>
                <div style={{ marginTop: 13, color: '#8395a7', fontSize: 10.5, lineHeight: 1.6 }}>
                    {t.welcomeWebMcpNote}
                </div>
                <div style={{ marginTop: 12, color: '#abb8c6', fontSize: 11, lineHeight: 1.6 }}>
                    {t.welcomeWebMcpDocs}
                    <a
                        href="https://webmachinelearning.github.io/webmcp/"
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: 'block', marginTop: 4, color: '#38bdf8', wordBreak: 'break-all' }}
                    >
                        https://webmachinelearning.github.io/webmcp/
                    </a>
                </div>
            </section>
        </div>
    );
};

const InfoStep: React.FC<{ icon: React.ReactNode; title: string; body: string }> = ({ icon, title, body }) => (
    <div style={{ display: 'flex', gap: 11, padding: '12px 13px', background: 'rgba(13,16,23,0.72)', border: '1px solid #232d3d', borderRadius: 8 }}>
        <div style={{ flex: '0 0 auto', display: 'grid', placeItems: 'center', width: 28, height: 28, background: 'rgba(35,45,61,0.72)', borderRadius: 7 }}>{icon}</div>
        <div>
            <div style={{ color: '#e8ebf0', fontSize: 12, fontWeight: 900 }}>{title}</div>
            <div style={{ marginTop: 3, color: '#8395a7', fontSize: 10.5, lineHeight: 1.55 }}>{body}</div>
        </div>
    </div>
);
