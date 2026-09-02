//==============================================================================
// C++ 側 (WebBridge.h) に登録したネイティブ関数への薄いラッパー。
// getNativeFunction の呼び出しをここに集約し、App.tsx から分離する。
//==============================================================================
import { getNativeFunction } from '@juce-framework/webview';
import { buildWebNativeApi } from './web/nativeShim';

import type {
    Analysis,
    ParametricEqParams,
    SessionState,
    Status,
    SynthParams,
    SynthPreset,
    SynthState,
    VirtualAnalogPreset,
    VoiceChangerPreset,
    VoiceLibraryEntry,
    VisemeKind,
    TrackVisemeSnapshot,
    MvSceneUpdatedPayload,
    MvSceneUpdatedDispatcher,
} from './types';

export type {
    VisemeKind,
    TrackVisemeSnapshot,
    MvSceneUpdatedPayload,
    MvSceneUpdatedDispatcher,
};

export const isJuce = typeof window !== 'undefined' && Boolean((window as unknown as { __JUCE__?: { backend?: unknown } }).__JUCE__?.backend);
let webApiCache: Record<string | symbol, unknown> | null = null;
function getWebApi() {
    if (!webApiCache) {
        webApiCache = buildWebNativeApi();
    }
    return webApiCache;
}

const juceNative = {
    getStatus: getNativeFunction('getStatus') as () => Promise<Status>,
    getAnalysis: getNativeFunction('getAnalysis') as () => Promise<Analysis>,
    startRecording: getNativeFunction('startRecording') as (addToSession?: boolean) => Promise<boolean>,
    stopRecording: getNativeFunction('stopRecording') as () => Promise<boolean>,
    openAudioSettings: getNativeFunction('openAudioSettings') as () => Promise<boolean>,
    startPlayback: getNativeFunction('startPlayback') as () => Promise<boolean>,
    stopPlayback: getNativeFunction('stopPlayback') as () => Promise<boolean>,
    setPlaybackLoop: getNativeFunction('setPlaybackLoop') as (loop: boolean) => Promise<boolean>,
    setPreviewTrimRange: getNativeFunction('setPreviewTrimRange') as (startRatio: number, endRatio: number) => Promise<boolean>,
    setPreviewFade: getNativeFunction('setPreviewFade') as (fadeInSec: number, fadeOutSec: number) => Promise<boolean>,
    setActiveTrack: getNativeFunction('setActiveTrack') as (trackIdx: number) => Promise<boolean>,
    setVoiceSynthEnabled: getNativeFunction('setVoiceSynthEnabled') as (enabled: boolean) => Promise<boolean>,
    isVoiceSynthEnabled: getNativeFunction('isVoiceSynthEnabled') as () => Promise<boolean>,
    noteOn: getNativeFunction('noteOn') as (note: number, velocity?: number, targetTrack?: number) => Promise<boolean>,
    noteOff: getNativeFunction('noteOff') as (note: number, targetTrack?: number) => Promise<boolean>,
    allNotesOff: getNativeFunction('allNotesOff') as (targetTrack?: number) => Promise<boolean>,
    setStep: getNativeFunction('setStep') as (step: number, note: number) => Promise<boolean>,
    setBpm: getNativeFunction('setBpm') as (bpm: number) => Promise<boolean>,
    setSequencerPlaying: getNativeFunction('setSequencerPlaying') as (playing: boolean) => Promise<boolean>,
    getSynthState: getNativeFunction('getSynthState') as () => Promise<SynthState>,
    synthSetParams: getNativeFunction('synthSetParams') as (params: SynthParams) => Promise<boolean>,
    setVirtualAnalogEnabled: getNativeFunction('setVirtualAnalogEnabled') as (enabled: boolean) => Promise<boolean>,
    getVirtualAnalogParams: getNativeFunction('getVirtualAnalogParams') as () => Promise<Record<string, number>>,
    virtualAnalogSetParams: getNativeFunction('virtualAnalogSetParams') as (params: Record<string, number>) => Promise<boolean>,
    virtualAnalogNoteOn: getNativeFunction('virtualAnalogNoteOn') as (note: number, velocity?: number) => Promise<boolean>,
    virtualAnalogNoteOff: getNativeFunction('virtualAnalogNoteOff') as (note: number) => Promise<boolean>,
    virtualAnalogAllNotesOff: getNativeFunction('virtualAnalogAllNotesOff') as () => Promise<boolean>,
    getVirtualAnalogPresets: getNativeFunction('getVirtualAnalogPresets') as () => Promise<VirtualAnalogPreset[]>,
    saveVirtualAnalogPreset: getNativeFunction('saveVirtualAnalogPreset') as (name: string) => Promise<number>,
    loadVirtualAnalogPreset: getNativeFunction('loadVirtualAnalogPreset') as (index: number) => Promise<boolean>,
    deleteVirtualAnalogPreset: getNativeFunction('deleteVirtualAnalogPreset') as (index: number) => Promise<boolean>,
    setVoiceChangerEnabled: getNativeFunction('setVoiceChangerEnabled') as (enabled: boolean, track?: number) => Promise<boolean>,
    getVoiceChangerState: getNativeFunction('getVoiceChangerState') as (track?: number) => Promise<{ enabled: boolean; params: Record<string, number> }>,
    setVoiceChangerParams: getNativeFunction('setVoiceChangerParams') as (params: Record<string, number>, track?: number) => Promise<boolean>,
    getVoiceChangerPresets: getNativeFunction('getVoiceChangerPresets') as () => Promise<VoiceChangerPreset[]>,
    saveVoiceChangerPreset: getNativeFunction('saveVoiceChangerPreset') as (name: string, track?: number) => Promise<number>,
    loadVoiceChangerPreset: getNativeFunction('loadVoiceChangerPreset') as (index: number, track?: number) => Promise<boolean>,
    deleteVoiceChangerPreset: getNativeFunction('deleteVoiceChangerPreset') as (index: number) => Promise<boolean>,
    getPresets: getNativeFunction('getPresets') as () => Promise<SynthPreset[]>,
    savePreset: getNativeFunction('savePreset') as (name: string, voiceIndex: number) => Promise<boolean>,
    loadPreset: getNativeFunction('loadPreset') as (index: number) => Promise<boolean>,
    renamePreset: getNativeFunction('renamePreset') as (index: number, newName: string) => Promise<boolean>,
    deletePreset: getNativeFunction('deletePreset') as (index: number) => Promise<boolean>,
    getVoices: getNativeFunction('getVoices') as () => Promise<VoiceLibraryEntry[]>,
    saveVoice: getNativeFunction('saveVoice') as (name: string) => Promise<number>,
    updateVoice: getNativeFunction('updateVoice') as (index: number) => Promise<boolean>,
    saveClipAsVoice: getNativeFunction('saveClipAsVoice') as (trackIdx: number, clipIdx: number, name?: string) => Promise<number>,
    convertClipToSynthVoice: getNativeFunction('convertClipToSynthVoice') as (trackIdx: number, clipIdx: number, voiceIndex?: number, mode?: number) => Promise<boolean>,
    previewClipSynth: getNativeFunction('previewClipSynth') as (trackIdx: number, clipIdx: number, voiceIndex?: number, mode?: number) => Promise<boolean>,
    trimCurrentVoice: getNativeFunction('trimCurrentVoice') as (startRatio: number, endRatio: number) => Promise<boolean>,
    autoTrimCurrentVoice: getNativeFunction('autoTrimCurrentVoice') as () => Promise<boolean>,
    normalizeCurrentVoice: getNativeFunction('normalizeCurrentVoice') as (enable?: boolean) => Promise<boolean>,
    setVoiceGain: getNativeFunction('setVoiceGain') as (factor: number) => Promise<boolean>,
    resetVoiceToOriginal: getNativeFunction('resetVoiceToOriginal') as () => Promise<boolean>,
    reverseCurrentVoice: getNativeFunction('reverseCurrentVoice') as () => Promise<boolean>,
    loadVoice: getNativeFunction('loadVoice') as (index: number) => Promise<boolean>,
    renameVoice: getNativeFunction('renameVoice') as (index: number, newName: string) => Promise<boolean>,
    deleteVoice: getNativeFunction('deleteVoice') as (index: number) => Promise<boolean>,
    getMidiDevices: getNativeFunction('getMidiDevices') as () => Promise<string[]>,
    setMidiDevice: getNativeFunction('setMidiDevice') as (deviceName: string) => Promise<boolean>,
    startMidiRecording: getNativeFunction('startMidiRecording') as () => Promise<boolean>,
    stopMidiRecording: getNativeFunction('stopMidiRecording') as () => Promise<boolean>,
    getMidiNotes: getNativeFunction('getMidiNotes') as () => Promise<Array<{ note: number; velocity: number; startSeconds: number; endSeconds: number }>>,
    getSessionState: getNativeFunction('getSessionState') as () => Promise<SessionState>,
    clearSession: getNativeFunction('clearSession') as () => Promise<boolean>,
    saveProject: getNativeFunction('saveProject') as (directoryPath: string, mvConfigJson?: string) => Promise<boolean>,
    autoBackupProject: getNativeFunction('autoBackupProject') as (directoryPath: string, maxBackups?: number) => Promise<boolean>,
    loadProject: getNativeFunction('loadProject') as (directoryPath: string) => Promise<boolean>,
    setMvConfig: getNativeFunction('setMvConfig') as (jsonStr: string) => Promise<boolean>,
    getMvConfig: getNativeFunction('getMvConfig') as () => Promise<string>,
    saveProjectDialog: getNativeFunction('saveProjectDialog') as () => Promise<string | boolean>,
    openProjectDialog: getNativeFunction('openProjectDialog') as () => Promise<string | boolean>,
    getProjectBackups: getNativeFunction('getProjectBackups') as (directoryPath: string) => Promise<Array<{
        fileName: string;
        filePath: string;
        sampleRate: number;
        numTracks: number;
        formattedTime: string;
        relativeTime: string;
        timestamp: number;
    }>>,
    loadProjectBackup: getNativeFunction('loadProjectBackup') as (directoryPath: string, backupFileName: string) => Promise<boolean>,
    revealInFinder: getNativeFunction('revealInFinder') as (path: string) => Promise<boolean>,
    sessionAddTrack: getNativeFunction('sessionAddTrack') as (name?: string, color?: string, isStereo?: boolean, inputType?: 'audio' | 'midi') => Promise<boolean>,
    sessionSetTrackInstrument: getNativeFunction('sessionSetTrackInstrument') as (track: number, kind: 'none' | 'va' | 'voice', presetIdx?: number) => Promise<boolean>,
    sessionGetTrackInstrument: getNativeFunction('sessionGetTrackInstrument') as (track: number) => Promise<'none' | 'va' | 'voice'>,
    sessionSetTrackVoicePreset: getNativeFunction('sessionSetTrackVoicePreset') as (track: number, presetIdx: number) => Promise<boolean>,
    sessionGetTrackVoicePreset: getNativeFunction('sessionGetTrackVoicePreset') as (track: number) => Promise<number>,
    sessionSetTrackVaPreset: getNativeFunction('sessionSetTrackVaPreset') as (track: number, presetIdx: number) => Promise<boolean>,
    sessionGetTrackVaPreset: getNativeFunction('sessionGetTrackVaPreset') as (track: number) => Promise<number>,
    sessionSetTrackInputType: getNativeFunction('sessionSetTrackInputType') as (track: number, inputType: 'audio' | 'midi') => Promise<boolean>,
    sessionDeleteTrack: getNativeFunction('sessionDeleteTrack') as (track: number) => Promise<boolean>,
    sessionReorderTrack: getNativeFunction('sessionReorderTrack') as (fromIndex: number, toIndex: number) => Promise<boolean>,
    sessionAppendCurrentClip: getNativeFunction('sessionAppendCurrentClip') as (track: number) => Promise<boolean>,
    sessionInsertVoiceClip: getNativeFunction('sessionInsertVoiceClip') as (track: number, voiceIndex?: number, startSeconds?: number) => Promise<number>,
    sessionInsertSequenceClip: getNativeFunction('sessionInsertSequenceClip') as (track: number, notes: Array<{ step: number; interval: number; velocity?: number }>, rootNote: number, lengthBars: number, bpm: number, isVirtualAnalog: boolean, startSeconds?: number) => Promise<number>,
    sessionInsertMidiNotesClip: getNativeFunction('sessionInsertMidiNotesClip') as (track: number, notes: Array<{ midi: number; startSeconds: number; endSeconds: number; velocity?: number }>, isVirtualAnalog: boolean, startSeconds?: number) => Promise<number>,
    sessionApplyVoiceToClip: getNativeFunction('sessionApplyVoiceToClip') as (track: number, clip: number, voiceIndex?: number) => Promise<boolean>,
    sessionSetTrackName: getNativeFunction('sessionSetTrackName') as (track: number, name: string) => Promise<boolean>,
    sessionSetTrackGain: getNativeFunction('sessionSetTrackGain') as (track: number, gain: number) => Promise<boolean>,
    sessionSetTrackPan: getNativeFunction('sessionSetTrackPan') as (track: number, pan: number) => Promise<boolean>,
    sessionSetTrackMute: getNativeFunction('sessionSetTrackMute') as (track: number, mute: boolean) => Promise<boolean>,
    sessionSetTrackSolo: getNativeFunction('sessionSetTrackSolo') as (track: number, solo: boolean) => Promise<boolean>,
    sessionSetTrackArmed: getNativeFunction('sessionSetTrackArmed') as (track: number, armed: boolean) => Promise<boolean>,
    sessionSetTrackMonitor: getNativeFunction('sessionSetTrackMonitor') as (track: number, monitor: boolean) => Promise<boolean>,
    sessionMoveClip: getNativeFunction('sessionMoveClip') as (track: number, clip: number, start: number) => Promise<boolean>,
    sessionMoveClipToTrack: getNativeFunction('sessionMoveClipToTrack') as (srcTrack: number, srcClip: number, dstTrack: number, newStart?: number) => Promise<boolean>,
    sessionMoveClips: getNativeFunction('sessionMoveClips') as (clips: Array<{ track: number; clip: number }>, deltaSeconds: number) => Promise<boolean>,
    sessionSetClipFade: getNativeFunction('sessionSetClipFade') as (track: number, clip: number, fadeInSec: number, fadeOutSec: number) => Promise<boolean>,
    sessionSplitClip: getNativeFunction('sessionSplitClip') as (track: number, clip: number, splitSeconds: number) => Promise<boolean>,
    sessionTrimClip: getNativeFunction('sessionTrimClip') as (track: number, clip: number, newStart: number, sourceStart: number, duration: number) => Promise<boolean>,
    sessionDuplicateClip: getNativeFunction('sessionDuplicateClip') as (track: number, clip: number) => Promise<number>,
    sessionDuplicateClips: getNativeFunction('sessionDuplicateClips') as (clipList: Array<{ track: number; clip: number }>) => Promise<boolean>,
    sessionDeleteClip: getNativeFunction('sessionDeleteClip') as (track: number, clip: number) => Promise<boolean>,
    setSessionLoop: getNativeFunction('setSessionLoop') as (enabled: boolean, startSeconds?: number, endSeconds?: number) => Promise<boolean>,
    sessionUndo: getNativeFunction('sessionUndo') as () => Promise<boolean>,
    sessionRedo: getNativeFunction('sessionRedo') as () => Promise<boolean>,
    sessionDuplicateClipNote: getNativeFunction('sessionDuplicateClipNote') as (track: number, clip: number, noteIndex: number) => Promise<number>,
    sessionUpdateClipNote: getNativeFunction('sessionUpdateClipNote') as (track: number, clip: number, noteIndex: number, midi: number, start: number, end: number, velocity?: number) => Promise<boolean>,
    sessionAddClipNote: getNativeFunction('sessionAddClipNote') as (track: number, clip: number, midi: number, start: number, end: number, velocity?: number) => Promise<number>,
    sessionDeleteClipNote: getNativeFunction('sessionDeleteClipNote') as (track: number, clip: number, noteIndex: number) => Promise<boolean>,
    sessionDeleteClipNotes: getNativeFunction('sessionDeleteClipNotes') as (track: number, clip: number, noteIndices: number[]) => Promise<number>,
    sessionDuplicateClipNotes: getNativeFunction('sessionDuplicateClipNotes') as (track: number, clip: number, noteIndices: number[]) => Promise<number>,
    sessionApplyClipEq: getNativeFunction('sessionApplyClipEq') as (track: number, clip: number, params: ParametricEqParams) => Promise<boolean>,
    sessionGetClipEqParams: getNativeFunction('sessionGetClipEqParams') as (track: number, clip: number) => Promise<ParametricEqParams>,
    sessionGetClipAnalysis: getNativeFunction('sessionGetClipAnalysis') as (track: number, clip: number) => Promise<Analysis | null>,
    setTrackEq: getNativeFunction('setTrackEq') as (track: number, params: ParametricEqParams) => Promise<boolean>,
    getTrackEq: getNativeFunction('getTrackEq') as (track: number) => Promise<ParametricEqParams>,
    getTrackSpectrum: getNativeFunction('getTrackSpectrum') as (track: number) => Promise<number[]>,
    /**
     * MV リップシンク用: 単一トラックの最新 viseme スナップショット。
     * TrackSignalHub 経由で C++ コアのフォルマント推定結果を軽量に返す。
     */
    getTrackViseme: getNativeFunction('getTrackViseme') as (track: number) => Promise<TrackVisemeSnapshot>,
    startSessionPlayback: getNativeFunction('startSessionPlayback') as () => Promise<boolean>,
    stopSessionPlayback: getNativeFunction('stopSessionPlayback') as () => Promise<boolean>,
    setSessionPosition: getNativeFunction('setSessionPosition') as (seconds: number) => Promise<boolean>,
    saveExportedVideo: getNativeFunction('saveExportedVideo') as (base64Data: string, filename: string) => Promise<string | boolean>,
    renderSessionAudioForMV: getNativeFunction('renderSessionAudioForMV') as (startSec?: number, endSec?: number, trackIndices?: number[]) => Promise<string | false>,
    /** macOS AVFoundation によるハードウェア H.264 / AAC MP4 エクスポート開始 */
    startNativeMvExport: getNativeFunction('startNativeMvExport') as (
        width: number,
        height: number,
        fps: number,
        bitrateBps: number,
        filename: string,
        audioWavBase64?: string,
    ) => Promise<boolean>,
    /** バッチでレンダリング済みフレーム (Base64 JPEG/PNG) をネイティブへ転送 */
    appendNativeMvFrames: getNativeFunction('appendNativeMvFrames') as (
        frames: string[],
        startFrameIndex: number,
    ) => Promise<boolean>,
    /** エクスポートを完了し、セッション音声 WAV と Mux して最終 MP4 の保存先パスを返す */
    finishNativeMvExport: getNativeFunction('finishNativeMvExport') as () => Promise<string | false>,
    /** エクスポートを中断 */
    cancelNativeMvExport: getNativeFunction('cancelNativeMvExport') as () => Promise<boolean>,
    // VST3 / AU プラグインホスト（Out-of-Process 隔離スキャン）
    scanPlugins: getNativeFunction('scanPlugins') as () => Promise<boolean>,
    cancelPluginScan: getNativeFunction('cancelPluginScan') as () => Promise<boolean>,
    scanVST3Plugins: getNativeFunction('scanVST3Plugins') as () => Promise<boolean>,
    getScannedPlugins: getNativeFunction('getScannedPlugins') as () => Promise<Array<{ id: string; name: string; manufacturer: string; category: string; format: string }>>,
    addTrackPlugin: getNativeFunction('addTrackPlugin') as (trackIdx: number, pluginId: string) => Promise<boolean>,
    removeTrackPlugin: getNativeFunction('removeTrackPlugin') as (trackIdx: number, slotIdx: number) => Promise<boolean>,
    setTrackPluginEnabled: getNativeFunction('setTrackPluginEnabled') as (trackIdx: number, slotIdx: number, enabled: boolean) => Promise<boolean>,
    reorderTrackPlugin: getNativeFunction('reorderTrackPlugin') as (trackIdx: number, fromIdx: number, toIdx: number) => Promise<boolean>,
    openPluginEditor: getNativeFunction('openPluginEditor') as (trackIdx: number, slotIdx: number) => Promise<boolean>,
    getTrackPlugins: getNativeFunction('getTrackPlugins') as (trackIdx: number) => Promise<Array<{ name: string; enabled: boolean; id: string }>>,
    runVocalAsr: getNativeFunction('runVocalAsr') as (base64Wav: string, lang?: string) => Promise<string>,
    openExternalUrl: getNativeFunction('openExternalUrl') as (url: string) => Promise<boolean>,
};

export const native = new Proxy(juceNative, {
    get(target, prop, receiver) {
        if (isJuce) {
            return Reflect.get(target, prop, receiver);
        }
        const webApi = getWebApi();
        if (prop in webApi) {
            return webApi[prop as string];
        }
        return () => Promise.resolve(false);
    },
}) as typeof juceNative;

// 🤖 外部 AI (MCP) からの MV シーン更新イベントのネイティブ受信
// ペイロード構造はネイティブ側 WebBridge.h::notifyMvSceneUpdated と対になる

if (typeof window !== 'undefined') {
    const handleNativeMvSceneUpdated = (payload: unknown) => {
        const detail = (payload ?? {}) as MvSceneUpdatedPayload;
        window.dispatchEvent(new CustomEvent<MvSceneUpdatedPayload>('voivent-mcp-update-scene', { detail }));
    };

    const handleNativeMvLyricsUpdated = (payload: unknown) => {
        const detail = (Array.isArray(payload) ? payload : []) as unknown[];
        window.dispatchEvent(new CustomEvent('voivent-mcp-update-lyrics', { detail }));
    };

    if (window.__JUCE__?.backend?.addEventListener) {
        window.__JUCE__.backend.addEventListener('mvSceneUpdated', handleNativeMvSceneUpdated);
        window.__JUCE__.backend.addEventListener('mvLyricsUpdated', handleNativeMvLyricsUpdated);
    }
}