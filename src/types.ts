//==============================================================================
// フロントエンド全体で共有する TypeScript 型定義。
// C++ 側 (WebBridge.h / AudioEngine.h) から返る var の形と 1:1 に対応させる。
//==============================================================================

export type Status = {
    isRecording: boolean;
    isPlaying: boolean;
    hasVoice: boolean;
    hasAnalysis: boolean;
    duration: number;
    playbackPosition: number;
    sampleRate: number;
    hasSession: boolean;
    sessionDuration: number;
    sessionPosition: number;
    isSessionPlaying: boolean;
    // 直近のプロジェクト読み込みで WAV 欠損によりスキップされたクリップ数。
    // ロード成功でもデータ欠損を検知できるようにする。
    loadMissingClips?: number;
    audioInputDevice?: string;
    audioInputChannels?: string;
    audioInputPeak?: number;
    liveRecordPeaks?: number[];
    pressedNotes?: number[];
};

export type AnalysisNote = {
    start: number;
    end: number;
    midi: number;
    pitchHz?: number;
    velocity?: number;
};

/** MIDI 録音中にネイティブ (getMidiNotes) が返すライブノート */
export type LiveMidiNote = {
    note: number;
    velocity: number;
    startSeconds: number;
    endSeconds: number;
};

export type Analysis = {
    duration: number;
    peaks: [number, number][];
    pitch: number[];
    pitchTimes: number[];
    attackTimes: number[];
    notes: AnalysisNote[];
};

export type SynthParams = {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    filterCutoff: number;
    filterResonance: number;
    masterGain: number;
};

export type SynthState = {
    hasVoice: boolean;
    basePitch: number;
    baseMidiNote: number;
    stepCount: number;
    bpm: number;
    playing: boolean;
    seqStep: number;
    pattern: number[];
    params: SynthParams;
};

export type SynthPreset = {
    name: string;
    params: SynthParams;
    voiceIndex: number;
};

export type VoiceLibraryEntry = {
    name: string;
    duration: number;
    noteCount: number;
};

export type EqBandParams = {
    freq: number;
    gainDb: number;
    q: number;
    type: number; // 0: Bell, 1: LowShelf, 2: HighShelf, 3: HPF, 4: LPF
    enabled: boolean;
};

export type ParametricEqParams = {
    bands: EqBandParams[];
    outputGainDb: number;
    bypass: boolean;
};

export type SessionClip = {
    start: number;
    duration: number;
    sourceDuration?: number;
    trimStart?: number;
    fadeIn?: number;
    fadeOut?: number;
    eq?: ParametricEqParams;
    notes: AnalysisNote[];
    peaks?: [number, number][];
};

export type SessionTrack = {
    name: string;
    color?: string;
    isStereo?: boolean;
    inputType?: 'audio' | 'midi';
    gain: number;
    pan: number;
    mute: boolean;
    solo: boolean;
    armed: boolean;
    monitor: boolean;
    clips: SessionClip[];
};

export type SessionState = {
    sampleRate: number;
    duration: number;
    tracks: SessionTrack[];
};

export type VoiceChangerParams = {
    mutation: number;
    pitch: number;
    machine: number;
    distortion: number;
    space: number;
    mix: number;
    output: number;
};

export type VoiceChangerPreset = {
    name: string;
    params: VoiceChangerParams;
};

export type VirtualAnalogParams = {
    oscAWave: number;
    oscSub: number;
    fmAmount: number;
    oscBWave: number;
    oscBDetune: number;
    oscBFine: number;
    pulseWidth: number;
    hardSync: number;
    ringMod: number;
    oscMix: number;
    noise: number;
    drive: number;
    cutoff: number;
    resonance: number;
    filterEnvAmt: number;
    filterAttack: number;
    filterDecay: number;
    filterSustain: number;
    filterRelease: number;
    keyTrack: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    gain: number;
    pan: number;
    lfo1Speed: number;
    lfo1Amount: number;
    lfo1Dest: number;
    lfo2Speed: number;
    lfo2Amount: number;
    lfo2Dest: number;
    delayTime: number;
    delayFeedback: number;
    delayMix: number;
    chorusRate: number;
    chorusDepth: number;
    chorusMix: number;
    portamento: number;
};

export type VirtualAnalogPreset = {
    name: string;
    params: VirtualAnalogParams;
};

/** トラック別 viseme（母音）スナップショット */
export type VisemeKind = 'a' | 'i' | 'u' | 'e' | 'o' | 'sil' | 'x';

export interface TrackVisemeSnapshot {
    viseme: VisemeKind;
    /** 口パク開口量 0..1 */
    visemeStrength: number;
    /** 基本周波数ヒント 0..1200Hz (0 = 無声音) */
    pitchHz: number;
    /** セッション再生位置（秒） */
    time: number;
    playing: boolean;
    /** スペクトラム取得可否 */
    spectrumValid: boolean;
}

export interface MvSceneUpdatedPayload {
    sceneId?: string;
    svgCode?: string;
    cssCode?: string;
}

export type MvSceneUpdatedDispatcher = (
    sceneId: string,
    svgCode: string,
    cssCode?: string,
) => void;