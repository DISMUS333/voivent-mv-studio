import React, { useEffect, useRef, useState } from 'react';
import { native } from '../native';
import type { VoiceChangerParams, VoiceChangerPreset } from '../types';
import { FloatingWindow } from './FloatingWindow';
import { IconMic } from './Icons';

export type { VoiceChangerParams, VoiceChangerPreset };

const fallbackPresetNames = ['DEEP VOICE (ディープボイス)'];

const defaults: VoiceChangerParams = { mutation: 0.0, pitch: -0.35, machine: 0, distortion: 0.05, space: 0.05, mix: 1, output: 0.90 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const buttonStyle: React.CSSProperties = {
    border: '1px solid #4f7282',
    borderRadius: 4,
    background: '#142633',
    color: '#b9e6f6',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 800,
};

function Dial({ label, value, min, max, step, onChange, format = (v) => v.toFixed(2) }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; format?: (value: number) => string }) {
    const start = useRef<{ y: number; value: number } | null>(null);
    const ratio = clamp((value - min) / (max - min), 0, 1);
    const update = (y: number) => {
        if (!start.current) return;
        const next = clamp(start.current.value + (start.current.y - y) / 300 * (max - min), min, max);
        onChange(Number((min + Math.round((next - min) / step) * step).toFixed(4)));
    };
    return (
        <div style={{ display: 'grid', justifyItems: 'center', gap: 5, minWidth: 80 }}>
            <strong style={{ fontSize: 9.5, letterSpacing: 0.8, color: '#8db7cc' }}>{label}</strong>
            <div
                onWheel={(e) => { e.preventDefault(); onChange(Number(clamp(value + (e.deltaY < 0 ? step : -step), min, max).toFixed(4))); }}
                onPointerDown={(e) => { start.current = { y: e.clientY, value }; e.currentTarget.setPointerCapture(e.pointerId); }}
                onPointerMove={(e) => update(e.clientY)}
                onPointerUp={() => { start.current = null; }}
                onPointerCancel={() => { start.current = null; }}
                style={{
                    width: 54,
                    height: 54,
                    borderRadius: '50%',
                    background: `conic-gradient(from 225deg, #6ee7f5 ${ratio * 270}deg, #1d3440 ${ratio * 270}deg 270deg, transparent 270deg)`,
                    cursor: 'ns-resize',
                    touchAction: 'none',
                    padding: 4,
                    boxSizing: 'border-box',
                }}
            >
                <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: '#0a1218', border: '1px solid #5d8796', position: 'relative' }}>
                    <i style={{ position: 'absolute', left: '50%', top: 4, width: 2, height: 16, background: '#8df3ff', transformOrigin: '50% 22px', transform: `translateX(-50%) rotate(${-135 + ratio * 270}deg)` }} />
                </div>
            </div>
            <span style={{ color: '#7ff1ff', fontSize: 10.5, fontWeight: 700 }}>{format(value)}</span>
        </div>
    );
}

export const VoiceChangerEditor: React.FC<{ trackIndex: number; trackName?: string; onClose: () => void }> = ({ trackIndex, trackName, onClose }) => {
    const [params, setParams] = useState(defaults);
    const [enabled, setEnabled] = useState(false);
    const [presets, setPresets] = useState<VoiceChangerPreset[]>([]);
    const [presetIndex, setPresetIndex] = useState(-1);
    const [presetName, setPresetName] = useState('');
    const [peak, setPeak] = useState(0);

    useEffect(() => {
        void native.getVoiceChangerState(trackIndex).then((state) => {
            const item = state as { enabled?: boolean; params?: Partial<VoiceChangerParams> };
            if (item.params) setParams((current) => ({ ...current, ...item.params }));
            if (typeof item.enabled === 'boolean') {
                setEnabled(item.enabled);
            }
        }).catch(() => undefined);
        void native.getVoiceChangerPresets().then((items) => {
            if (Array.isArray(items)) {
                setPresets((items as VoiceChangerPreset[]).map((preset, index) => ({
                    ...preset,
                    name: index < fallbackPresetNames.length ? fallbackPresetNames[index] : (preset.name || `プリセット ${index + 1}`),
                })));
            }
        }).catch(() => undefined);
        const timer = window.setInterval(() => {
            void native.getStatus().then((status) => {
                const value = status as { audioInputPeak?: number };
                setPeak(clamp(Number(value.audioInputPeak) || 0, 0, 1));
            }).catch(() => undefined);
        }, 80);
        return () => window.clearInterval(timer);
    }, [trackIndex]);

    const update = <K extends keyof VoiceChangerParams>(key: K, value: VoiceChangerParams[K]) => setParams((current) => { const next = { ...current, [key]: value }; void native.setVoiceChangerParams(next, trackIndex); return next; });
    const toggle = () => setEnabled((current) => { const next = !current; void native.setVoiceChangerEnabled(next, trackIndex); return next; });
    const loadPreset = async (index: number) => { if (index < 0 || !presets[index] || !(await native.loadVoiceChangerPreset(index, trackIndex))) return; setParams(presets[index].params); setPresetIndex(index); setEnabled(true); };
    const savePreset = async () => { const index = await native.saveVoiceChangerPreset(presetName.trim() || `声加工 ${presets.length + 1}`, trackIndex); const items = await native.getVoiceChangerPresets(); if (Array.isArray(items)) setPresets(items as VoiceChangerPreset[]); setPresetIndex(index); setPresetName(''); };
    const deletePreset = async () => { if (presetIndex < 0 || !(await native.deleteVoiceChangerPreset(presetIndex))) return; const items = await native.getVoiceChangerPresets(); if (Array.isArray(items)) setPresets(items as VoiceChangerPreset[]); setPresetIndex(-1); };

    const dials: Array<{ key: keyof VoiceChangerParams; label: string; min: number; max: number; step: number; format?: (v: number) => string }> = [
        { key: 'mutation', label: 'MUTATION', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
        { key: 'pitch', label: 'PITCH', min: -1, max: 1, step: 0.01, format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}` },
        { key: 'machine', label: 'MACHINE', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
        { key: 'distortion', label: 'DRIVE', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
        { key: 'space', label: 'SPACE', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
        { key: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
        { key: 'output', label: 'OUTPUT', min: 0, max: 1, step: 0.01, format: (v) => `${v.toFixed(2)}x` },
    ];

    return (
        <FloatingWindow
            title={`VOICE CHANGER - ${trackName || `Track ${trackIndex + 1}`}`}
            icon={<IconMic size={14} color="#6ee7f5" />}
            isOpen={true}
            onClose={onClose}
            initialWidth={680}
            initialHeight={420}
            minWidth={520}
            minHeight={360}
            zIndex={1200}
            headerRight={
                <button
                    style={{
                        ...buttonStyle,
                        background: enabled ? '#164b59' : '#15202a',
                        color: enabled ? '#82f5ff' : '#70818a',
                        padding: '3px 10px',
                        fontSize: 10,
                    }}
                    onClick={toggle}
                >
                    {enabled ? '● 有効 (ON)' : '○ バイパス (OFF)'}
                </button>
            }
        >
            <div style={{ padding: 16, display: 'grid', gap: 14, color: '#b9d6e5', fontFamily: 'sans-serif' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '6px 10px', borderRadius: 6, border: '1px solid #233745' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#82cbd8' }}>マイク入力レベル</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#091217', overflow: 'hidden', border: '1px solid #456979' }}>
                        <div style={{ height: '100%', width: `${peak * 100}%`, background: peak > 0.85 ? '#ff4757' : '#2ed573', transition: 'width 60ms linear' }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#82cbd8', fontWeight: 800 }}>{Math.round(peak * 100)}%</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 16, background: '#0e1720', border: '1px solid #233745', borderRadius: 8, padding: '12px 6px' }}>
                    {dials.map((dial) => {
                        const { key, ...dialProps } = dial;
                        return <Dial key={key} {...dialProps} value={params[key]} onChange={(value) => update(key, value)} />;
                    })}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', borderTop: '1px solid #233745', paddingTop: 10 }}>
                    <select value={presetIndex} onChange={(e) => void loadPreset(Number(e.target.value))} style={{ ...buttonStyle, minWidth: 160 }}>
                        <option value={-1}>プリセットを選択</option>
                        {presets.map((preset, index) => <option key={`${preset.name}-${index}`} value={index}>{preset.name}</option>)}
                    </select>
                    <button style={buttonStyle} onClick={() => void loadPreset(presetIndex)} disabled={presetIndex < 0}>読込</button>
                    <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="新規プリセット名" style={{ ...buttonStyle, width: 140 }} />
                    <button style={buttonStyle} onClick={() => void savePreset()}>保存</button>
                    <button style={{ ...buttonStyle, color: '#ff9aa8' }} onClick={() => void deletePreset()} disabled={presetIndex < 0}>削除</button>
                </div>
            </div>
        </FloatingWindow>
    );
};