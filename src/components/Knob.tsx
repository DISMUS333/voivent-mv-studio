//==============================================================================
// シンセのパラメータ調整用ノブ（range スライダー ＋ 直接数値入力）。
// スライダー操作＆数値クリックで直接タイプ入力可能。
//==============================================================================
import React, { useState, useEffect } from 'react';

export function Knob({
    label,
    subLabel,
    hint,
    value,
    min,
    max,
    step,
    format,
    onChange,
    accent,
}: {
    label: string;
    subLabel?: string;
    hint?: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format?: (v: number) => string;
    onChange: (v: number) => void;
    accent?: string;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [inputText, setInputText] = useState('');

    const formattedValue = format ? format(value) : value.toFixed(2);

    const startEditing = () => {
        // % 表示のノブ（Sustain, Gain）は 0〜100 で入力しやすくする
        if (formattedValue.endsWith('%')) {
            setInputText(String(Math.round(value * 100)));
        } else if (formattedValue.endsWith('Hz')) {
            setInputText(String(Math.round(value)));
        } else if (formattedValue.endsWith('s')) {
            setInputText(String(Number(value.toFixed(4))));
        } else {
            setInputText(String(value));
        }
        setIsEditing(true);
    };

    const commitEdit = () => {
        let text = inputText.trim().toLowerCase();
        if (text) {
            // 'k' 単位対応 (例: 18k -> 18000)
            let multiplier = 1;
            if (text.endsWith('k')) {
                multiplier = 1000;
                text = text.slice(0, -1);
            } else if (text.endsWith('hz') || text.endsWith('s')) {
                text = text.replace(/[^0-9.-]/g, '');
            } else if (text.endsWith('%')) {
                text = text.replace('%', '');
                multiplier = 0.01;
            }

            let num = parseFloat(text);
            if (!isNaN(num)) {
                num *= multiplier;
                // % 表記の項目で 1 より大きい数字（例: 75）が入力されたら 0.75 に自動補正
                if (formattedValue.endsWith('%') && num > 1.0 && max <= 2.0 && multiplier === 1) {
                    num *= 0.01;
                }
                const clamped = Math.max(min, Math.min(max, num));
                onChange(clamped);
            }
        }
        setIsEditing(false);
    };

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                background: '#1a1e26',
                border: '1px solid #363e4d',
                borderRadius: 8,
                padding: '7px 8px',
                position: 'relative',
            }}
            title={hint ? `${label} (${subLabel || ''}): ${hint}` : undefined}
        >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <span style={{ fontSize: 11, color: '#f1f2f6', fontWeight: 900, letterSpacing: '0.5px' }}>
                    {label}
                </span>
                {subLabel && (
                    <span style={{ fontSize: 8.5, color: '#8395a7', fontWeight: 700 }}>
                        {subLabel}
                    </span>
                )}
            </div>

            {/* スライダー */}
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                style={{
                    width: '100%',
                    height: 6,
                    accentColor: accent ?? '#3ddc84',
                    cursor: 'pointer',
                }}
            />

            {/* 直接数値入力／バッジ */}
            {isEditing ? (
                <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') setIsEditing(false);
                    }}
                    autoFocus
                    style={{
                        width: '80%',
                        fontSize: 12,
                        color: '#ffffff',
                        fontWeight: 800,
                        fontFamily: 'monospace',
                        background: '#0a0d13',
                        padding: '2px 4px',
                        borderRadius: 4,
                        border: `1px solid ${accent ?? '#3ddc84'}`,
                        textAlign: 'center',
                        outline: 'none',
                        boxShadow: `0 0 6px ${accent ?? 'rgba(61, 220, 132, 0.4)'}`,
                    }}
                />
            ) : (
                <div
                    onClick={startEditing}
                    style={{
                        fontSize: 12,
                        color: '#ffffff',
                        fontWeight: 700,
                        fontFamily: 'monospace',
                        background: '#11141a',
                        padding: '2px 8px',
                        borderRadius: 4,
                        border: '1px solid #282f3d',
                        cursor: 'text',
                        userSelect: 'none',
                        transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = accent ?? '#3ddc84';
                        e.currentTarget.style.color = accent ?? '#3ddc84';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#282f3d';
                        e.currentTarget.style.color = '#ffffff';
                    }}
                    title="クリックして数値を直接入力"
                >
                    {formattedValue}
                </div>
            )}
        </div>
    );
}
