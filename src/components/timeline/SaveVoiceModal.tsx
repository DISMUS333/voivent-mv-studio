// クリップ歌声を名前付きでボイスライブラリへ保存するモーダル。
import { useState } from 'react';

import { IconMic, IconSparkles } from '../Icons';

export function SaveVoiceModal(props: {
    track: number;
    clip: number;
    defaultName: string;
    onAssignClipToSynth?: (track: number, clip: number, name?: string) => void;
    onClose: () => void;
}) {
    const {
        track,
        clip,
        defaultName,
        onAssignClipToSynth,
        onClose,
    } = props;

    const [customVoiceName, setCustomVoiceName] = useState('');

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 99999,
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: '#161922',
                    border: '1px solid #3d4b66',
                    borderRadius: 12,
                    padding: '20px 24px',
                    width: 360,
                    maxWidth: '90vw',
                    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.9), 0 0 24px rgba(112, 161, 255, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ background: 'rgba(112, 161, 255, 0.15)', padding: 8, borderRadius: 8 }}>
                        <IconMic size={20} color="#70a1ff" />
                    </div>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#f1f2f6' }}>
                            声シンセ音源として保存
                        </div>
                        <div style={{ fontSize: 11, color: '#a4b0be' }}>
                            このクリップの歌声を音源ライブラリに追加します
                        </div>
                    </div>
                </div>

                <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#747d8c', display: 'block', marginBottom: 6 }}>
                        音源の名前 (Voice Name)
                    </label>
                    <input
                        type="text"
                        autoFocus
                        value={customVoiceName}
                        onChange={(e) => setCustomVoiceName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const finalName = customVoiceName.trim() || defaultName;
                                onAssignClipToSynth?.(track, clip, finalName);
                                onClose();
                            } else if (e.key === 'Escape') {
                                onClose();
                            }
                        }}
                        placeholder="例: メインボーカル, コーラスA"
                        style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            background: '#0d1017',
                            border: '1px solid #3d4b66',
                            borderRadius: 6,
                            padding: '9px 12px',
                            color: '#ffffff',
                            fontSize: 13,
                            fontWeight: 700,
                            outline: 'none',
                        }}
                    />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: '1px solid #3d4a5d',
                            borderRadius: 6,
                            padding: '7px 14px',
                            color: '#a4b0be',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={() => {
                            const finalName = customVoiceName.trim() || defaultName;
                            onAssignClipToSynth?.(track, clip, finalName);
                            onClose();
                        }}
                        style={{
                            background: 'linear-gradient(135deg, #70a1ff 0%, #3742fa 100%)',
                            border: 'none',
                            borderRadius: 6,
                            padding: '7px 16px',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        <IconSparkles size={13} color="#ffffff" />
                        <span>保存して音源化</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
