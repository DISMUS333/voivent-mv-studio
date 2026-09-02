import React, { useState, useEffect } from 'react';
import { IconMic, IconPiano } from './Icons';

export interface AddTrackOptions {
    name: string;
    count: number;
    color: string;
    isStereo: boolean;
    inputType: 'audio' | 'midi';
}

interface AddTrackModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (options: AddTrackOptions) => void;
    currentTrackCount: number;
}

const PRESET_COLORS = [
    '#3468eb', '#ff4757', '#2ed573', '#ffa502', '#9b59b6', '#1abc9c', '#e056fd', '#00cec9'
];

export const AddTrackModal: React.FC<AddTrackModalProps> = ({
    isOpen,
    onClose,
    onAdd,
    currentTrackCount,
}) => {
    const [name, setName] = useState('Track');
    const [count, setCount] = useState(1);
    const [color, setColor] = useState('#3468eb');
    const [isStereo, setIsStereo] = useState(true);
    const [inputType, setInputType] = useState<'audio' | 'midi'>('audio');

    useEffect(() => {
        if (isOpen) {
            const nextIdx = currentTrackCount + 1;
            setName(`Track ${nextIdx}`);
            setCount(1);
            setIsStereo(true);
            setInputType('audio');
            setColor(PRESET_COLORS[(nextIdx - 1) % PRESET_COLORS.length]);
        }
    }, [isOpen, currentTrackCount]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        onAdd({
            name: name.trim() || `Track ${currentTrackCount + 1}`,
            count: Math.max(1, Math.min(16, count)),
            color,
            isStereo,
            inputType,
        });
        onClose();
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.65)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    width: 400,
                    background: '#1e222b',
                    borderRadius: 10,
                    border: '1px solid #3d4554',
                    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    color: '#e2e8f0',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* 🔴 タイトルバー（macOS風ウィンドウヘッダー） */}
                <div
                    style={{
                        height: 38,
                        background: '#161920',
                        borderBottom: '1px solid #2d3340',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 12px',
                    }}
                >
                    <div style={{ display: 'flex', gap: 6 }}>
                        <div
                            onClick={onClose}
                            style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f56', cursor: 'pointer' }}
                        />
                        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ffbd2e' }} />
                        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#27c93f' }} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#c8d6e5' }}>
                        トラックを追加
                    </div>
                    <div style={{ width: 40 }} />
                </div>

                {/* 📝 フォーム詳細設定エリア */}
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* トラック名 */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: 84, fontSize: 12, fontWeight: 700, color: '#c8d6e5' }}>名前</span>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
                            autoFocus
                            style={{
                                flex: 1,
                                height: 32,
                                background: '#11141a',
                                border: '1px solid #3d7eff',
                                borderRadius: 4,
                                color: '#ffffff',
                                fontSize: 12,
                                fontWeight: 600,
                                padding: '0 10px',
                                outline: 'none',
                                boxShadow: '0 0 8px rgba(61, 126, 255, 0.4)',
                            }}
                        />
                    </div>

                    {/* 追加するトラック数 */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: 84, fontSize: 12, fontWeight: 700, color: '#c8d6e5' }}>トラック数</span>
                        <input
                            type="number"
                            min={1}
                            max={16}
                            value={count}
                            onChange={(e) => setCount(Math.max(1, Math.min(16, parseInt(e.target.value) || 1)))}
                            style={{
                                width: 80,
                                height: 30,
                                background: '#11141a',
                                border: '1px solid #384252',
                                borderRadius: 4,
                                color: '#ffffff',
                                fontSize: 12,
                                fontWeight: 700,
                                textAlign: 'center',
                                outline: 'none',
                            }}
                        />
                        <span style={{ marginLeft: 8, fontSize: 11, color: '#8395a7' }}>トラック</span>
                    </div>

                    {/* 🎙️ / 🎹 トラックタイプ（オーディオ / シンセ） */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: 84, fontSize: 12, fontWeight: 700, color: '#c8d6e5' }}>タイプ</span>
                        <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                            <button
                                type="button"
                                onClick={() => setInputType('audio')}
                                style={{
                                    flex: 1,
                                    height: 30,
                                    background: inputType === 'audio' ? '#2752b8' : '#13161c',
                                    border: inputType === 'audio' ? '1px solid #3d7eff' : '1px solid #2d3340',
                                    borderRadius: 4,
                                    color: inputType === 'audio' ? '#ffffff' : '#8395a7',
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 5,
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                <IconMic size={13} color={inputType === 'audio' ? '#ffffff' : '#8395a7'} />
                                <span>オーディオ (マイク)</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setInputType('midi')}
                                style={{
                                    flex: 1,
                                    height: 30,
                                    background: inputType === 'midi' ? '#2752b8' : '#13161c',
                                    border: inputType === 'midi' ? '1px solid #3d7eff' : '1px solid #2d3340',
                                    borderRadius: 4,
                                    color: inputType === 'midi' ? '#ffffff' : '#8395a7',
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 5,
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                <IconPiano size={13} color={inputType === 'midi' ? '#ffffff' : '#8395a7'} />
                                <span>シンセ (MIDI)</span>
                            </button>
                        </div>
                    </div>

                    {/* 🎚️ フォーマット（ステレオ / モノラル） */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: 84, fontSize: 12, fontWeight: 700, color: '#c8d6e5' }}>フォーマット</span>
                        <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                            <button
                                type="button"
                                onClick={() => setIsStereo(true)}
                                style={{
                                    flex: 1,
                                    height: 30,
                                    background: isStereo ? '#2752b8' : '#13161c',
                                    border: isStereo ? '1px solid #3d7eff' : '1px solid #2d3340',
                                    borderRadius: 4,
                                    color: isStereo ? '#ffffff' : '#8395a7',
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                ステレオ (Stereo)
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsStereo(false)}
                                style={{
                                    flex: 1,
                                    height: 30,
                                    background: !isStereo ? '#2752b8' : '#13161c',
                                    border: !isStereo ? '1px solid #3d7eff' : '1px solid #2d3340',
                                    borderRadius: 4,
                                    color: !isStereo ? '#ffffff' : '#8395a7',
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                モノラル (Mono)
                            </button>
                        </div>
                    </div>

                    {/* カラーパレット */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: 84, fontSize: 12, fontWeight: 700, color: '#c8d6e5' }}>カラー</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                            <div
                                style={{
                                    flex: 1,
                                    height: 28,
                                    background: color,
                                    borderRadius: 4,
                                    border: '1px solid rgba(255, 255, 255, 0.3)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0 6px',
                                    gap: 6,
                                }}
                            >
                                {PRESET_COLORS.map((c) => (
                                    <div
                                        key={c}
                                        onClick={() => setColor(c)}
                                        style={{
                                            width: 14,
                                            height: 14,
                                            borderRadius: 2,
                                            background: c,
                                            cursor: 'pointer',
                                            border: color === c ? '1.5px solid #ffffff' : '1px solid rgba(0,0,0,0.5)',
                                            boxShadow: color === c ? '0 0 6px rgba(255,255,255,0.8)' : 'none',
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 🏁 フッター（キャンセル / OK ボタン） */}
                <div
                    style={{
                        height: 52,
                        background: '#161920',
                        borderTop: '1px solid #2d3340',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        padding: '0 20px',
                        gap: 12,
                    }}
                >
                    <button
                        onClick={onClose}
                        style={{
                            height: 30,
                            padding: '0 18px',
                            background: '#2b303c',
                            border: '1px solid #3d4554',
                            borderRadius: 4,
                            color: '#c8d6e5',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={handleConfirm}
                        style={{
                            height: 30,
                            padding: '0 24px',
                            background: '#2752b8',
                            border: '1px solid #3d7eff',
                            borderRadius: 4,
                            color: '#ffffff',
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(39, 82, 184, 0.5)',
                        }}
                    >
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
};
