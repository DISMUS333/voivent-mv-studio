import React, { useState } from 'react';
import { IconPiano, IconPlugin, IconSynth, IconZap } from './Icons';

interface InstrumentBrowserProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenVirtualAnalog: () => void;
    onOpenIntervalSequencer?: () => void;
    onOpenVoiceChanger?: () => void;
}

export const InstrumentBrowser: React.FC<InstrumentBrowserProps> = ({
    isOpen,
    onClose,
    onOpenVirtualAnalog,
    onOpenIntervalSequencer,
    onOpenVoiceChanger,
}) => {
    const [category, setCategory] = useState<'instrument' | 'effect' | 'loop' | 'file'>('instrument');

    if (!isOpen) return null;

    return (
        <aside
            style={{
                position: 'fixed',
                top: 72,
                right: 12,
                bottom: 12,
                width: 286,
                zIndex: 80,
                display: 'flex',
                flexDirection: 'column',
                background: '#171b24',
                border: '1px solid #39465a',
                borderRadius: 10,
                boxShadow: '0 18px 50px rgba(0, 0, 0, 0.55)',
                overflow: 'hidden',
            }}
            aria-label="ブラウザ"
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #2d3748' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f1f5f9', fontSize: 13, fontWeight: 900 }}>
                    {category === 'effect' ? <IconPlugin size={16} color="#70a1ff" /> : <IconPiano size={16} color="#70a1ff" />}
                    <span>{category === 'instrument' ? 'インストゥルメント' : category === 'effect' ? 'エフェクト' : category === 'loop' ? 'ループ' : 'ファイル'}</span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                    aria-label="インストゥルメントブラウザを閉じる"
                >
                    ×
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #2d3748', background: '#12161e' }}>
                {([
                    ['instrument', '音源'],
                    ['effect', 'エフェクト'],
                    ['loop', 'ループ'],
                    ['file', 'ファイル'],
                ] as const).map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => setCategory(value)}
                        style={{
                            border: 0,
                            borderBottom: category === value ? '2px solid #70a1ff' : '2px solid transparent',
                            background: category === value ? '#202a3a' : 'transparent',
                            color: category === value ? '#f8fafc' : '#718096',
                            padding: '9px 2px 8px',
                            cursor: 'pointer',
                            fontSize: 10,
                            fontWeight: 800,
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div style={{ padding: '14px 12px', overflowY: 'auto' }}>
                {category === 'instrument' && <>
                    <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '1.2px', marginBottom: 8 }}>
                        内蔵音源 ＆ シーケンサー
                    </div>

                    {/* ⚡️ インターバル・シーケンス・エディタ */}
                    <button
                        type="button"
                        onClick={onOpenIntervalSequencer}
                        title="クリックで開く。度数グリッドで耳からリフを作成。"
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '11px 10px',
                            marginBottom: 8,
                            textAlign: 'left',
                            color: '#f8fafc',
                            background: '#1a2736',
                            border: '1px solid #0284c7',
                            borderRadius: 7,
                            cursor: 'pointer',
                        }}
                    >
                        <span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', background: '#0284c7', borderRadius: 6 }}>
                            <IconZap size={17} color="#ffffff" />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 900, color: '#38bdf8' }}>インターバル・シーケンサー</span>
                            <span style={{ color: '#aebaca', fontSize: 10 }}>度数グリッド ＆ ADSR音作り</span>
                        </span>
                    </button>

                    <button
                        type="button"
                        draggable
                        onDoubleClick={onOpenVirtualAnalog}
                        onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'copy';
                            e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'virtual-analog' }));
                        }}
                        title="ダブルクリックで開く。トラックへドラッグして配置。"
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '11px 10px',
                            textAlign: 'left',
                            color: '#f8fafc',
                            background: '#222a36',
                            border: '1px solid #c73545',
                            borderRadius: 7,
                            cursor: 'grab',
                        }}
                    >
                        <span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', background: '#a92739', borderRadius: 6, boxShadow: 'inset 0 1px rgba(255,255,255,.16)' }}>
                            <IconSynth size={17} color="#ffd8dc" />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 900 }}>VAシンセ</span>
                            <span style={{ color: '#aebaca', fontSize: 10 }}>2オシレーター・ポリフォニック</span>
                        </span>
                    </button>

                    <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '1.2px', margin: '22px 0 8px' }}>
                        ボイス音源
                    </div>
                    <div style={{ padding: '12px 10px', color: '#718096', background: '#12161e', border: '1px dashed #354052', borderRadius: 7, fontSize: 11, lineHeight: 1.5 }}>
                        録音したボイス音源は、下部の既存音源欄から引き続き利用できます。
                    </div>
                </>}

                {category === 'effect' && <>
                    <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '1.2px', marginBottom: 8 }}>
                        音声プロセッサー
                    </div>
                    <button
                        type="button"
                        draggable
                        onDoubleClick={onOpenVoiceChanger}
                        onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'copy';
                            e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'voice-changer' }));
                        }}
                        title="トラックへドラッグして追加。ダブルクリックでFXチェーンを開く。"
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 10px', textAlign: 'left', color: '#f8fafc', background: '#222a36', border: '1px solid #4c7dce', borderRadius: 7, cursor: 'grab' }}
                    >
                        <span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', background: '#315a9a', borderRadius: 6 }}>
                            <IconPlugin size={17} color="#d9e8ff" />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 900 }}>ボイスチェンジャー</span>
                            <span style={{ color: '#aebaca', fontSize: 10 }}>リアルタイム音声プロセッサー</span>
                        </span>
                    </button>
                </>}

                {(category === 'loop' || category === 'file') && (
                    <div style={{ padding: '18px 12px', color: '#718096', background: '#12161e', border: '1px dashed #354052', borderRadius: 7, fontSize: 11, lineHeight: 1.5, textAlign: 'center' }}>
                        このカテゴリは準備中です。
                    </div>
                )}
            </div>
        </aside>
    );
};