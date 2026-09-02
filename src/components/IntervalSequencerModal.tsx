import React, { useCallback, useEffect, useRef, useState } from 'react';
import { native } from '../native';
import { IconClose, IconDownload, IconMic, IconPiano, IconPlay, IconSave, IconSliders, IconStop, IconZap } from './Icons';
import { FloatingWindow } from './FloatingWindow';

export interface IntervalSequencerNote {
    step: number;     // 0..63
    interval: number; // -12..+12 (0 = Root)
    velocity: number; // 0..127
}

export interface IntervalSequencerPreset {
    id: string;
    name: string;
    rootNote: number;    // MIDI note number (e.g. 60 = C4)
    lengthBars: number;  // 1, 2, 4
    instrumentKind: 'voice' | 'virtualAnalog';
    notes: IntervalSequencerNote[];
    adsr: { attack: number; decay: number; sustain: number; release: number };
    filter: { cutoff: number; resonance: number };
}

interface IntervalSequencerModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentBpm: number;
    activeTrackIndex: number;
    voices?: Array<{ name: string }>;
    selectedVoiceIndex?: number;
    onSelectVoice?: (index: number) => void;
    virtualAnalogPresets?: Array<{ name: string } | string>;
    selectedVirtualAnalogPresetIdx?: number;
    onSelectVirtualAnalogPreset?: (index: number) => void;
    onApplyToTimeline: (preset: IntervalSequencerPreset) => void;
}

const INTERVAL_ROWS = [
    { value: 12, label: '+12 (1 Oct)' },
    { value: 11, label: '+11 (M7)' },
    { value: 10, label: '+10 (m7)' },
    { value: 9, label: '+9 (M6)' },
    { value: 8, label: '+8 (m6)' },
    { value: 7, label: '+7 (5th)' },
    { value: 6, label: '+6 (tritone)' },
    { value: 5, label: '+5 (4th)' },
    { value: 4, label: '+4 (M3)' },
    { value: 3, label: '+3 (m3)' },
    { value: 2, label: '+2 (M2)' },
    { value: 1, label: '+1 (m2)' },
    { value: 0, label: ' 0 (Root)' },
    { value: -1, label: '-1 (m2)' },
    { value: -2, label: '-2 (M2)' },
    { value: -3, label: '-3 (m3)' },
    { value: -4, label: '-4 (M3)' },
    { value: -5, label: '-5 (4th)' },
    { value: -7, label: '-7 (5th)' },
    { value: -12, label: '-12 (-1 Oct)' },
];

const ROOT_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const DEFAULT_PRESETS: IntervalSequencerPreset[] = [
    {
        id: 'p1',
        name: '怪しいテクノリフ (0 & +1)',
        rootNote: 48,
        lengthBars: 1,
        instrumentKind: 'virtualAnalog',
        notes: [
            { step: 0, interval: 0, velocity: 90 },
            { step: 2, interval: 1, velocity: 85 },
            { step: 4, interval: 0, velocity: 90 },
            { step: 6, interval: 1, velocity: 85 },
            { step: 8, interval: 0, velocity: 90 },
            { step: 10, interval: 7, velocity: 95 },
            { step: 12, interval: 1, velocity: 85 },
            { step: 14, interval: 0, velocity: 90 },
        ],
        adsr: { attack: 0.01, decay: 0.15, sustain: 0.2, release: 0.1 },
        filter: { cutoff: 1200, resonance: 4.5 },
    },
    {
        id: 'p2',
        name: '重低音ファンクベース (0, +7, +10)',
        rootNote: 36,
        lengthBars: 1,
        instrumentKind: 'virtualAnalog',
        notes: [
            { step: 0, interval: 0, velocity: 95 },
            { step: 3, interval: 0, velocity: 80 },
            { step: 6, interval: 7, velocity: 90 },
            { step: 8, interval: 10, velocity: 95 },
            { step: 10, interval: 12, velocity: 100 },
            { step: 12, interval: 7, velocity: 85 },
            { step: 14, interval: 0, velocity: 80 },
        ],
        adsr: { attack: 0.02, decay: 0.25, sustain: 0.4, release: 0.15 },
        filter: { cutoff: 800, resonance: 3.0 },
    },
    {
        id: 'p3',
        name: 'サイバー声スタッカート',
        rootNote: 60,
        lengthBars: 1,
        instrumentKind: 'voice',
        notes: [
            { step: 0, interval: 0, velocity: 90 },
            { step: 2, interval: 3, velocity: 85 },
            { step: 4, interval: 7, velocity: 95 },
            { step: 6, interval: 10, velocity: 90 },
            { step: 8, interval: 12, velocity: 100 },
            { step: 10, interval: 7, velocity: 85 },
            { step: 12, interval: 3, velocity: 80 },
            { step: 14, interval: 2, velocity: 75 },
        ],
        adsr: { attack: 0.01, decay: 0.18, sustain: 0.3, release: 0.08 },
        filter: { cutoff: 2400, resonance: 2.0 },
    },
];

export const IntervalSequencerModal: React.FC<IntervalSequencerModalProps> = ({
    isOpen,
    onClose,
    currentBpm,
    activeTrackIndex: _,
    voices = [],
    selectedVoiceIndex = 0,
    onSelectVoice,
    virtualAnalogPresets = [],
    selectedVirtualAnalogPresetIdx = 0,
    onSelectVirtualAnalogPreset,
    onApplyToTimeline,
}) => {
    const [rootNote, setRootNote] = useState<number>(48);
    const [lengthBars, setLengthBars] = useState<number>(1);
    const [instrumentKind, setInstrumentKind] = useState<'voice' | 'virtualAnalog'>('virtualAnalog');
    const [notes, setNotes] = useState<IntervalSequencerNote[]>(DEFAULT_PRESETS[0].notes);
    const [adsr, setAdsr] = useState(DEFAULT_PRESETS[0].adsr);
    const [filter, setFilter] = useState(DEFAULT_PRESETS[0].filter);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [currentStep, setCurrentStep] = useState<number>(-1);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

    // ライブラリ (10スロット)
    const [savedPresets, setSavedPresets] = useState<IntervalSequencerPreset[]>(() => {
        try {
            const raw = localStorage.getItem('voivent_interval_sequencer_presets');
            if (raw) return JSON.parse(raw);
        } catch { /* noop */ }
        return DEFAULT_PRESETS;
    });
    const [selectedSlot, setSelectedSlot] = useState<number>(0);
    const [presetNameInput, setPresetNameInput] = useState<string>('');

    const totalSteps = lengthBars * 16;
    const playTimerRef = useRef<number | null>(null);
    const stepRef = useRef<number>(0);

    // リアルタイム変更用 Refs（ループ再生中にいじっても即座に次のステップから反映！）
    const notesRef = useRef(notes);
    notesRef.current = notes;
    const rootNoteRef = useRef(rootNote);
    rootNoteRef.current = rootNote;
    const instrumentKindRef = useRef(instrumentKind);
    instrumentKindRef.current = instrumentKind;
    const adsrRef = useRef(adsr);
    adsrRef.current = adsr;
    const totalStepsRef = useRef(totalSteps);
    totalStepsRef.current = totalSteps;

    // 音源の切り替えハンドラー（再生中も止まらずにシームレスに音源切り替え！）
    const handleSwitchInstrument = async (kind: 'voice' | 'virtualAnalog') => {
        setInstrumentKind(kind);
        instrumentKindRef.current = kind;
        if (kind === 'voice') {
            await native.setVirtualAnalogEnabled(false);
            await native.setVoiceSynthEnabled(true);
            if (voices.length > 0) {
                await native.loadVoice(selectedVoiceIndex);
            }
        } else {
            await native.setVirtualAnalogEnabled(true);
            await native.setVoiceSynthEnabled(false);
            if (virtualAnalogPresets.length > 0) {
                await native.loadVirtualAnalogPreset(selectedVirtualAnalogPresetIdx);
            }
        }
    };

    // 初期マウント時に音源状態を確実に適用
    useEffect(() => {
        if (isOpen) {
            void handleSwitchInstrument(instrumentKind);
        }
    }, [isOpen]);

    const toggleNote = (step: number, interval: number) => {
        setNotes((prev) => {
            const exists = prev.some((n) => n.step === step && n.interval === interval);
            if (exists) {
                return prev.filter((n) => !(n.step === step && n.interval === interval));
            } else {
                return [...prev.filter((n) => n.step !== step), { step, interval, velocity: 85 }];
            }
        });
        const midiNote = Math.max(12, Math.min(108, rootNote + interval));
        const previewVel = 0.22; // 耳に優しい適正音量
        if (instrumentKindRef.current === 'virtualAnalog') {
            void native.virtualAnalogNoteOn(midiNote, previewVel);
            setTimeout(() => { void native.virtualAnalogNoteOff(midiNote); }, 200);
        } else {
            void native.noteOn(midiNote, previewVel);
            setTimeout(() => { void native.noteOff(midiNote); }, 200);
        }
    };

    const stopPlayback = useCallback(() => {
        if (playTimerRef.current !== null) {
            window.clearInterval(playTimerRef.current);
            playTimerRef.current = null;
        }
        void native.virtualAnalogAllNotesOff();
        void native.allNotesOff();
        setIsPlaying(false);
        setCurrentStep(-1);
    }, []);

    const startPlayback = useCallback(() => {
        if (playTimerRef.current !== null) {
            window.clearInterval(playTimerRef.current);
            playTimerRef.current = null;
        }
        setIsPlaying(true);
        stepRef.current = 0;
        const stepMs = (60000 / (currentBpm || 120)) / 4;

        const tick = () => {
            const s = stepRef.current;
            setCurrentStep(s);

            // Ref から常に「最新」のノート・音源・ルート音を取得（再生したまま変更可能！）
            const curNotes = notesRef.current;
            const curRoot = rootNoteRef.current;
            const curKind = instrumentKindRef.current;
            const curAdsr = adsrRef.current;
            const curTotal = totalStepsRef.current;

            const stepNotes = curNotes.filter((n) => n.step === s);
            for (const n of stepNotes) {
                const midi = Math.max(12, Math.min(108, curRoot + n.interval));
                const vel = (n.velocity / 127) * 0.24; // 心地よい適正音量
                const durMs = Math.max(40, (curAdsr.decay + curAdsr.release) * 1000);
                if (curKind === 'virtualAnalog') {
                    void native.virtualAnalogNoteOn(midi, vel);
                    setTimeout(() => { void native.virtualAnalogNoteOff(midi); }, durMs);
                } else {
                    void native.noteOn(midi, vel);
                    setTimeout(() => { void native.noteOff(midi); }, durMs);
                }
            }

            stepRef.current = (stepRef.current + 1) % (curTotal || 16);
        };

        tick();
        playTimerRef.current = window.setInterval(tick, stepMs);
    }, [currentBpm]);

    useEffect(() => {
        return () => {
            if (playTimerRef.current !== null) clearInterval(playTimerRef.current);
        };
    }, []);

    // ADSR / FILTER パラメータ更新 ＆ VAシンセへリアルタイム送信
    const handleUpdateAdsr = (key: keyof typeof adsr, val: number) => {
        const next = { ...adsr, [key]: val };
        setAdsr(next);
        adsrRef.current = next;
        if (instrumentKindRef.current === 'virtualAnalog') {
            void native.virtualAnalogSetParams({
                attack: next.attack,
                decay: next.decay,
                sustain: next.sustain,
                release: next.release,
            });
        }
    };

    const handleUpdateFilter = (key: keyof typeof filter, val: number) => {
        const next = { ...filter, [key]: val };
        setFilter(next);
        if (instrumentKindRef.current === 'virtualAnalog') {
            void native.virtualAnalogSetParams({
                cutoff: next.cutoff,
                resonance: next.resonance / 10.0,
            });
        }
    };

    const handleSavePreset = (slotIdx: number) => {
        const name = presetNameInput.trim() || `フレーズ ${slotIdx + 1}`;
        const newPreset: IntervalSequencerPreset = {
            id: `p_${Date.now()}`,
            name,
            rootNote,
            lengthBars,
            instrumentKind,
            notes,
            adsr,
            filter,
        };
        const updated = [...savedPresets];
        updated[slotIdx] = newPreset;
        setSavedPresets(updated);
        setSelectedSlot(slotIdx);
        try {
            localStorage.setItem('voivent_interval_sequencer_presets', JSON.stringify(updated));
        } catch { /* noop */ }
    };

    const handleLoadPreset = (slotIdx: number) => {
        const p = savedPresets[slotIdx];
        if (!p) return;
        setSelectedSlot(slotIdx);
        setRootNote(p.rootNote || 48);
        rootNoteRef.current = p.rootNote || 48;
        setLengthBars(p.lengthBars || 1);
        totalStepsRef.current = (p.lengthBars || 1) * 16;
        setNotes(p.notes || []);
        notesRef.current = p.notes || [];

        const nextAdsr = p.adsr || { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.1 };
        const nextFilter = p.filter || { cutoff: 1500, resonance: 3.0 };
        setAdsr(nextAdsr);
        adsrRef.current = nextAdsr;
        setFilter(nextFilter);
        setPresetNameInput(p.name);

        const nextKind = p.instrumentKind || 'virtualAnalog';
        void handleSwitchInstrument(nextKind);
        if (nextKind === 'virtualAnalog') {
            void native.virtualAnalogSetParams({
                attack: nextAdsr.attack,
                decay: nextAdsr.decay,
                sustain: nextAdsr.sustain,
                release: nextAdsr.release,
                cutoff: nextFilter.cutoff,
                resonance: nextFilter.resonance / 10.0,
            });
        }
    };

    const handleSafeClose = () => {
        stopPlayback();
        onClose();
    };

    if (!isOpen) return null;

    const rootName = `${ROOT_NOTE_NAMES[rootNote % 12]}${Math.floor(rootNote / 12) - 1}`;

    return (
        <FloatingWindow
            title="INTERVAL SEQUENCER - フレーズエディタ"
            icon={<IconZap size={14} color="#38bdf8" />}
            isOpen={isOpen}
            onClose={handleSafeClose}
            initialWidth={880}
            initialHeight={620}
            minWidth={680}
            minHeight={420}
            zIndex={1200}
            headerRight={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                        type="button"
                        onClick={() => {
                            const p: IntervalSequencerPreset = {
                                id: `applied_${Date.now()}`,
                                name: presetNameInput || 'シーケンスフレーズ',
                                rootNote,
                                lengthBars,
                                instrumentKind,
                                notes,
                                adsr,
                                filter,
                            };
                            onApplyToTimeline(p);
                            handleSafeClose();
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                            color: '#ffffff',
                            border: '1px solid #3b82f6',
                            borderRadius: 4,
                            padding: '3px 9px',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer',
                        }}
                    >
                        <IconDownload size={11} color="#ffffff" />
                        <span>トラック反映</span>
                    </button>
                </div>
            }
        >
            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, height: '100%', boxSizing: 'border-box' }}>
                    {/* 1. 【上段】基本設定バー */}
                    <div
                        style={{
                            flexShrink: 0,
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '8px 10px',
                            background: '#141e2b',
                            border: '1px solid #233547',
                            borderRadius: 6,
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {/* ループ再生ボタン */}
                            <button
                                type="button"
                                onClick={isPlaying ? stopPlayback : startPlayback}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    background: isPlaying ? '#dc2626' : '#059669',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: 4,
                                    padding: '5px 10px',
                                    fontSize: 11,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                }}
                            >
                                {isPlaying ? <IconStop size={12} color="#fff" /> : <IconPlay size={12} color="#fff" />}
                                <span>{isPlaying ? '停止' : '試聴'}</span>
                            </button>

                            {/* 長さ (Length) */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>長さ:</span>
                                {([1, 2, 4] as const).map((bars) => (
                                    <button
                                        key={bars}
                                        type="button"
                                        onClick={() => setLengthBars(bars)}
                                        style={{
                                            background: lengthBars === bars ? '#0284c7' : '#1e293b',
                                            color: lengthBars === bars ? '#ffffff' : '#94a3b8',
                                            border: '1px solid #334155',
                                            borderRadius: 3,
                                            padding: '2px 5px',
                                            fontSize: 10,
                                            fontWeight: 800,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {bars}小節
                                    </button>
                                ))}
                            </div>

                            {/* ルート音 (Root) */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>基準音:</span>
                                <select
                                    value={rootNote}
                                    onChange={(e) => setRootNote(Number(e.target.value))}
                                    style={{
                                        background: '#0f172a',
                                        color: '#38bdf8',
                                        border: '1px solid #334155',
                                        borderRadius: 3,
                                        padding: '2px 5px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                    }}
                                >
                                    {[24, 36, 48, 60, 72].map((base) =>
                                        ROOT_NOTE_NAMES.map((n, idx) => {
                                            const val = base + idx;
                                            const oct = Math.floor(val / 12) - 1;
                                            return (
                                                <option key={val} value={val}>
                                                    {n}{oct}
                                                </option>
                                            );
                                        })
                                    )}
                                </select>
                            </div>
                        </div>

                        {/* 音源切り替え ＆ 音色プリセット選択 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px', background: '#0b1118', borderRadius: 4, border: '1px solid #243447' }}>
                            <button
                                type="button"
                                onClick={() => void handleSwitchInstrument('voice')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    background: instrumentKind === 'voice' ? '#0284c7' : 'transparent',
                                    color: instrumentKind === 'voice' ? '#fff' : '#94a3b8',
                                    border: 'none',
                                    borderRadius: 3,
                                    padding: '3px 6px',
                                    fontSize: 10,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                }}
                            >
                                <IconMic size={11} color={instrumentKind === 'voice' ? '#fff' : '#94a3b8'} />
                                <span>ボイス</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSwitchInstrument('virtualAnalog')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    background: instrumentKind === 'virtualAnalog' ? '#ca8a04' : 'transparent',
                                    color: instrumentKind === 'virtualAnalog' ? '#fff' : '#94a3b8',
                                    border: 'none',
                                    borderRadius: 3,
                                    padding: '3px 6px',
                                    fontSize: 10,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                }}
                            >
                                <IconSliders size={11} color={instrumentKind === 'virtualAnalog' ? '#fff' : '#94a3b8'} />
                                <span>VAシンセ</span>
                            </button>

                            {/* 音色プリセット選択ドロップダウン */}
                            {instrumentKind === 'voice' ? (
                                <select
                                    value={selectedVoiceIndex}
                                    onChange={(e) => {
                                        const idx = Number(e.target.value);
                                        if (onSelectVoice) onSelectVoice(idx);
                                        void native.loadVoice(idx);
                                    }}
                                    style={{
                                        background: '#122030',
                                        color: '#38bdf8',
                                        border: '1px solid #0284c7',
                                        borderRadius: 3,
                                        padding: '2px 4px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        maxWidth: 120,
                                    }}
                                    aria-label="ボイス音色の選択"
                                >
                                    {voices.length > 0 ? (
                                        voices.map((v, idx) => (
                                            <option key={idx} value={idx}>
                                                {(idx < 9 ? '0' : '') + (idx + 1)}: {v.name || `ボイス ${idx + 1}`}
                                            </option>
                                        ))
                                    ) : (
                                        <option value={0}>01: クール</option>
                                    )}
                                </select>
                            ) : (
                                <select
                                    value={selectedVirtualAnalogPresetIdx}
                                    onChange={(e) => {
                                        const idx = Number(e.target.value);
                                        if (onSelectVirtualAnalogPreset) onSelectVirtualAnalogPreset(idx);
                                        void native.loadVirtualAnalogPreset(idx);
                                    }}
                                    style={{
                                        background: '#282212',
                                        color: '#facc15',
                                        border: '1px solid #ca8a04',
                                        borderRadius: 3,
                                        padding: '2px 4px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        maxWidth: 120,
                                    }}
                                    aria-label="VAシンセ音色の選択"
                                >
                                    {virtualAnalogPresets.length > 0 ? (
                                        virtualAnalogPresets.map((p, idx) => {
                                            const pName = typeof p === 'string' ? p : p.name;
                                            return (
                                                <option key={idx} value={idx}>
                                                    {(idx < 9 ? '0' : '') + (idx + 1)}: {pName || `Preset ${idx + 1}`}
                                                </option>
                                            );
                                        })
                                    ) : (
                                        <option value={0}>01: Default Bass</option>
                                    )}
                                </select>
                            )}
                        </div>
                    </div>

                    {/* 2. 【中段】インターバル（度数）・グリッド */}
                    <div
                        style={{
                            flex: isFullscreen ? 1 : 'none',
                            minHeight: 0,
                            background: '#090e14',
                            border: '1px solid #1e2c3c',
                            borderRadius: 6,
                            padding: 6,
                            overflowX: 'auto',
                            overflowY: 'auto',
                            maxHeight: isFullscreen ? 'none' : '220px',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8' }}>
                                度数グリッド（クリックで配置 / ルート音: {rootName}）
                            </div>
                            <button
                                type="button"
                                onClick={() => setNotes([])}
                                style={{ background: '#1e293b', border: 'none', color: '#94a3b8', fontSize: 9, padding: '2px 6px', borderRadius: 3, cursor: 'pointer' }}
                            >
                                全クリア
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: totalSteps * 20 + 80 }}>
                            {/* ステップヘッダー */}
                            <div style={{ display: 'flex', alignItems: 'center', height: 18 }}>
                                <div style={{ width: 80, fontSize: 8, color: '#64748b', fontWeight: 800, paddingLeft: 4 }}>INTERVAL</div>
                                {Array.from({ length: totalSteps }).map((_, stepIdx) => {
                                    const isBeat = stepIdx % 4 === 0;
                                    const isBar = stepIdx % 16 === 0;
                                    const isCur = currentStep === stepIdx;
                                    return (
                                        <div
                                            key={stepIdx}
                                            style={{
                                                flex: 1,
                                                minWidth: 20,
                                                textAlign: 'center',
                                                fontSize: 8,
                                                fontWeight: isBar ? 900 : 700,
                                                color: isCur ? '#38bdf8' : isBar ? '#f8fafc' : isBeat ? '#94a3b8' : '#475569',
                                                borderLeft: isBar ? '2px solid #38bdf8' : isBeat ? '1px solid #334155' : '1px solid #1e293b',
                                                background: isCur ? 'rgba(56,189,248,0.25)' : 'transparent',
                                                lineHeight: '18px',
                                            }}
                                        >
                                            {stepIdx + 1}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* 各度数の行 */}
                            {INTERVAL_ROWS.map((row) => {
                                const isRoot = row.value === 0;
                                const isOct = row.value === 12 || row.value === -12;
                                return (
                                    <div
                                        key={row.value}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            height: 18,
                                            background: isRoot ? 'rgba(56,189,248,0.08)' : isOct ? 'rgba(255,255,255,0.03)' : 'transparent',
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: 80,
                                                fontSize: 9,
                                                fontWeight: isRoot ? 900 : 700,
                                                color: isRoot ? '#38bdf8' : isOct ? '#f1f5f9' : '#94a3b8',
                                                paddingLeft: 4,
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {row.label}
                                        </div>

                                        {Array.from({ length: totalSteps }).map((_, stepIdx) => {
                                            const isSelected = notes.some((n) => n.step === stepIdx && n.interval === row.value);
                                            const isBeat = stepIdx % 4 === 0;
                                            const isBar = stepIdx % 16 === 0;
                                            const isCur = currentStep === stepIdx;

                                            return (
                                                <div
                                                    key={stepIdx}
                                                    onClick={() => toggleNote(stepIdx, row.value)}
                                                    style={{
                                                        flex: 1,
                                                        minWidth: 20,
                                                        height: 16,
                                                        margin: '1px',
                                                        borderRadius: 2,
                                                        borderLeft: isBar ? '2px solid rgba(56,189,248,0.4)' : isBeat ? '1px solid rgba(255,255,255,0.1)' : 'none',
                                                        background: isSelected
                                                            ? isRoot
                                                                ? 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)'
                                                                : 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
                                                            : isCur
                                                                ? 'rgba(56,189,248,0.15)'
                                                                : isRoot
                                                                    ? 'rgba(56,189,248,0.04)'
                                                                    : '#111822',
                                                        cursor: 'pointer',
                                                        display: 'grid',
                                                        placeItems: 'center',
                                                    }}
                                                    title={`ステップ ${stepIdx + 1} / 度数 ${row.label}`}
                                                >
                                                    {isSelected && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 3. 【下段】発音のキレと音色を作り込む「ADSR ＆ FILTER」 */}
                    <div
                        style={{
                            flexShrink: 0,
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: 10,
                            padding: '8px 10px',
                            background: '#141e2b',
                            border: '1px solid #233547',
                            borderRadius: 6,
                            boxSizing: 'border-box',
                        }}
                    >
                        {/* ADSR */}
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8', marginBottom: 4 }}>
                                音量エンベロープ (ADSR)
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
                                {[
                                    { key: 'attack', label: 'A', min: 0.001, max: 0.5, step: 0.005, unit: 's' },
                                    { key: 'decay', label: 'D', min: 0.01, max: 1.0, step: 0.01, unit: 's' },
                                    { key: 'sustain', label: 'S', min: 0.0, max: 1.0, step: 0.05, unit: '' },
                                    { key: 'release', label: 'R', min: 0.01, max: 1.5, step: 0.01, unit: 's' },
                                ].map((d) => (
                                    <div key={d.key} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                                        <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 800 }}>{d.label}</span>
                                        <input
                                            type="range"
                                            min={d.min}
                                            max={d.max}
                                            step={d.step}
                                            value={adsr[d.key as keyof typeof adsr]}
                                            onChange={(e) => handleUpdateAdsr(d.key as keyof typeof adsr, Number(e.target.value))}
                                            style={{ accentColor: '#38bdf8', cursor: 'pointer', height: 14, width: '100%', margin: 0, boxSizing: 'border-box' }}
                                        />
                                        <span style={{ fontSize: 9, color: '#f1f5f9', fontWeight: 700 }}>
                                            {adsr[d.key as keyof typeof adsr].toFixed(2)}{d.unit}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* FILTER */}
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8', marginBottom: 4 }}>
                                フィルター (FILTER)
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 800 }}>CUTOFF</span>
                                    <input
                                        type="range"
                                        min={100}
                                        max={8000}
                                        step={50}
                                        value={filter.cutoff}
                                        onChange={(e) => handleUpdateFilter('cutoff', Number(e.target.value))}
                                        style={{ accentColor: '#38bdf8', cursor: 'pointer', height: 14, width: '100%', margin: 0, boxSizing: 'border-box' }}
                                    />
                                    <span style={{ fontSize: 9, color: '#f1f5f9', fontWeight: 700 }}>
                                        {Math.round(filter.cutoff)} Hz
                                    </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 800 }}>RESONANCE</span>
                                    <input
                                        type="range"
                                        min={0.5}
                                        max={10.0}
                                        step={0.1}
                                        value={filter.resonance}
                                        onChange={(e) => handleUpdateFilter('resonance', Number(e.target.value))}
                                        style={{ accentColor: '#38bdf8', cursor: 'pointer', height: 14, width: '100%', margin: 0, boxSizing: 'border-box' }}
                                    />
                                    <span style={{ fontSize: 9, color: '#f1f5f9', fontWeight: 700 }}>
                                        {filter.resonance.toFixed(1)} Q
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 4. 【最下段】「マイ・フレーズ・ライブラリ」 */}
                    <div
                        style={{
                            flexShrink: 0,
                            padding: '8px 10px',
                            background: '#101722',
                            border: '1px solid #1e2c3c',
                            borderRadius: 6,
                            boxSizing: 'border-box',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8' }}>
                                マイ・フレーズ・ライブラリ（10スロット）
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input
                                    type="text"
                                    placeholder="フレーズ名"
                                    value={presetNameInput}
                                    onChange={(e) => setPresetNameInput(e.target.value)}
                                    style={{
                                        background: '#090e14',
                                        color: '#f8fafc',
                                        border: '1px solid #334155',
                                        borderRadius: 3,
                                        padding: '2px 5px',
                                        fontSize: 10,
                                        width: 110,
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => handleSavePreset(selectedSlot)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 3,
                                        background: '#059669',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: 3,
                                        padding: '3px 7px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                    }}
                                >
                                    <IconSave size={11} color="#ffffff" />
                                    <span>保存</span>
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 5 }}>
                            {Array.from({ length: 10 }).map((_, idx) => {
                                const p = savedPresets[idx];
                                const isSel = selectedSlot === idx;
                                return (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => handleLoadPreset(idx)}
                                        style={{
                                            padding: '4px 6px',
                                            textAlign: 'left',
                                            background: isSel ? '#0284c7' : '#182230',
                                            color: isSel ? '#ffffff' : '#cbd5e1',
                                            border: `1px solid ${isSel ? '#38bdf8' : '#243447'}`,
                                            borderRadius: 3,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 1,
                                            minWidth: 0,
                                        }}
                                    >
                                        <div style={{ fontSize: 8, opacity: 0.7, fontWeight: 900 }}>スロット {idx + 1}</div>
                                        <div style={{ fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {p ? p.name : '（空）'}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
        </FloatingWindow>
    );
};
