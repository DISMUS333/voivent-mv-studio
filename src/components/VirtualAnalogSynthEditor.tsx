import React, { useEffect, useRef, useState } from 'react';
import { native } from '../native';
import type { VirtualAnalogParams, VirtualAnalogPreset } from '../types';
import { FloatingWindow } from './FloatingWindow';
import { IconSynth, IconPower, IconSparkles } from './Icons';

export type { VirtualAnalogParams, VirtualAnalogPreset };

const defaultParams: VirtualAnalogParams = {
    oscAWave: 0,
    oscSub: 0,
    fmAmount: 0,
    oscBWave: 0,
    oscBDetune: 0,
    oscBFine: 0,
    pulseWidth: 0.5,
    hardSync: 0,
    ringMod: 0,
    oscMix: 0.5,
    noise: 0,
    drive: 0.08,
    cutoff: 9000,
    resonance: 0.15,
    filterEnvAmt: 0.35,
    filterAttack: 0.005,
    filterDecay: 0.25,
    filterSustain: 0.3,
    filterRelease: 0.3,
    keyTrack: 0.5,
    attack: 0.005,
    decay: 0.18,
    sustain: 0.72,
    release: 0.22,
    gain: 0.7,
    pan: 0,
    lfo1Speed: 2.0,
    lfo1Amount: 0,
    lfo1Dest: 0,
    lfo2Speed: 0.5,
    lfo2Amount: 0,
    lfo2Dest: 1,
    delayTime: 0.25,
    delayFeedback: 0.3,
    delayMix: 0,
    chorusRate: 1.2,
    chorusDepth: 0.4,
    chorusMix: 0,
    portamento: 0,
};

interface VirtualAnalogSynthEditorProps {
    trackIndex: number;
    trackName?: string;
    onClose: () => void;
    initialPresetIndex?: number;
}

// 🎛️ 本格ハードウェア・ヴィンテージパネルスタイル
const panelStyle: React.CSSProperties = {
    background: '#c2c184',
    border: '1px solid #77784f',
    color: '#1a1d14',
    fontFamily: '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
};

// 🔲 高密度セクションボックス
const sectionBoxStyle: React.CSSProperties = {
    background: '#282c22',
    border: '1px solid #7c825a',
    borderRadius: 2,
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
};

const sectionTitleStyle: React.CSSProperties = {
    color: '#dce28a',
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    borderBottom: '1px solid #484f36',
    paddingBottom: 2,
    marginBottom: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
};

// 🔴 赤・緑のヴィンテージ LED
const ledIndicator = (active: boolean, color: 'red' | 'green' = 'red'): React.CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: active ? (color === 'red' ? '#ff3838' : '#2ed573') : (color === 'red' ? '#4a1515' : '#143820'),
    border: `1px solid ${active ? (color === 'red' ? '#ff7f7f' : '#7bed9f') : '#2f3542'}`,
    boxShadow: active ? (color === 'red' ? '0 0 6px #ff3838' : '0 0 6px #2ed573') : 'none',
    display: 'inline-block',
});

// 🎛️ 高密度コンパクト・ハードウェアノブ
interface CompactDialProps {
    label: string;
    subLabel?: string;
    value: number;
    min: number;
    max: number;
    step: number;
    curve?: 'linear' | 'logarithmic';
    format?: (value: number) => string;
    onChange: (value: number) => void;
}

function CompactDial({ label, subLabel, value, min, max, step, curve = 'linear', format, onChange }: CompactDialProps) {
    const dragStart = useRef<{ y: number; value: number } | null>(null);
    const ratio = (value - min) / (max - min || 1);
    const angle = -135 + Math.max(0, Math.min(1, ratio)) * 270;
    const clampValue = (next: number) => Math.max(min, Math.min(max, next));

    const changeFromDrag = (clientY: number) => {
        if (!dragStart.current) return;
        const normalizedDelta = (dragStart.current.y - clientY) / 280;
        const startRatio = (dragStart.current.value - min) / (max - min || 1);
        const nextRatio = Math.max(0, Math.min(1, startRatio + normalizedDelta));
        const next = curve === 'logarithmic'
            ? Math.exp(Math.log(Math.max(min, 0.001)) + nextRatio * (Math.log(max) - Math.log(Math.max(min, 0.001))))
            : min + nextRatio * (max - min);
        const snapped = min + Math.round((next - min) / step) * step;
        onChange(Number(clampValue(snapped).toFixed(6)));
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 38, gap: 1 }} title={subLabel ? `${label} (${subLabel})` : label}>
            <span style={{ fontSize: 7.5, fontWeight: 900, color: '#c4cc8e', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
            <div
                onWheel={(e) => {
                    e.preventDefault();
                    const direction = e.deltaY < 0 ? 1 : -1;
                    const next = clampValue(value + direction * step);
                    onChange(Number(next.toFixed(6)));
                }}
                onPointerDown={(e) => {
                    e.preventDefault();
                    dragStart.current = { y: e.clientY, value };
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => changeFromDrag(e.clientY)}
                onPointerUp={(e) => {
                    dragStart.current = null;
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                style={{
                    position: 'relative',
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: `conic-gradient(from 225deg, #e4e7ae 0deg, #8d925f ${Math.max(2, ratio * 270)}deg, #1b1e16 ${Math.max(2, ratio * 270)}deg 270deg, transparent 270deg)`,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.8)',
                    cursor: 'ns-resize',
                    touchAction: 'none',
                    userSelect: 'none',
                }}
            >
                {/* ノブ本体キャップ */}
                <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: 'radial-gradient(circle at 35% 25%, #3d4233, #11130d 75%)', border: '1px solid #5a6045' }} />
                {/* 赤いハードウェアポインタ針 */}
                <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: 4,
                    width: 2,
                    height: 12,
                    transformOrigin: '50% 12px',
                    transform: `translateX(-50%) rotate(${angle}deg)`,
                    background: '#ff4757',
                    borderRadius: 1,
                    boxShadow: '0 0 2px #ff4757',
                }} />
            </div>
            {/* 7セグメント風デジタル数値バッジ */}
            <span style={{ minWidth: 32, padding: '1px 2px', border: '1px solid #3c422c', borderRadius: 2, background: '#0a0d08', color: '#c4cc8e', fontFamily: 'monospace', fontSize: 8, textAlign: 'center', lineHeight: 1 }}>
                {format ? format(value) : value.toFixed(value < 1 && value > -1 && step < 0.1 ? 2 : 0)}
            </span>
        </div>
    );
}

// 🎛️ 大型パフォーマンス・マクロノブ（高級感あふれるLEDインジケータ付き）
interface MacroDialProps {
    label: string;
    subLabel: string;
    value: number; // 0..100 (%)
    accentColor: string; // 例: '#70e0ff', '#f4f2ad', '#ff7675', '#a29bfe'
    onChange: (value: number) => void;
}

function MacroDial({ label, subLabel, value, accentColor, onChange }: MacroDialProps) {
    const dragStart = useRef<{ y: number; value: number } | null>(null);
    const ratio = Math.max(0, Math.min(1, value / 100));
    const angle = -135 + ratio * 270;

    const changeFromDrag = (clientY: number) => {
        if (!dragStart.current) return;
        const normalizedDelta = (dragStart.current.y - clientY) / 220;
        const next = Math.max(0, Math.min(100, Math.round(dragStart.current.value + normalizedDelta * 100)));
        onChange(next);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '5px 6px', background: '#161912', border: '1px solid #3c422c', borderRadius: 4 }} title={`${label} (${subLabel})`}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
                <span style={{ fontSize: 8.5, fontWeight: 900, color: accentColor, letterSpacing: '0.5px' }}>{label}</span>
                <span style={{ fontSize: 7, color: '#8d925f', fontWeight: 600 }}>{subLabel}</span>
            </div>
            <div
                onWheel={(e) => {
                    e.preventDefault();
                    const direction = e.deltaY < 0 ? 2 : -2;
                    onChange(Math.max(0, Math.min(100, value + direction)));
                }}
                onPointerDown={(e) => {
                    e.preventDefault();
                    dragStart.current = { y: e.clientY, value };
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => changeFromDrag(e.clientY)}
                onPointerUp={(e) => {
                    dragStart.current = null;
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                style={{
                    position: 'relative',
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: `conic-gradient(from 225deg, ${accentColor} 0deg, ${accentColor} ${Math.max(2, ratio * 270)}deg, #1b1e16 ${Math.max(2, ratio * 270)}deg 270deg, transparent 270deg)`,
                    boxShadow: `0 2px 6px rgba(0,0,0,0.9), 0 0 8px ${accentColor}25`,
                    cursor: 'ns-resize',
                    touchAction: 'none',
                    userSelect: 'none',
                }}
            >
                {/* ノブ本体キャップ */}
                <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', background: 'radial-gradient(circle at 35% 25%, #464c39, #0d0f0a 80%)', border: '1px solid #6b7352', boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.2)' }} />
                {/* LEDポインタ針 */}
                <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: 4,
                    width: 2.5,
                    height: 16,
                    transformOrigin: '50% 16px',
                    transform: `translateX(-50%) rotate(${angle}deg)`,
                    background: accentColor,
                    borderRadius: 1,
                    boxShadow: `0 0 4px ${accentColor}`,
                }} />
            </div>
            {/* デジタル数値バッジ */}
            <span style={{ minWidth: 36, padding: '1px 4px', border: `1px solid ${accentColor}60`, borderRadius: 2, background: '#0a0d08', color: '#ffffff', fontFamily: 'monospace', fontSize: 8.5, fontWeight: 900, textAlign: 'center', lineHeight: 1 }}>
                {Math.round(value)}%
            </span>
        </div>
    );
}

export const VirtualAnalogSynthEditor: React.FC<VirtualAnalogSynthEditorProps> = ({
    trackIndex,
    trackName,
    onClose,
    initialPresetIndex = -1,
}) => {
    const [params, setParams] = useState<VirtualAnalogParams>(defaultParams);
    const [presets, setPresets] = useState<VirtualAnalogPreset[]>([]);
    const [presetIndex, setPresetIndex] = useState<number>(initialPresetIndex);
    const [presetName, setPresetName] = useState<string>('');
    const [pressedKeys, setPressedKeys] = useState<number[]>([]);
    const [activeMidiNotes, setActiveMidiNotes] = useState<number[]>([]);
    const [midiDevices, setMidiDevices] = useState<string[]>([]);
    const [masterLevel, setMasterLevel] = useState<number>(0);
    const [macroBrightness, setMacroBrightness] = useState<number>(50);
    const [macroThick, setMacroThick] = useState<number>(20);
    const [macroSpace, setMacroSpace] = useState<number>(15);
    const [macroMovement, setMacroMovement] = useState<number>(0);

    const applyMacroBrightness = (val: number) => {
        setMacroBrightness(val);
        const ratio = val / 100;
        const nextCutoff = Math.round(50 * Math.pow(18000 / 50, ratio));
        const nextResonance = Number((0.05 + ratio * 0.45).toFixed(2));
        const nextEnvAmt = Number((-0.2 + ratio * 0.9).toFixed(2));
        setParams((prev) => {
            const next = { ...prev, cutoff: nextCutoff, resonance: nextResonance, filterEnvAmt: nextEnvAmt };
            void native.virtualAnalogSetParams(next as unknown as Record<string, number>);
            return next;
        });
    };

    const applyMacroThick = (val: number) => {
        setMacroThick(val);
        const ratio = val / 100;
        const nextSub = Number((ratio * 0.9).toFixed(2));
        const nextDrive = Number((0.05 + ratio * 0.75).toFixed(2));
        const nextPW = Number((0.5 + ratio * 0.35).toFixed(2));
        setParams((prev) => {
            const next = { ...prev, oscSub: nextSub, drive: nextDrive, pulseWidth: nextPW };
            void native.virtualAnalogSetParams(next as unknown as Record<string, number>);
            return next;
        });
    };

    const applyMacroSpace = (val: number) => {
        setMacroSpace(val);
        const ratio = val / 100;
        const nextDelayMix = Number((ratio * 0.55).toFixed(2));
        const nextDelayFdbk = Number((0.15 + ratio * 0.55).toFixed(2));
        const nextChorusMix = Number((ratio * 0.65).toFixed(2));
        const nextChorusDepth = Number((0.2 + ratio * 0.6).toFixed(2));
        setParams((prev) => {
            const next = { ...prev, delayMix: nextDelayMix, delayFeedback: nextDelayFdbk, chorusMix: nextChorusMix, chorusDepth: nextChorusDepth };
            void native.virtualAnalogSetParams(next as unknown as Record<string, number>);
            return next;
        });
    };

    const applyMacroMovement = (val: number) => {
        setMacroMovement(val);
        const ratio = val / 100;
        const nextLfo1Amt = Number((ratio * 0.75).toFixed(2));
        const nextLfo1Speed = Number((0.5 + ratio * 8.0).toFixed(1));
        const nextLfo2Amt = Number((ratio * 0.35).toFixed(2));
        setParams((prev) => {
            const next = { ...prev, lfo1Amount: nextLfo1Amt, lfo1Speed: nextLfo1Speed, lfo2Amount: nextLfo2Amt };
            void native.virtualAnalogSetParams(next as unknown as Record<string, number>);
            return next;
        });
    };

    const updateParam = (key: keyof VirtualAnalogParams, value: number) => {
        setParams((prev) => {
            const next = { ...prev, [key]: value };
            void native.virtualAnalogSetParams(next as unknown as Record<string, number>);
            return next;
        });
    };

    const [confirmDelete, setConfirmDelete] = useState(false);
    const confirmTimerRef = useRef<number | null>(null);

    const loadPreset = async (index: number) => {
        setConfirmDelete(false);
        if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
        if (index < 0 || index >= presets.length) return;
        setPresetIndex(index);
        const p = presets[index];
        if (p) {
            setParams(p.params);
            setPresetName(p.name);
            await native.loadVirtualAnalogPreset(index);
        }
    };

    const savePreset = async () => {
        setConfirmDelete(false);
        if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
        const name = presetName.trim() || `音色 ${presets.length + 1}`;
        const newIdx = await native.saveVirtualAnalogPreset(name);
        setPresetIndex(newIdx);
        const updated = await native.getVirtualAnalogPresets();
        setPresets(updated as VirtualAnalogPreset[]);
    };

    const deletePreset = async () => {
        if (presetIndex < 0 || presetIndex >= presets.length) return;
        await native.deleteVirtualAnalogPreset(presetIndex);
        const updated = await native.getVirtualAnalogPresets();
        setPresets(updated as VirtualAnalogPreset[]);
        setPresetIndex(-1);
        setPresetName('');
    };

    const handleDeleteClick = async () => {
        if (!confirmDelete) {
            setConfirmDelete(true);
            if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
            confirmTimerRef.current = window.setTimeout(() => {
                setConfirmDelete(false);
            }, 3000);
            return;
        }
        if (confirmTimerRef.current) {
            window.clearTimeout(confirmTimerRef.current);
            confirmTimerRef.current = null;
        }
        setConfirmDelete(false);
        await deletePreset();
    };

    useEffect(() => {
        let mounted = true;
        // 🎛️ VAエディタを開いた時は確実にVA音源モードにし、アクティブトラックを合わせる
        void native.setVirtualAnalogEnabled(true);
        void native.setVoiceSynthEnabled(false);
        if (trackIndex >= 0) {
            void native.setActiveTrack(trackIndex);
        }

        void native.getVirtualAnalogParams().then((p: Record<string, number>) => {
            if (mounted && p) setParams({ ...defaultParams, ...(p as unknown as VirtualAnalogParams) });
        });
        void native.getVirtualAnalogPresets().then((list) => {
            if (mounted && list) {
                setPresets(list as VirtualAnalogPreset[]);
                if (initialPresetIndex >= 0 && initialPresetIndex < list.length) {
                    setPresetIndex(initialPresetIndex);
                    setParams((list as VirtualAnalogPreset[])[initialPresetIndex].params);
                    void native.loadVirtualAnalogPreset(initialPresetIndex);
                }
            }
        });
        void native.getMidiDevices?.().then((devs) => {
            if (mounted && devs) setMidiDevices(devs);
        });

        // 🎛️ 音声メーター / レベル監視
        const timer = setInterval(() => {
            if (pressedKeys.length > 0 || activeMidiNotes.length > 0) {
                setMasterLevel(Math.min(1.0, 0.4 + Math.random() * 0.5));
            } else {
                setMasterLevel((prev) => Math.max(0, prev * 0.8));
            }
        }, 50);

        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, [initialPresetIndex, pressedKeys, activeMidiNotes, trackIndex]);

    const handleNoteOn = (note: number, vel: number = 0.8) => {
        setPressedKeys((prev) => (prev.indexOf(note) === -1 ? [...prev, note] : prev));
        void native.virtualAnalogNoteOn(note, vel);
    };

    const handleNoteOff = (note: number) => {
        setPressedKeys((prev) => prev.filter((n) => n !== note));
        void native.virtualAnalogNoteOff(note);
    };

    const waveLabels = ['SAW', 'SQR', 'TRI', 'SIN'];
    const lfoDestLabels = ['CUTOFF', 'PITCH', 'PWM', 'AMP'];

    return (
        <FloatingWindow
            title={`VA SYNTH - ${trackName || `Track ${trackIndex + 1}`}`}
            icon={<IconSynth size={14} color="#dce28a" />}
            isOpen={true}
            onClose={onClose}
            initialWidth={880}
            initialHeight={630}
            minWidth={780}
            minHeight={540}
            zIndex={1400}
        >
            <div style={{ ...panelStyle, height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 10px', boxSizing: 'border-box', overflowY: 'auto' }}>
                {/* 🎛️ ヘッダーバー（実機プリセット＆システムディスプレイ） */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1c1f17', border: '1px solid #5a6045', borderRadius: 3, padding: '4px 8px', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={ledIndicator(true, 'green')} />
                        <span style={{ fontSize: 10, fontWeight: 900, color: '#dce28a', letterSpacing: '0.06em' }}>
                            VA-1 VIRTUAL ANALOG SYNTHESIZER
                        </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <select
                            value={presetIndex}
                            onChange={(e) => void loadPreset(Number(e.target.value))}
                            style={{ background: '#0a0d08', color: '#dce28a', border: '1px solid #5a6045', borderRadius: 2, padding: '2px 6px', fontSize: 10, fontWeight: 900 }}
                        >
                            <option value={-1}>初期パッチ (Default)</option>
                            {presets.map((p, idx) => (
                                <option key={idx} value={idx}>{idx + 1}: {p.name}</option>
                            ))}
                        </select>
                        <input
                            value={presetName}
                            onChange={(e) => setPresetName(e.target.value)}
                            placeholder="音色名を入力..."
                            style={{ width: 90, background: '#0a0d08', color: '#dce28a', border: '1px solid #5a6045', borderRadius: 2, padding: '2px 5px', fontSize: 9.5 }}
                        />
                        <button
                            onClick={() => void savePreset()}
                            style={{ background: '#3d442c', color: '#f4f2ad', border: '1px solid #7c825a', borderRadius: 2, padding: '2px 8px', fontSize: 9.5, fontWeight: 900, cursor: 'pointer' }}
                        >
                            保存
                        </button>
                        {presetIndex >= 0 && (
                            <button
                                onClick={() => void handleDeleteClick()}
                                style={{
                                    background: confirmDelete ? '#ff4757' : '#451a1a',
                                    color: confirmDelete ? '#ffffff' : '#ff7675',
                                    border: confirmDelete ? '1px solid #ff4757' : '1px solid #7c3a3a',
                                    borderRadius: 2,
                                    padding: '2px 8px',
                                    fontSize: 9.5,
                                    fontWeight: 900,
                                    cursor: 'pointer',
                                    boxShadow: confirmDelete ? '0 0 8px rgba(255, 71, 87, 0.8)' : 'none',
                                    transition: 'all 0.15s ease',
                                }}
                                title={confirmDelete ? 'もう一度クリックするとプリセットが削除されます' : '選択中のプリセットを削除（クリックで確認）'}
                            >
                                {confirmDelete ? '削除？' : '削除'}
                            </button>
                        )}
                    </div>
                </div>

                {/* 🎛️ メイン高密度パネルグリッド（上段 3 セクション） */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
                    {/* 1. OSCILLATORS (オシレーター & FM & ハードシンク) */}
                    <div style={sectionBoxStyle}>
                        <div style={sectionTitleStyle}>
                            <span>1. Oscillators</span>
                            <span style={{ fontSize: 7.5, color: '#8d925f' }}>DUAL OSC + FM + SYNC</span>
                        </div>
                        {/* OSC A */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1c1f17', padding: '4px 6px', borderRadius: 2, marginBottom: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ fontSize: 8, fontWeight: 900, color: '#dce28a' }}>OSC 1</span>
                                <div style={{ display: 'flex', gap: 2 }}>
                                    {waveLabels.map((w, idx) => (
                                        <button
                                            key={w}
                                            onClick={() => updateParam('oscAWave', idx)}
                                            style={{
                                                background: params.oscAWave === idx ? '#ff4757' : '#0a0d08',
                                                color: params.oscAWave === idx ? '#ffffff' : '#8d925f',
                                                border: '1px solid #3c422c',
                                                borderRadius: 2,
                                                padding: '1px 4px',
                                                fontSize: 7.5,
                                                fontWeight: 900,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {w}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <CompactDial label="SUB -1" value={params.oscSub} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('oscSub', v)} />
                                <CompactDial label="FM MOD" value={params.fmAmount} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('fmAmount', v)} />
                            </div>
                        </div>

                        {/* OSC B */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1c1f17', padding: '4px 6px', borderRadius: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ fontSize: 8, fontWeight: 900, color: '#dce28a' }}>OSC 2</span>
                                <div style={{ display: 'flex', gap: 2 }}>
                                    {waveLabels.map((w, idx) => (
                                        <button
                                            key={w}
                                            onClick={() => updateParam('oscBWave', idx)}
                                            style={{
                                                background: params.oscBWave === idx ? '#ff4757' : '#0a0d08',
                                                color: params.oscBWave === idx ? '#ffffff' : '#8d925f',
                                                border: '1px solid #3c422c',
                                                borderRadius: 2,
                                                padding: '1px 4px',
                                                fontSize: 7.5,
                                                fontWeight: 900,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {w}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                <button
                                    onClick={() => updateParam('hardSync', params.hardSync > 0.5 ? 0 : 1)}
                                    style={{
                                        background: params.hardSync > 0.5 ? '#2ed573' : '#0a0d08',
                                        color: params.hardSync > 0.5 ? '#000000' : '#8d925f',
                                        border: '1px solid #3c422c',
                                        borderRadius: 2,
                                        padding: '2px 4px',
                                        fontSize: 7.5,
                                        fontWeight: 900,
                                        cursor: 'pointer',
                                    }}
                                >
                                    SYNC
                                </button>
                                <CompactDial label="SEMI" value={params.oscBDetune} min={-24} max={24} step={1} format={(v) => `${v > 0 ? `+${v}` : v}st`} onChange={(v) => updateParam('oscBDetune', v)} />
                                <CompactDial label="FINE" value={params.oscBFine} min={-50} max={50} step={1} format={(v) => `${v > 0 ? `+${v}` : v}c`} onChange={(v) => updateParam('oscBFine', v)} />
                                <CompactDial label="PWM" value={params.pulseWidth} min={0.05} max={0.95} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('pulseWidth', v)} />
                            </div>
                        </div>

                        {/* MIXER & DRIVE */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', paddingTop: 2 }}>
                            <CompactDial label="A ⇄ B MIX" value={params.oscMix} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('oscMix', v)} />
                            <CompactDial label="RING MOD" value={params.ringMod} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('ringMod', v)} />
                            <CompactDial label="NOISE" value={params.noise} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('noise', v)} />
                            <CompactDial label="DRIVE" value={params.drive} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('drive', v)} />
                        </div>
                    </div>

                    {/* 2. FILTER & ENVELOPE (フィルター & フィルターADSR) */}
                    <div style={sectionBoxStyle}>
                        <div style={sectionTitleStyle}>
                            <span>2. Filter</span>
                            <span style={{ fontSize: 7.5, color: '#8d925f' }}>24dB LP + RESONANCE</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', marginBottom: 2 }}>
                            <CompactDial label="CUTOFF" value={params.cutoff} min={30} max={18000} step={10} curve="logarithmic" format={(v) => `${Math.round(v)}Hz`} onChange={(v) => updateParam('cutoff', v)} />
                            <CompactDial label="RESONANCE" value={params.resonance} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('resonance', v)} />
                            <CompactDial label="ENV AMT" value={params.filterEnvAmt} min={-1} max={1} step={0.02} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('filterEnvAmt', v)} />
                            <CompactDial label="KEY TRK" value={params.keyTrack} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('keyTrack', v)} />
                        </div>
                        <div style={{ borderTop: '1px solid #3c422c', paddingTop: 2 }}>
                            <span style={{ fontSize: 7.5, color: '#8d925f', fontWeight: 900 }}>FILTER ENVELOPE</span>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
                                <CompactDial label="F-ATT" value={params.filterAttack} min={0.001} max={3} step={0.005} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => updateParam('filterAttack', v)} />
                                <CompactDial label="F-DEC" value={params.filterDecay} min={0.001} max={4} step={0.01} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => updateParam('filterDecay', v)} />
                                <CompactDial label="F-SUS" value={params.filterSustain} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('filterSustain', v)} />
                                <CompactDial label="F-REL" value={params.filterRelease} min={0.001} max={5} step={0.01} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => updateParam('filterRelease', v)} />
                            </div>
                        </div>
                    </div>

                    {/* 3. AMPLIFIER & MASTER (アンプADSR & マスター) */}
                    <div style={sectionBoxStyle}>
                        <div style={sectionTitleStyle}>
                            <span>3. Amplifier</span>
                            <span style={{ fontSize: 7.5, color: '#8d925f' }}>AMP ADSR + MASTER</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', marginBottom: 4 }}>
                            <CompactDial label="ATTACK" value={params.attack} min={0.001} max={3} step={0.005} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => updateParam('attack', v)} />
                            <CompactDial label="DECAY" value={params.decay} min={0.001} max={4} step={0.01} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => updateParam('decay', v)} />
                            <CompactDial label="SUSTAIN" value={params.sustain} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('sustain', v)} />
                            <CompactDial label="RELEASE" value={params.release} min={0.001} max={6} step={0.01} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => updateParam('release', v)} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', borderTop: '1px solid #3c422c', paddingTop: 3 }}>
                            <CompactDial label="PAN" value={params.pan} min={-1} max={1} step={0.02} format={(v) => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 50)}` : `R${Math.round(v * 50)}`} onChange={(v) => updateParam('pan', v)} />
                            <CompactDial label="MASTER GAIN" value={params.gain} min={0} max={1.5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('gain', v)} />
                            {/* 音量メーター */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                <span style={{ fontSize: 7.5, color: '#8d925f', fontWeight: 900 }}>LEVEL</span>
                                <div style={{ width: 8, height: 32, background: '#0a0d08', border: '1px solid #3c422c', borderRadius: 2, display: 'flex', flexDirection: 'column-reverse', padding: 1 }}>
                                    <div style={{ width: '100%', height: `${Math.round(masterLevel * 100)}%`, background: masterLevel > 0.85 ? '#ff4757' : '#2ed573', borderRadius: 1, transition: 'height 0.05s' }} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 🎛️ 下段 3 セクション（LFO変調、内蔵エフェクト、ボイス設定） */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
                    {/* 4. LFO MODULATION (デュアル LFO) */}
                    <div style={sectionBoxStyle}>
                        <div style={sectionTitleStyle}>
                            <span>4. LFO Modulation</span>
                            <span style={{ fontSize: 7.5, color: '#8d925f' }}>DUAL MODULATORS</span>
                        </div>
                        {/* LFO 1 */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1c1f17', padding: '3px 6px', borderRadius: 2, marginBottom: 2 }}>
                            <span style={{ fontSize: 8, fontWeight: 900, color: '#dce28a' }}>LFO 1</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <CompactDial label="SPEED" value={params.lfo1Speed} min={0.1} max={25} step={0.1} format={(v) => `${v.toFixed(1)}Hz`} onChange={(v) => updateParam('lfo1Speed', v)} />
                                <CompactDial label="DEPTH" value={params.lfo1Amount} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('lfo1Amount', v)} />
                            </div>
                            <select
                                value={params.lfo1Dest}
                                onChange={(e) => updateParam('lfo1Dest', Number(e.target.value))}
                                style={{ background: '#0a0d08', color: '#dce28a', border: '1px solid #3c422c', fontSize: 8, borderRadius: 2, padding: '1px 3px' }}
                            >
                                {lfoDestLabels.map((d, idx) => (
                                    <option key={d} value={idx}>➔ {d}</option>
                                ))}
                            </select>
                        </div>
                        {/* LFO 2 */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1c1f17', padding: '3px 6px', borderRadius: 2 }}>
                            <span style={{ fontSize: 8, fontWeight: 900, color: '#dce28a' }}>LFO 2</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <CompactDial label="SPEED" value={params.lfo2Speed} min={0.1} max={25} step={0.1} format={(v) => `${v.toFixed(1)}Hz`} onChange={(v) => updateParam('lfo2Speed', v)} />
                                <CompactDial label="DEPTH" value={params.lfo2Amount} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('lfo2Amount', v)} />
                            </div>
                            <select
                                value={params.lfo2Dest}
                                onChange={(e) => updateParam('lfo2Dest', Number(e.target.value))}
                                style={{ background: '#0a0d08', color: '#dce28a', border: '1px solid #3c422c', fontSize: 8, borderRadius: 2, padding: '1px 3px' }}
                            >
                                {lfoDestLabels.map((d, idx) => (
                                    <option key={d} value={idx}>➔ {d}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* 5. EFFECTS (ディレイ & コーラス) */}
                    <div style={sectionBoxStyle}>
                        <div style={sectionTitleStyle}>
                            <span>5. Effects & Space</span>
                            <span style={{ fontSize: 7.5, color: '#8d925f' }}>DELAY + CHORUS</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
                            <CompactDial label="DLY TIME" value={params.delayTime} min={0.01} max={1.0} step={0.01} format={(v) => `${Math.round(v * 1000)}ms`} onChange={(v) => updateParam('delayTime', v)} />
                            <CompactDial label="DLY FDBK" value={params.delayFeedback} min={0} max={0.85} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('delayFeedback', v)} />
                            <CompactDial label="DLY MIX" value={params.delayMix} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('delayMix', v)} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', borderTop: '1px solid #3c422c', paddingTop: 2 }}>
                            <CompactDial label="CHR RATE" value={params.chorusRate} min={0.1} max={8} step={0.1} format={(v) => `${v.toFixed(1)}Hz`} onChange={(v) => updateParam('chorusRate', v)} />
                            <CompactDial label="CHR DPTH" value={params.chorusDepth} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('chorusDepth', v)} />
                            <CompactDial label="CHR MIX" value={params.chorusMix} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateParam('chorusMix', v)} />
                        </div>
                    </div>

                    {/* 6. VOICE & PERFORMANCE (ボイス・ポルタメント・ステータス) */}
                    <div style={sectionBoxStyle}>
                        <div style={sectionTitleStyle}>
                            <span>6. Voice & Pitch</span>
                            <span style={{ fontSize: 7.5, color: '#8d925f' }}>16-VOICE POLYPHONIC</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', marginBottom: 4 }}>
                            <CompactDial label="PORTA" value={params.portamento} min={0} max={1} step={0.01} format={(v) => v === 0 ? 'OFF' : `${Math.round(v * 500)}ms`} onChange={(v) => updateParam('portamento', v)} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: '#1c1f17', padding: '4px 8px', borderRadius: 2, border: '1px solid #3c422c' }}>
                                <span style={{ fontSize: 7.5, color: '#8d925f', fontWeight: 900 }}>MODE</span>
                                <span style={{ fontSize: 9.5, fontWeight: 900, color: '#dce28a' }}>POLY (16)</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: '#1c1f17', padding: '4px 8px', borderRadius: 2, border: '1px solid #3c422c' }}>
                                <span style={{ fontSize: 7.5, color: '#8d925f', fontWeight: 900 }}>MIDI INPUT</span>
                                <span style={{ fontSize: 9.5, fontWeight: 900, color: midiDevices.length ? '#2ed573' : '#8d925f' }}>
                                    {midiDevices.length ? 'ONLINE' : 'SCAN'}
                                </span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0a0d08', padding: '3px 6px', borderRadius: 2, border: '1px solid #3c422c' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={ledIndicator(pressedKeys.length > 0 || activeMidiNotes.length > 0, 'green')} />
                                <span style={{ fontSize: 8, color: '#dce28a', fontWeight: 900 }}>
                                    {pressedKeys.length || activeMidiNotes.length ? `${pressedKeys.length + activeMidiNotes.length}音 発音中` : '待機中 (READY)'}
                                </span>
                            </div>
                            <span style={{ fontSize: 8, color: '#8d925f', fontFamily: 'monospace' }}>DSP OK</span>
                        </div>
                    </div>
                </div>

                {/* 🎛️ 4大パフォーマンス・マクロノブ（リアルタイム・サウンドモーフィング） */}
                <div style={{
                    background: 'linear-gradient(180deg, #181c13 0%, #11140e 100%)',
                    border: '1px solid #5a6045',
                    borderRadius: 3,
                    padding: '6px 10px',
                    marginTop: 4,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 6px rgba(0,0,0,0.5)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, borderBottom: '1px solid #3c422c', paddingBottom: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <IconSparkles size={11} color="#f4f2ad" />
                            <span style={{ fontSize: 9, fontWeight: 900, color: '#f4f2ad', letterSpacing: '0.5px' }}>PERFORMANCE MACROS</span>
                            <span style={{ fontSize: 7.5, color: '#8d925f', fontWeight: 700 }}>REALTIME SOUND MORPHING</span>
                        </div>
                        <span style={{ fontSize: 7.5, color: '#8d925f', fontFamily: 'monospace' }}>4-AXIS DYNAMIC MATRIX</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                        <MacroDial label="BRIGHTNESS" subLabel="音の抜け・高域" value={macroBrightness} accentColor="#70e0ff" onChange={applyMacroBrightness} />
                        <MacroDial label="THICK / DRIVE" subLabel="極太・歪み" value={macroThick} accentColor="#ff7675" onChange={applyMacroThick} />
                        <MacroDial label="SPACE" subLabel="立体空間・ディレイ" value={macroSpace} accentColor="#a29bfe" onChange={applyMacroSpace} />
                        <MacroDial label="MOVEMENT" subLabel="躍動・うねり変調" value={macroMovement} accentColor="#f4f2ad" onChange={applyMacroMovement} />
                    </div>
                </div>
            </div>
        </FloatingWindow>
    );
};