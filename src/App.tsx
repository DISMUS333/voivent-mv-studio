//==============================================================================
// アプリのルート。状態管理と C++ バックエンドとの接続を担い、
// 表示は components/ の各コンポーネントへ委譲する。
//==============================================================================
import { useEffect, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react';

import { native } from './native';
import type {
    Analysis,
    SessionState,
    Status,
    SynthPreset,
    SynthState,
    VoiceLibraryEntry,
} from './types';
import { buildKeys, noteName } from './lib/music';
import { VisualizerMV } from './components/VisualizerMV';
import { Keyboard } from './components/Keyboard';
import { SessionTimeline } from './components/SessionTimeline';
import { SynthEditor } from './components/SynthEditor';
import { IntervalSequencerModal, IntervalSequencerPreset } from './components/IntervalSequencerModal';
import { PianoRollEditor } from './components/PianoRollEditor';
import { FxChain } from './components/FxChain';
import { PluginScannerModal } from './components/PluginScannerModal';
import { AddTrackModal, AddTrackOptions } from './components/AddTrackModal';
import { SettingsModal } from './components/SettingsModal';
import { BrowserPanel } from './components/BrowserPanel';
import { VirtualAnalogSynthEditor } from './components/VirtualAnalogSynthEditor';
import { VoiceChangerEditor } from './components/VoiceChangerEditor';
import { EqualizerModal } from './components/EqualizerModal';
import { ThemeId, THEMES, getSavedThemeId, saveThemeId, withAlpha } from './theme';
import { ThemeProvider } from './hooks/useTheme';
import {
    IconPause,
    IconPlay,
    IconRecord,
    IconStop,
    IconSynth,
    IconMidi,
    IconTimer,
    IconPin,
    IconVideo,
    IconWaveform,
    IconPiano,
    IconMic,
    IconSettings,
    IconMicrophone,
    IconZap,
    IconPlugin,
} from './components/Icons';
import { startCountIn } from './lib/metronome';
import { ProjectStartScreen } from './components/ProjectStartScreen';
import { ProjectActionsBar } from './components/ProjectActionsBar';
import { useProjectManager } from './hooks/useProjectManager';
import { useAutoBackup } from './hooks/useAutoBackup';
import type { RecentProject } from './project/ProjectTypes';

type NoteSelection = { track: number; clip: number; notes: number[] } | null;
type CutCursor = { track: number; clip: number; timeSeconds: number } | null;
export type ViewMode = 'mv' | 'waveform' | 'studio';

export default function App() {
    const {
        recentProjects,
        currentProject,
        showProjectStart,
        saveState,
        noticeText,
        noticeTone,
        setShowProjectStart,
        showNotice,
        checkSessionChanged,
        enterProject,
        openProject: pmOpenProject,
        selectRecentProject: pmSelectRecentProject,
        saveProject: pmSaveProject,
        onBackupSuccess,
        updateRecentProject,
        forgetRecentProject,
    } = useProjectManager();

    const setError = useCallback((msg: string) => {
        if (msg) showNotice(msg, 'error');
    }, [showNotice]);
    const setNoticeTone = useCallback((_tone: 'info' | 'success' | 'error') => { }, []);

    const [themeId, setThemeId] = useState<ThemeId>(() => getSavedThemeId());
    const currentTheme = THEMES[themeId] || THEMES.vibrant;
    const [showSettings, setShowSettings] = useState(false);
    const [fxChainTrack, setFxChainTrack] = useState<number | null>(null);
    const [showPluginScanner, setShowPluginScanner] = useState(false);

    const [viewMode, setViewMode] = useState<ViewMode>('studio');
    const [status, setStatus] = useState<Status | null>(null);
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const [synth, setSynth] = useState<SynthState | null>(null);
    const [session, setSession] = useState<SessionState | null>(null);
    const [selectedNote, setSelectedNote] = useState<number>(72);
    const noteInitedRef = useRef(false);
    const [selectedClip, setSelectedClip] = useState<{ track: number; clip: number } | null>(null);
    const [selectedClips, setSelectedClips] = useState<Array<{ track: number; clip: number }>>([]);
    const [selectedClipNote, setSelectedClipNote] = useState<{ track: number; clip: number; note: number } | null>(null);
    const [selectedNotes, setSelectedNotes] = useState<NoteSelection>(null);
    const [cutCursor, setCutCursor] = useState<CutCursor>(null);
    const [cutToolActive, setCutToolActive] = useState(false);
    const [rangeToolActive, setRangeToolActive] = useState(true);
    const [dragPreview, setDragPreview] = useState<{ clips: Array<{ track: number; clip: number }>; dx: number; dy: number; targetTrack?: number } | null>(null);
    const dragRef = useRef<{ track: number; clip: number; origStart: number; origDuration?: number; startX: number; startY: number; pxPerSec: number; moved: boolean; clips: Array<{ track: number; clip: number }> } | null>(null);

    // 🎹 ピアノロールエディタステート
    const [pianoRollClip, setPianoRollClip] = useState<{ track: number; clip: number } | null>(null);

    // 🎤 クリップ選択連動の波形解析ステート
    const [focusedClipAnalysis, setFocusedClipAnalysis] = useState<Analysis | null>(null);

    // タイムライン上でクリップが選択されたら、そのクリップの解析データを非同期取得して波形解析に反映
    useEffect(() => {
        if (!selectedClip) {
            setFocusedClipAnalysis(null);
            return;
        }
        let cancelled = false;
        native.sessionGetClipAnalysis(selectedClip.track, selectedClip.clip)
            .then((an) => {
                if (!cancelled && an && an.pitch && an.pitch.length > 0) {
                    setFocusedClipAnalysis(an);
                } else if (!cancelled) {
                    setFocusedClipAnalysis(null);
                }
            })
            .catch(() => {
                if (!cancelled) setFocusedClipAnalysis(null);
            });
        return () => {
            cancelled = true;
        };
    }, [selectedClip, session]);

    // 🎛️ トラック追加モーダルステート
    const [isAddTrackModalOpen, setIsAddTrackModalOpen] = useState(false);

    // 録音カウントイン（初期値 OFF）
    const [countInEnabled, setCountInEnabled] = useState(false);
    const [countInBeat, setCountInBeat] = useState<number | null>(null);
    const countInCancelRef = useRef<(() => void) | null>(null);
    const [recSeconds, setRecSeconds] = useState(0);
    const [recStartSeconds, setRecStartSeconds] = useState(0);
    const recTimerRef = useRef<number | null>(null);

    const [octaveShift, setOctaveShift] = useState(0); // -2〜+2 (C1〜C7)
    const [presets, setPresets] = useState<SynthPreset[]>([]);
    const [midiDevices, setMidiDevices] = useState<string[]>([]);
    const [selectedMidiDevice, setSelectedMidiDevice] = useState<string>('');
    const [midiRecording, setMidiRecording] = useState(false);
    const [midiNotes, setMidiNotes] = useState<unknown[]>([]);
    const [voiceName, setVoiceName] = useState('Voice 1');
    const [selectedVoiceIdx, setSelectedVoiceIdx] = useState(0);
    const [voices, setVoices] = useState<VoiceLibraryEntry[]>([]);
    const [homeInstrumentKind, setHomeInstrumentKind] = useState<'voice' | 'virtualAnalog'>('voice');
    const [virtualAnalogPresets, setVirtualAnalogPresets] = useState<Array<{ name: string; params: Record<string, number> }>>([]);
    const [selectedVirtualAnalogPresetIdx, setSelectedVirtualAnalogPresetIdx] = useState(-1);
    const [showSynthPanel, setShowSynthPanel] = useState(false);
    const [showBrowser, setShowBrowser] = useState<boolean>(() => {
        try {
            return localStorage.getItem('voivent_show_browser') !== 'false';
        } catch {
            return true;
        }
    });
    const [browserWidth, setBrowserWidth] = useState<number>(() => {
        try {
            const saved = localStorage.getItem('voivent_browser_width');
            return saved ? Math.max(220, Math.min(600, parseInt(saved, 10))) : 290;
        } catch {
            return 290;
        }
    });
    const browserResizeRef = useRef<{ startX: number; startW: number } | null>(null);

    const handleBrowserResizeStart = useCallback((e: ReactPointerEvent) => {
        e.preventDefault();
        browserResizeRef.current = { startX: e.clientX, startW: browserWidth };
        const onMove = (moveEv: PointerEvent) => {
            if (!browserResizeRef.current) return;
            const delta = browserResizeRef.current.startX - moveEv.clientX;
            const nextW = Math.max(200, Math.min(560, browserResizeRef.current.startW + delta));
            setBrowserWidth(nextW);
        };
        const onUp = () => {
            browserResizeRef.current = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            try {
                setBrowserWidth((finalW) => {
                    localStorage.setItem('voivent_browser_width', String(finalW));
                    return finalW;
                });
            } catch { }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [browserWidth]);

    const toggleBrowser = useCallback(() => {
        setShowBrowser((prev) => {
            const next = !prev;
            try {
                localStorage.setItem('voivent_show_browser', String(next));
            } catch { }
            return next;
        });
    }, []);
    const [virtualAnalogTrack, setVirtualAnalogTrack] = useState<{ index: number; name: string } | null>(null);
    const [voiceChangerTrack, setVoiceChangerTrack] = useState<{ index: number; name: string } | null>(null);
    const [showKeyboard, setShowKeyboard] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('voivent_show_keyboard');
            return saved !== null ? saved === 'true' : true;
        } catch {
            return true;
        }
    });
    const [voiceSynthEnabled, setVoiceSynthEnabled] = useState<boolean>(true);

    const handleToggleVoiceSynth = useCallback(async () => {
        setVoiceSynthEnabled((prev) => {
            const next = !prev;
            void native.setVoiceSynthEnabled(next);
            return next;
        });
    }, []);

    const toggleKeyboard = useCallback(() => {
        setShowKeyboard((prev) => {
            const next = !prev;
            try {
                localStorage.setItem('voivent_show_keyboard', String(next));
            } catch { }
            return next;
        });
    }, []);

    const [editingClipTarget, setEditingClipTarget] = useState<{ track: number; clip: number } | null>(null);
    const [eqModalClip, setEqModalClip] = useState<{ track: number; clip: number } | null>(null);
    const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
    const [followPlayhead, setFollowPlayhead] = useState<boolean>(() => {
        try {
            return localStorage.getItem('voivent_follow_playhead') !== 'false';
        } catch {
            return true;
        }
    });

    const toggleFollowPlayhead = useCallback(() => {
        setFollowPlayhead((prev) => {
            const next = !prev;
            try {
                localStorage.setItem('voivent_follow_playhead', String(next));
            } catch { }
            return next;
        });
    }, []);

    const [zoomAnchorMode, setZoomAnchorMode] = useState<'mouse' | 'playhead'>(() => {
        try {
            return (localStorage.getItem('voivent_zoom_anchor_mode') as 'mouse' | 'playhead') || 'mouse';
        } catch {
            return 'mouse';
        }
    });

    const handleSetZoomAnchorMode = useCallback((mode: 'mouse' | 'playhead') => {
        setZoomAnchorMode(mode);
        try {
            localStorage.setItem('voivent_zoom_anchor_mode', mode);
        } catch { }
    }, []);

    const [visualizerHeight, setVisualizerHeight] = useState<number>(220);
    const isResizingVisualizerRef = useRef(false);

    const handleVisualizerResizePointerDown = (e: ReactPointerEvent) => {
        isResizingVisualizerRef.current = true;
        const startY = e.clientY;
        const startH = visualizerHeight;

        const onPointerMove = (moveEv: PointerEvent) => {
            if (!isResizingVisualizerRef.current) return;
            const delta = moveEv.clientY - startY;
            setVisualizerHeight(Math.max(100, Math.min(550, startH + delta)));
        };

        const onPointerUp = () => {
            isResizingVisualizerRef.current = false;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    const refreshStatus = useCallback(async () => {
        try {
            setStatus((await native.getStatus()) as Status);
        } catch (e) {
            setNoticeTone('error');
            setError(String(e));
        }
    }, []);

    // シンセエディタ表示時は裏でタイムラインやシーケンサーが鳴らないよう自動停止
    useEffect(() => {
        if (showSynthPanel) {
            native.stopSessionPlayback().catch(() => { });
            native.setSequencerPlaying(false).catch(() => { });
        }
    }, [showSynthPanel]);

    const refreshAnalysis = useCallback(async () => {
        try {
            const a = (await native.getAnalysis()) as Analysis | null;
            if (a && a.peaks) setAnalysis(a);
        } catch (e) {
            setNoticeTone('error');
            setError(String(e));
        }
    }, []);

    const refreshSynth = useCallback(async () => {
        try {
            const s = (await native.getSynthState()) as SynthState | null;
            if (s && typeof s.stepCount === 'number') setSynth(s);
        } catch (e) {
            setNoticeTone('error');
            setError(String(e));
        }
    }, []);

    const refreshSession = useCallback(async (): Promise<SessionState | null> => {
        try {
            const s = (await native.getSessionState()) as SessionState | null;
            if (s && Array.isArray(s.tracks)) {
                setSession(s);
                return s;
            }
        } catch (e) {
            setNoticeTone('error');
            setError(String(e));
        }
        return null;
    }, []);

    // クリック時：トラックは増やさず、既存トラックでシンセ画面を開く
    // ※ getStatus() は session を含まないため、セッション状態は refreshSession() 管理の state から参照する
    const openVirtualAnalogInstrument = useCallback(async () => {
        const tracks = session?.tracks ?? [];
        const armedIdx = tracks.findIndex((t) => t.armed);
        const targetIdx = selectedClip ? selectedClip.track : (armedIdx >= 0 ? armedIdx : 0);
        const safeIdx = Math.max(0, targetIdx);
        const name = tracks[safeIdx]?.name ?? (tracks.length > 0 ? `Track ${safeIdx + 1}` : 'VA Synth');
        setVirtualAnalogTrack({ index: safeIdx, name });
    }, [session?.tracks, selectedClip]);

    // ドラッグ＆ドロップ時：新しい VA Synth トラックを 1 本作成してシンセ画面を開く
    const handleDropVirtualAnalog = useCallback(async () => {
        const tracks = session?.tracks ?? [];
        const trackName = `VA Synth ${tracks.length + 1}`;
        await native.sessionAddTrack(trackName, '#b92f42', true, 'midi');
        const updatedSession = await refreshSession();
        const index = Math.max(0, (updatedSession?.tracks.length ?? 1) - 1);
        setVirtualAnalogTrack({ index, name: trackName });
        setNoticeTone('info');
        setError(`新規トラック「${trackName}」を作成しました`);
    }, [session?.tracks, refreshSession]);

    const [showIntervalSequencer, setShowIntervalSequencer] = useState(false);

    const handleApplyIntervalSequenceToTimeline = useCallback(async (preset: IntervalSequencerPreset) => {
        try {
            // 1. アクティブなトラック、または選択中のトラックを取得
            const trackIdx = selectedClip ? selectedClip.track : session?.tracks?.findIndex((t) => t.armed) ?? 0;
            const targetTrack = Math.max(0, trackIdx >= 0 ? trackIdx : 0);
            const startPos = status?.sessionPosition ?? 0;

            // 2. 音源の設定を適用
            if (preset.instrumentKind === 'virtualAnalog') {
                await native.setVirtualAnalogEnabled(true);
                await native.setVoiceSynthEnabled(false);
                setHomeInstrumentKind('virtualAnalog');
            } else {
                await native.setVirtualAnalogEnabled(false);
                await native.setVoiceSynthEnabled(true);
                setHomeInstrumentKind('voice');
            }

            // 3. シーケンスフレーズの音符列をレンダリングしてタイムラインに挿入
            const isVa = preset.instrumentKind === 'virtualAnalog';
            const bpm = synth?.bpm ?? 120;
            await native.sessionInsertSequenceClip(
                targetTrack,
                preset.notes || [],
                preset.rootNote || 48,
                preset.lengthBars || 1,
                bpm,
                isVa,
                startPos
            );
            await refreshSession();
            setNoticeTone('info');
            setError(`フレーズ「${preset.name}」をトラック ${targetTrack + 1} のタイムラインに配置しました`);
        } catch (e) {
            console.error('Failed to apply interval sequence to timeline:', e);
        }
    }, [selectedClip, session?.tracks, status?.sessionPosition, synth?.bpm, refreshSession]);

    const openSelectedVirtualAnalog = useCallback(async () => {
        await native.setVirtualAnalogEnabled(true);
        await openVirtualAnalogInstrument();
    }, [openVirtualAnalogInstrument]);

    const openVoiceChangerForTrack = useCallback((track: number) => {
        const safeTrack = Math.max(0, track);
        const name = session?.tracks?.[safeTrack]?.name ?? `トラック ${safeTrack + 1}`;
        setVoiceChangerTrack({ index: safeTrack, name });
        setFxChainTrack(null);
    }, [session?.tracks]);

    // セッション変更検知
    useEffect(() => {
        checkSessionChanged(session);
    }, [session, checkSessionChanged]);

    const refreshPresets = useCallback(async () => {
        try {
            const p = await native.getPresets();
            if (Array.isArray(p)) setPresets(p as SynthPreset[]);
        } catch (e) {
            setNoticeTone('error');
            setError(String(e));
        }
    }, []);

    const refreshVoices = useCallback(async () => {
        try {
            const v = await native.getVoices();
            if (Array.isArray(v)) setVoices(v as VoiceLibraryEntry[]);
        } catch (e) {
            setNoticeTone('error');
            setError(String(e));
        }
    }, []);

    const refreshVirtualAnalogPresets = useCallback(async () => {
        try {
            const items = await native.getVirtualAnalogPresets();
            if (Array.isArray(items)) setVirtualAnalogPresets(items as Array<{ name: string; params: Record<string, number> }>);
        } catch (e) {
            setError(String(e));
        }
    }, [setError]);

    const refreshMidiDevices = useCallback(async () => {
        try {
            const d = await native.getMidiDevices();
            if (Array.isArray(d)) setMidiDevices(d);
        } catch (e) {
            setNoticeTone('error');
            setError(String(e));
        }
    }, []);

    const refreshMidiNotes = useCallback(async () => {
        try {
            const n = await native.getMidiNotes();
            if (Array.isArray(n)) setMidiNotes(n);
        } catch (e) {
            setError(String(e));
        }
    }, []);

    // 初期状態取得 + 定期的な状態ポーリング
    useEffect(() => {
        refreshStatus();
        refreshSynth();
        refreshSession();
        refreshPresets();
        refreshMidiDevices();
        refreshMidiNotes();
        refreshVoices();
        refreshVirtualAnalogPresets();

        // 起動時プラグインチェック（未スキャンの場合は隔離スキャナーを自動起動）
        void native.getScannedPlugins().then((plugins) => {
            if (!Array.isArray(plugins) || plugins.length === 0) {
                setShowPluginScanner(true);
            }
        }).catch(() => { });

        const id = setInterval(() => {
            refreshStatus();
            refreshSynth();
            refreshSession();
        }, 50);
        return () => clearInterval(id);
    }, [refreshStatus, refreshSynth, refreshSession, refreshPresets, refreshMidiDevices, refreshMidiNotes, refreshVoices, refreshVirtualAnalogPresets]);

    // VA画面で追加された音色をホームの音源一覧へ反映する
    useEffect(() => {
        const id = window.setInterval(() => {
            void refreshVirtualAnalogPresets();
        }, 1000);
        return () => window.clearInterval(id);
    }, [refreshVirtualAnalogPresets]);

    // C++ からの analysisReady / statusUpdate イベントをリアルタイム購読
    useEffect(() => {
        let handleAnalysis: [string, number] | undefined;
        let handleStatus: [string, number] | undefined;
        let handlePluginsRestored: [string, number] | undefined;
        try {
            handleAnalysis = window.__JUCE__.backend.addEventListener('analysisReady', () => {
                refreshAnalysis();
                refreshStatus();
                refreshSynth();
                refreshVoices();
            });
            // プロジェクトロード時のプラグインチェーン非同期復元完了を購読
            handlePluginsRestored = window.__JUCE__.backend.addEventListener('pluginsRestored', () => {
                void refreshSession();
            });
            handleStatus = window.__JUCE__.backend.addEventListener('statusUpdate', (newStatus: unknown) => {
                if (newStatus && typeof newStatus === 'object') {
                    setStatus(newStatus as Status);
                }
            });
        } catch (_e) {
            // ネイティブ連携が無い環境（ブラウザ単体テスト）では無視
        }
        return () => {
            if (handleAnalysis) window.__JUCE__.backend.removeEventListener(handleAnalysis);
            if (handleStatus) window.__JUCE__.backend.removeEventListener(handleStatus);
            if (handlePluginsRestored) window.__JUCE__.backend.removeEventListener(handlePluginsRestored);
        };
    }, [refreshAnalysis, refreshStatus, refreshSynth, refreshVoices, refreshSession]);

    // 音声ありなら解析を取得
    useEffect(() => {
        if (status?.hasVoice) refreshAnalysis();
    }, [status?.hasVoice, refreshAnalysis]);

    // 録音開始時にノート初期化フラグをリセット
    useEffect(() => {
        if (status?.isRecording) noteInitedRef.current = false;
    }, [status?.isRecording]);

    // 音源の基音を選択ノートの初期値にする
    useEffect(() => {
        if (synth?.hasVoice && !noteInitedRef.current) {
            noteInitedRef.current = true;
            setSelectedNote(synth.baseMidiNote);
        }
    }, [synth]);

    // 画面外でポインタを離したときにノートが鳴り続けないようにする
    useEffect(() => {
        const up = () => native.allNotesOff();
        const onKeyDownGlobal = async (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

            // ↩️ Cmd+Z / Ctrl+Z (Undo)
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                await native.sessionUndo();
                await refreshSession();
                await refreshStatus();
                setSelectedClip(null);
                setSelectedClips([]);
                setSelectedNotes(null);
                return;
            }

            // ↪️ Cmd+Shift+Z / Ctrl+Shift+Z / Ctrl+Y (Redo)
            if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
                ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y')) {
                e.preventDefault();
                await native.sessionRedo();
                await refreshSession();
                await refreshStatus();
                setSelectedClip(null);
                setSelectedClips([]);
                setSelectedNotes(null);
                return;
            }

            // 💾 Cmd+S / Ctrl+S (プロジェクト保存)
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                handleSaveProject();
                return;
            }

            // 📂 Cmd+O / Ctrl+O (プロジェクトを開く)
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                handleOpenProject();
                return;
            }

            // Space: セッション再生 / 停止
            if (e.key === ' ' && !e.repeat) {
                e.preventDefault();
                if (status?.isSessionPlaying) await native.stopSessionPlayback();
                else await native.startSessionPlayback();
                await refreshStatus();
                return;
            }

            // Return / Enter: 再生ヘッドを先頭へ戻す
            if (e.key === 'Enter') {
                e.preventDefault();
                await native.setSessionPosition(0);
                await refreshStatus();
                return;
            }

            // R / *: マスター録音トグル（キーリピートで開始/停止が高速往復するのを防止）
            if ((e.key === 'r' || e.key === 'R' || e.key === '*') && !e.repeat) {
                e.preventDefault();
                onRecordToggle();
                return;
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedNotes && selectedNotes.notes.length > 0) {
                    e.preventDefault();
                    onDeleteNotes();
                } else if (selectedClips && selectedClips.length > 0) {
                    e.preventDefault();
                    onDeleteClips(selectedClips);
                } else if (selectedClip) {
                    e.preventDefault();
                    onDeleteClip(selectedClip.track, selectedClip.clip);
                }
            }
        };

        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        window.addEventListener('keydown', onKeyDownGlobal);
        return () => {
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            window.removeEventListener('keydown', onKeyDownGlobal);
        };
    }, [currentProject, selectedNotes, selectedClip, selectedClips, refreshSession, refreshStatus, status?.isSessionPlaying]);

    // 🎙️ カウントイン付き録音＆停止（addToSession: false でサンプラー単体録音）
    const onRecordToggle = async (addToSession: boolean | unknown = true) => {
        const shouldAddToSession = typeof addToSession === 'boolean' ? addToSession : true;
        try {
            if (status?.isRecording) {
                // 録音停止
                if (recTimerRef.current) clearInterval(recTimerRef.current);
                setRecSeconds(0);
                setMidiNotes([]);
                await native.stopRecording();
                await refreshSession();
                await refreshStatus();
                await refreshSynth();
                await refreshAnalysis();
                await refreshVoices();
                return;
            }

            if (countInCancelRef.current) {
                // カウントイン中に停止
                countInCancelRef.current();
                countInCancelRef.current = null;
                setCountInBeat(null);
                return;
            }

            if (!countInEnabled) {
                // カウントインなし即時録音
                const curPos = status?.sessionPosition ?? 0;
                setRecStartSeconds(curPos);
                setRecSeconds(0);
                setMidiNotes([]);
                setSelectedVoiceIdx(-1);
                setVoiceName('');
                await native.startRecording(shouldAddToSession);
                const startTime = Date.now();
                recTimerRef.current = window.setInterval(async () => {
                    setRecSeconds((Date.now() - startTime) / 1000);
                    try {
                        const notes = await native.getMidiNotes();
                        if (Array.isArray(notes)) setMidiNotes(notes);
                    } catch (_) { }
                }, 40);
                await refreshStatus();
                await refreshSynth();
                return;
            }

            // 1小節（4カウント）のプリカウントイン実行
            const bpm = synth?.bpm ?? 120;
            const cancel = startCountIn({
                bpm,
                beats: 4,
                onTick: (beat) => {
                    setCountInBeat(beat);
                },
                onComplete: async () => {
                    setCountInBeat(null);
                    countInCancelRef.current = null;
                    const curPos = status?.sessionPosition ?? 0;
                    setRecStartSeconds(curPos);
                    setRecSeconds(0);
                    setMidiNotes([]);
                    setSelectedVoiceIdx(-1);
                    setVoiceName('');
                    await native.startRecording(shouldAddToSession);
                    const startTime = Date.now();
                    recTimerRef.current = window.setInterval(async () => {
                        setRecSeconds((Date.now() - startTime) / 1000);
                        try {
                            const notes = await native.getMidiNotes();
                            if (Array.isArray(notes)) setMidiNotes(notes);
                        } catch (_) { }
                    }, 40);
                    await refreshStatus();
                    await refreshSynth();
                },
            });
            countInCancelRef.current = cancel;
        } catch (e) {
            setNoticeTone('error');
            setError(String(e));
            setCountInBeat(null);
        }
    };

    const onPlayToggle = async () => {
        try {
            if (status?.isPlaying) await native.stopPlayback();
            else await native.startPlayback();
            await refreshStatus();
        } catch (e) {
            setNoticeTone('error');
            setError(String(e));
        }
    };

    const onKeyDown = (note: number) => {
        setSelectedNote(note);
        const armedIdx = session?.tracks?.findIndex((t) => t.armed) ?? -1;
        const targetTrack = armedIdx >= 0 ? armedIdx : (selectedClip?.track ?? -1);
        if (homeInstrumentKind === 'virtualAnalog') {
            void native.virtualAnalogNoteOn(note, 1);
        } else {
            void native.noteOn(note, 1, targetTrack);
        }
    };
    const onKeyUp = (note: number) => {
        const armedIdx = session?.tracks?.findIndex((t) => t.armed) ?? -1;
        const targetTrack = armedIdx >= 0 ? armedIdx : (selectedClip?.track ?? -1);
        if (homeInstrumentKind === 'virtualAnalog') {
            void native.virtualAnalogNoteOff(note);
        } else {
            void native.noteOff(note, targetTrack);
        }
    };

    const onParamChange = async (patch: Partial<SynthState['params']>) => {
        if (!synth) return;
        const params = { ...synth.params, ...patch };
        await native.synthSetParams(params);
        setSynth((s) => (s ? { ...s, params } : s));
    };

    const onSaveVoice = async () => {
        const name = voiceName.trim();
        if (!name) return;
        const newIdx = await native.saveVoice(name);
        const vList = await native.getVoices();
        if (Array.isArray(vList)) {
            setVoices(vList as VoiceLibraryEntry[]);
            const targetIdx = typeof newIdx === 'number' && newIdx >= 0 ? newIdx : vList.length - 1;
            setSelectedVoiceIdx(targetIdx);
            if (vList[targetIdx]) {
                setVoiceName(vList[targetIdx].name);
            }
        }
    };

    const onLoadVoice = async (index: number) => {
        await native.loadVoice(index);
        if (voices[index]) {
            setVoiceName(voices[index].name);
        }
        setSelectedVoiceIdx(index);
        setHomeInstrumentKind('voice');
        await native.setVirtualAnalogEnabled(false);
        await native.setVoiceSynthEnabled(true);
        setVoiceSynthEnabled(true);
        await refreshSynth();
        await refreshStatus();
        await refreshAnalysis();
    };

    const onRenameVoice = async (index: number, newName: string) => {
        if (!newName.trim()) return;
        await native.renameVoice(index, newName.trim());
        await refreshVoices();
    };

    const onDeleteVoice = async (index: number) => {
        await native.deleteVoice(index);
        await refreshVoices();
    };

    const onMidiDeviceChange = async (deviceName: string) => {
        setSelectedMidiDevice(deviceName);
        await native.setMidiDevice(deviceName);
    };

    const onMidiRecordToggle = async () => {
        try {
            if (midiRecording) {
                // MIDI 録音停止
                if (recTimerRef.current) clearInterval(recTimerRef.current);
                setRecSeconds(0);
                await native.stopMidiRecording();
                if (status?.isSessionPlaying) {
                    await native.stopSessionPlayback();
                }
                setMidiRecording(false);
                await refreshMidiNotes();
                await refreshSession();
                await refreshStatus();
            } else {
                // MIDI 録音開始（セッション再生と連動してヘッド位置から記録）
                const startPos = status?.sessionPosition ?? 0;
                setRecStartSeconds(startPos);
                setRecSeconds(0);
                const startTime = Date.now();
                if (recTimerRef.current) clearInterval(recTimerRef.current);
                recTimerRef.current = window.setInterval(async () => {
                    setRecSeconds((Date.now() - startTime) / 1000);
                    try {
                        const notes = await native.getMidiNotes();
                        if (Array.isArray(notes)) setMidiNotes(notes);
                    } catch (_) { }
                }, 40);

                if (!status?.isSessionPlaying) {
                    await native.startSessionPlayback();
                }
                await native.startMidiRecording();
                setMidiRecording(true);
                await refreshStatus();
            }
        } catch (e) {
            console.error('[MIDI Recording Error]', e);
        }
    };

    const onSessionPlayToggle = async () => {
        if (status?.isSessionPlaying) await native.stopSessionPlayback();
        else await native.startSessionPlayback();
        refreshStatus();
    };

    const onAddTrack = () => {
        setIsAddTrackModalOpen(true);
    };

    const handleConfirmAddTrack = async (options: AddTrackOptions) => {
        const count = Math.max(1, Math.min(16, options.count || 1));
        for (let i = 0; i < count; i++) {
            const trackName = count > 1 ? `${options.name} ${i + 1}` : options.name;
            await native.sessionAddTrack(trackName, options.color, options.isStereo, options.inputType || 'audio');
        }
        refreshSession();
    };

    const onSetTrackInputType = async (trackIndex: number, inputType: 'audio' | 'midi') => {
        await native.sessionSetTrackInputType(trackIndex, inputType);
        refreshSession();
    };

    const onDeleteTrack = async (trackIndex: number) => {
        await native.sessionDeleteTrack(trackIndex);
        refreshSession();
    };

    const onArmed = async (trackIndex: number, v: boolean) => {
        await native.sessionSetTrackArmed(trackIndex, v);
        refreshSession();
    };

    const onMonitor = async (trackIndex: number, v: boolean) => {
        await native.sessionSetTrackMonitor(trackIndex, v);
        refreshSession();
    };

    const onMute = async (trackIndex: number, v: boolean) => {
        await native.sessionSetTrackMute(trackIndex, v);
        refreshSession();
    };

    const onSolo = async (trackIndex: number, v: boolean) => {
        await native.sessionSetTrackSolo(trackIndex, v);
        refreshSession();
    };

    const onGain = async (trackIndex: number, v: number) => {
        await native.sessionSetTrackGain(trackIndex, v);
        setSession((s) => {
            if (!s) return s;
            const next = { ...s, tracks: s.tracks.slice() };
            next.tracks[trackIndex] = { ...next.tracks[trackIndex], gain: v };
            return next;
        });
    };

    const onPan = async (trackIndex: number, v: number) => {
        await native.sessionSetTrackPan(trackIndex, v);
        setSession((s) => {
            if (!s) return s;
            const next = { ...s, tracks: s.tracks.slice() };
            next.tracks[trackIndex] = { ...next.tracks[trackIndex], pan: v };
            return next;
        });
    };

    const onAppendClip = async (trackIndex: number) => {
        if (!status?.hasVoice) return;
        await native.sessionAppendCurrentClip(trackIndex);
        await refreshSession();
        await refreshStatus();
    };

    const onTrimClip = async (track: number, clip: number, newStart: number, sourceStart: number, duration: number) => {
        await native.sessionTrimClip(track, clip, newStart, sourceStart, duration);
        await refreshSession();
    };

    // クリップ複製（単一または複数クリップ選択時）
    const onDuplicateClip = async () => {
        if (selectedClips && selectedClips.length > 1) {
            await native.sessionDuplicateClips(selectedClips);
            clearClipSelection();
            refreshSession();
            return;
        }
        if (!selectedClip) return;
        await native.sessionDuplicateClip(selectedClip.track, selectedClip.clip);
        clearClipSelection();
        refreshSession();
    };

    // 複数選択クリップを一括複製
    const onDuplicateClips = async (clipsToDup: Array<{ track: number; clip: number }>) => {
        if (!clipsToDup || clipsToDup.length === 0) return;
        await native.sessionDuplicateClips(clipsToDup);
        clearClipSelection();
        refreshSession();
    };

    // 選択ノート（複数）を複製
    const onDuplicateNotes = async () => {
        if (!selectedNotes) return;
        await native.sessionDuplicateClipNotes(selectedNotes.track, selectedNotes.clip, selectedNotes.notes);
        clearClipSelection();
        refreshSession();
    };

    // 選択ノート（複数）を削除
    const onDeleteNotes = async () => {
        if (!selectedNotes) return;
        await native.sessionDeleteClipNotes(selectedNotes.track, selectedNotes.clip, selectedNotes.notes);
        clearClipSelection();
        refreshSession();
    };

    // 選択クリップを削除
    const onDeleteClip = async (track: number, clip: number) => {
        await native.sessionDeleteClip(track, clip);
        clearClipSelection();
        refreshSession();
    };

    // 複数選択クリップを一括削除
    const onDeleteClips = async (clipsToDelete: Array<{ track: number; clip: number }>) => {
        if (!clipsToDelete || clipsToDelete.length === 0) return;
        // インデックスがずれないよう、トラックごと・クリップインデックスの降順で削除
        const sorted = clipsToDelete.slice().sort((a, b) => {
            if (a.track !== b.track) return b.track - a.track;
            return b.clip - a.clip;
        });
        for (const item of sorted) {
            await native.sessionDeleteClip(item.track, item.clip);
        }
        clearClipSelection();
        refreshSession();
    };

    // ツール切替
    const onToggleCutTool = () => {
        setCutToolActive((v) => !v);
        setRangeToolActive(false);
    };

    const onToggleRangeTool = () => {
        setRangeToolActive((v) => !v);
        setCutToolActive(false);
    };

    // カットカーソル位置でクリップ分割
    const onCutAtCursor = async () => {
        if (!cutCursor) return;
        await native.sessionSplitClip(cutCursor.track, cutCursor.clip, cutCursor.timeSeconds);
        setCutCursor(null);
        refreshSession();
    };

    const onClipPointerDown = (e: ReactPointerEvent<HTMLDivElement>, trackIndex: number, clipIndex: number, clipStart: number, pxPerSec: number) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const clicked = { track: trackIndex, clip: clipIndex };
        const isPartOfSelection = selectedClips.some((c) => c.track === trackIndex && c.clip === clipIndex);
        const clips = isPartOfSelection && selectedClips.length > 0 ? selectedClips : [clicked];
        const clipObj = session?.tracks[trackIndex]?.clips[clipIndex];
        const origDuration = clipObj?.duration ?? 2.0;
        dragRef.current = { track: trackIndex, clip: clipIndex, origStart: clipStart, origDuration, startX: e.clientX, startY: e.clientY, pxPerSec, moved: false, clips };
        setSelectedClip(clicked);
        setSelectedClips(clips);
        setSelectedClipNote(null);
        setSelectedNotes(null);
    };

    const onClipPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        const d = dragRef.current;
        if (!d) return;
        const rawDx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (!d.moved && (Math.abs(rawDx) > 3 || Math.abs(dy) > 3)) d.moved = true;
        if (d.moved) {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const row = el && typeof (el as Element).closest === 'function'
                ? (el as Element).closest('[data-track-row]')
                : null;
            const targetTrack = row ? Number(row.getAttribute('data-track-row')) : d.track;

            const proposedStart = Math.max(0, d.origStart + rawDx / d.pxPerSec);
            let snappedStart = proposedStart;

            // 1. グリッドスナップ（16分音符）
            if (snapEnabled) {
                const bpm = synth?.bpm ?? 120;
                const snapGridSec = (60 / bpm) / 4;
                snappedStart = Math.round(proposedStart / snapGridSec) * snapGridSec;
            }

            // 2. 🧲 クリップ端スマートマグネットスナップ（近傍 14px 以内のクリップ端にピタッと吸着）
            const magnetThresholdSec = 14 / d.pxPerSec;
            const checkTrackIdx = !Number.isNaN(targetTrack) ? targetTrack : d.track;
            const targetTrackObj = session?.tracks[checkTrackIdx];
            if (targetTrackObj) {
                const proposedEnd = proposedStart + (d.origDuration ?? 2.0);
                for (let ci = 0; ci < targetTrackObj.clips.length; ci++) {
                    if (checkTrackIdx === d.track && ci === d.clip) continue;
                    const oc = targetTrackObj.clips[ci];
                    const ocStart = oc.start;
                    const ocEnd = oc.start + oc.duration;

                    // ドラッグ中クリップの先頭が他クリップの末尾に吸着
                    if (Math.abs(proposedStart - ocEnd) < magnetThresholdSec) {
                        snappedStart = ocEnd;
                        break;
                    }
                    // ドラッグ中クリップの先頭が他クリップの先頭に吸着
                    if (Math.abs(proposedStart - ocStart) < magnetThresholdSec) {
                        snappedStart = ocStart;
                        break;
                    }
                    // ドラッグ中クリップの末尾が他クリップの先頭に吸着
                    if (Math.abs(proposedEnd - ocStart) < magnetThresholdSec) {
                        snappedStart = Math.max(0, ocStart - (d.origDuration ?? 2.0));
                        break;
                    }
                }
            }

            const finalDeltaSec = snappedStart - d.origStart;
            const finalDx = finalDeltaSec * d.pxPerSec;
            setDragPreview({
                clips: d.clips,
                dx: finalDx,
                dy,
                targetTrack: !Number.isNaN(targetTrack) ? targetTrack : undefined,
            });
        }
    };

    const onClipPointerUp = async (e: ReactPointerEvent<HTMLDivElement>) => {
        const d = dragRef.current;
        const currentPreview = dragPreview;
        dragRef.current = null;
        setDragPreview(null);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { }
        if (!d || !d.moved) return;

        const deltaSec = currentPreview ? (currentPreview.dx / d.pxPerSec) : ((e.clientX - d.startX) / d.pxPerSec);
        const newStart = Math.max(0, d.origStart + deltaSec);

        const el = document.elementFromPoint(e.clientX, e.clientY);
        const row = el && typeof (el as Element).closest === 'function'
            ? (el as Element).closest('[data-track-row]')
            : null;
        const targetTrack = row ? Number(row.getAttribute('data-track-row')) : d.track;

        // 🎯 楽観的UI更新（Optimistic Update）: 離した瞬間のピクセル位置とトラック移動を即時反映！
        if (session) {
            setSession((prev) => {
                if (!prev) return prev;
                const nextTracks = prev.tracks.map((tr) => ({ ...tr, clips: [...tr.clips] }));
                if (targetTrack === d.track) {
                    for (const item of d.clips) {
                        const tr = nextTracks[item.track];
                        if (tr && tr.clips[item.clip]) {
                            const c = tr.clips[item.clip];
                            tr.clips[item.clip] = { ...c, start: Math.max(0, c.start + deltaSec) };
                        }
                    }
                } else if (!Number.isNaN(targetTrack) && nextTracks[targetTrack]) {
                    const srcTr = nextTracks[d.track];
                    if (srcTr && srcTr.clips[d.clip]) {
                        const [movedClip] = srcTr.clips.splice(d.clip, 1);
                        if (movedClip) {
                            movedClip.start = newStart;
                            nextTracks[targetTrack].clips.push(movedClip);
                        }
                    }
                }
                return { ...prev, tracks: nextTracks };
            });
        }

        if (targetTrack === d.track && d.clips.length > 1) {
            await native.sessionMoveClips(d.clips, deltaSec);
        } else if (targetTrack === d.track) {
            await native.sessionMoveClip(d.track, d.clip, newStart);
        } else if (!Number.isNaN(targetTrack)) {
            await native.sessionMoveClipToTrack(d.track, d.clip, targetTrack, newStart);
        }
        await refreshSession();
    };

    // 🎹 ピアノロール操作ハンドラー
    const onPianoRollUpdateNote = async (
        track: number,
        clip: number,
        noteIndex: number,
        midi: number,
        start: number,
        end: number,
        velocity?: number
    ) => {
        await native.sessionUpdateClipNote(track, clip, noteIndex, midi, start, end, velocity ?? 0.8);
        refreshSession();
    };

    const onPianoRollAddNote = async (
        track: number,
        clip: number,
        midi: number,
        start: number,
        end: number,
        velocity?: number
    ) => {
        await native.sessionAddClipNote(track, clip, midi, start, end, velocity ?? 0.8);
        refreshSession();
    };

    const onPianoRollDeleteNote = async (track: number, clip: number, noteIndex: number) => {
        await native.sessionDeleteClipNote(track, clip, noteIndex);
        refreshSession();
    };

    const onPianoRollPreviewNote = async (midi: number, velocity: number = 0.8) => {
        const level = Math.min(1.0, Math.max(0.1, velocity));
        if (homeInstrumentKind === 'virtualAnalog') {
            await native.virtualAnalogNoteOn(midi, level);
            setTimeout(() => void native.virtualAnalogNoteOff(midi), 220);
        } else {
            await native.noteOn(midi, level);
            setTimeout(() => void native.noteOff(midi), 220);
        }
    };

    const clearClipSelection = () => {
        setSelectedClip(null);
        setSelectedClips([]);
        setSelectedClipNote(null);
        setSelectedNotes(null);
    };

    //--------------------------------------------------------------------------
    // 表示用の派生値（5オクターブ 61鍵のワイドキーボード）
    //--------------------------------------------------------------------------
    const { keys, width: kbWidth } = buildKeys(2 + octaveShift, 5);
    const stepCount = synth?.stepCount ?? 16;
    const pattern = synth?.pattern ?? Array(16).fill(-1);
    const hasVoice = !!synth?.hasVoice;

    const toggleStep = async (i: number) => {
        if (!hasVoice) return;
        const cur = pattern[i];
        const next = cur === selectedNote ? -1 : selectedNote;
        await native.setStep(i, next);
        refreshSynth();
    };

    const onSeqPlayToggle = async () => {
        await native.setSequencerPlaying(!synth?.playing);
        refreshSynth();
    };

    const onBpmChange = async (v: number) => {
        await native.setBpm(v);
        setSynth((s) => (s ? { ...s, bpm: v } : s));
    };

    const handleCreateProject = useCallback(async (name: string, tags: string[], color?: string) => {
        const trimmedName = name.trim();
        if (!trimmedName) return;

        try {
            showNotice('保存場所を選択してください。', 'info');
            const selectedParentPath = await native.saveProjectDialog();
            if (typeof selectedParentPath !== 'string' || !selectedParentPath) return;

            const safeName = trimmedName.replace(/[\\/:*?"<>|]/g, '_');
            const projectPath = `${selectedParentPath.replace(/\/+$/, '')}/${safeName}`;
            // 🆕 新規作成時は直前のセッションを引き継がず、まっさらな初期状態にリセット
            await native.clearSession();
            const ok = await native.saveProject(projectPath);
            if (!ok) throw new Error('プロジェクトを作成できませんでした。');

            const nowIso = new Date().toISOString();
            const project: RecentProject = {
                id: projectPath,
                name: trimmedName,
                path: projectPath,
                updatedAt: nowIso,
                tags,
                color,
            };
            const createdSession = await refreshSession();
            enterProject(project, createdSession);
            await refreshStatus();
            showNotice('プロジェクトを作成しました。', 'success');
        } catch (e) {
            showNotice(String(e), 'error');
        }
    }, [enterProject, refreshSession, refreshStatus, showNotice]);

    const handleSaveProject = useCallback(() => {
        void pmSaveProject(session, refreshSession);
    }, [pmSaveProject, session, refreshSession]);

    const handleOpenProject = useCallback(() => {
        void pmOpenProject(refreshSession, refreshStatus);
    }, [pmOpenProject, refreshSession, refreshStatus]);

    const handleSelectRecentProject = useCallback((project: RecentProject) => {
        void pmSelectRecentProject(project, refreshSession, refreshStatus);
    }, [pmSelectRecentProject, refreshSession, refreshStatus]);

    // 🛡️ 自動バックアップ（アイドル時5分間隔、最大10世代保存）
    useAutoBackup({
        project: currentProject,
        saveState,
        isPlaying: Boolean(status?.isPlaying || status?.isSessionPlaying),
        isRecording: Boolean(status?.isRecording),
        intervalMinutes: 5,
        maxBackups: 10,
        onBackupSuccess,
    });

    if (showProjectStart) {
        return (
            <ProjectStartScreen
                recentProjects={recentProjects}
                onCreate={handleCreateProject}
                onOpen={handleOpenProject}
                onSelectRecent={handleSelectRecentProject}
                onUpdateProject={updateRecentProject}
                onForgetRecent={forgetRecentProject}
            />
        );
    }

    return (
        <ThemeProvider theme={currentTheme} themeId={themeId}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxHeight: '100vh', overflow: 'hidden', background: currentTheme.bgApp, color: currentTheme.textMain, transition: 'background-color 0.2s ease, color 0.2s ease' }}>
                <ProjectActionsBar
                    project={currentProject}
                    saveState={saveState}
                    noticeText={noticeText}
                    noticeTone={noticeTone}
                    onBackToProjects={() => setShowProjectStart(true)}
                    onSave={handleSaveProject}
                    onOpenProject={handleOpenProject}
                    onNewProject={() => setShowProjectStart(true)}
                />
                {/* 🎛️ 画面最上部：固定統合ナビゲーションバー（モードが変わっても常に同じ固定位置） */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 14px',
                        background: currentTheme.bgHeader,
                        borderBottom: `1px solid ${currentTheme.border}`,
                        zIndex: 100,
                        flexShrink: 0,
                        userSelect: 'none',
                        position: 'relative',
                    }}
                >
                    {/* 左側：スタイリッシュなテキストロゴ（ロボットアイコンなし、DAWはブルー） */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, padding: '2px 6px', userSelect: 'none' }}>
                        <span style={{ fontSize: 16, fontWeight: 900, color: '#ffffff', letterSpacing: '0.6px' }}>Voivent</span>
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#3b82f6', letterSpacing: '1.4px' }}>DAW</span>
                    </div>

                    {/* 中央：固定位置の 3 つの画面モード切替タブ（画面中央にパーフェクト整列） */}
                    <div
                        style={{
                            position: 'absolute',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            background: currentTheme.bgInset,
                            border: `1px solid ${currentTheme.border}`,
                            borderRadius: 8,
                            padding: 3,
                            boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.6)',
                        }}
                    >
                        {/* 🎬 MVモード */}
                        <button
                            onClick={() => setViewMode('mv')}
                            style={{
                                background: viewMode === 'mv' ? withAlpha(currentTheme.accentSecondary, 0.18) : 'transparent',
                                color: viewMode === 'mv' ? currentTheme.accentSecondary : currentTheme.textMuted,
                                border: viewMode === 'mv' ? `1px solid ${withAlpha(currentTheme.accentSecondary, 0.45)}` : '1px solid transparent',
                                borderRadius: 6,
                                padding: '5px 13px',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                transition: 'all 0.15s ease',
                            }}
                            title="エモいオーディオリアクティブ演出・動画書き出し"
                        >
                            <IconVideo size={13} color={viewMode === 'mv' ? currentTheme.accentSecondary : currentTheme.textMuted} />
                            <span>MVモード</span>
                        </button>

                        {/* 🌊 波形解析モード（目に優しいソフトダークグリーン） */}
                        <button
                            onClick={() => setViewMode('waveform')}
                            style={{
                                background: viewMode === 'waveform' ? withAlpha(currentTheme.accent, 0.16) : 'transparent',
                                color: viewMode === 'waveform' ? currentTheme.accent : currentTheme.textMuted,
                                border: viewMode === 'waveform' ? `1px solid ${withAlpha(currentTheme.accent, 0.45)}` : '1px solid transparent',
                                borderRadius: 6,
                                padding: '5px 13px',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                transition: 'all 0.15s ease',
                            }}
                            title="リアルタイム高精度 FFT 周波数スペクトラム・波形解析"
                        >
                            <IconWaveform size={13} color={viewMode === 'waveform' ? currentTheme.accent : currentTheme.textMuted} />
                            <span>波形解析</span>
                        </button>

                        {/* 🎹 作曲・トラック編集モード（他の2つと同じ上品なダークアクセント枠） */}
                        <button
                            onClick={() => setViewMode('studio')}
                            style={{
                                background: viewMode === 'studio' ? withAlpha(currentTheme.accentInfo, 0.14) : 'transparent',
                                color: viewMode === 'studio' ? currentTheme.accentInfo : currentTheme.textMuted,
                                border: viewMode === 'studio' ? `1px solid ${withAlpha(currentTheme.accentInfo, 0.45)}` : '1px solid transparent',
                                borderRadius: 6,
                                padding: '5px 13px',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                transition: 'all 0.15s ease',
                            }}
                            title="タイムラインとトラックを広々編集（制作集中モード）"
                        >
                            <IconPiano size={13} color={viewMode === 'studio' ? currentTheme.accentInfo : currentTheme.textMuted} />
                            <span>作曲モード</span>
                        </button>
                    </div>

                    {/* 右側：声シンセ呼び出しボタン & ⚙️ 設定ボタン */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                            onClick={toggleBrowser}
                            style={{
                                background: showBrowser ? 'rgba(59, 130, 246, 0.22)' : '#14171e',
                                color: showBrowser ? '#93c5fd' : '#dcdfe4',
                                border: showBrowser ? '1px solid #3b82f6' : '1px solid rgba(59, 130, 246, 0.45)',
                                borderRadius: 6,
                                padding: '6px 13px',
                                fontSize: 12,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                boxShadow: showBrowser ? '0 0 10px rgba(59, 130, 246, 0.3)' : 'none',
                            }}
                            title="ブラウザーパネル（音源・エフェクト・ファイル）を開閉"
                        >
                            <IconPlugin size={14} color={showBrowser ? '#60a5fa' : '#94a3b8'} />
                            <span>ブラウズ</span>
                        </button>
                        <button
                            onClick={() => setShowSynthPanel((v) => !v)}
                            style={{
                                background: showSynthPanel ? '#1e2b24' : '#14171e',
                                color: showSynthPanel ? '#2ecc71' : '#dcdfe4',
                                border: showSynthPanel ? '1px solid #2ecc71' : '1px solid rgba(46, 204, 113, 0.45)',
                                borderRadius: 6,
                                padding: '6px 13px',
                                fontSize: 12,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                                if (!showSynthPanel) {
                                    e.currentTarget.style.background = '#1e2b24';
                                    e.currentTarget.style.borderColor = '#2ecc71';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!showSynthPanel) {
                                    e.currentTarget.style.background = '#14171e';
                                    e.currentTarget.style.borderColor = 'rgba(46, 204, 113, 0.45)';
                                }
                            }}
                            title={showSynthPanel ? '声シンセサイザー・エディタを閉じる' : '声シンセサイザー・エディタを開く'}
                        >
                            <IconSynth size={14} color="#2ecc71" />
                            <span>声シンセサイザー</span>
                        </button>

                        {/* ⚙️ 設定 (UI テーマ切替 / 疲労軽減スキン) */}
                        <button
                            onClick={() => setShowSettings(true)}
                            style={{
                                background: '#1e2430',
                                color: '#c8d6e5',
                                border: '1px solid #3d4758',
                                borderRadius: 6,
                                padding: '6px 9px',
                                fontSize: 13,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4,
                                transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = '#2a3344';
                                e.currentTarget.style.color = '#ffffff';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = '#1e2430';
                                e.currentTarget.style.color = '#c8d6e5';
                            }}
                            title="設定（UIテーマ・疲労軽減スキン切替）"
                        >
                            <IconSettings size={14} color="currentColor" />
                        </button>
                    </div>
                </div>

                {/* オーディオリアクティブ MV / 波形ビジュアライザー（作曲モード時はスッキリ非表示） */}
                {/* MV モード時は 3 ペイン専用ワークスペースが画面全体を占有する */}
                {viewMode === 'mv' && (
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        <VisualizerMV
                            analysis={focusedClipAnalysis || analysis}
                            status={status}
                            synth={synth}
                            session={session}
                            selectedNote={selectedNote}
                            mode="mv"
                            projectPath={(currentProject as { path?: string } | null)?.path ?? null}
                        />
                    </div>
                )}
                {viewMode === 'waveform' && (
                    <>
                        <div style={{ height: visualizerHeight, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                            <VisualizerMV
                                analysis={focusedClipAnalysis || analysis}
                                status={status}
                                synth={synth}
                                session={session}
                                selectedNote={selectedNote}
                                mode="waveform"
                                projectPath={(currentProject as { path?: string } | null)?.path ?? null}
                                activeClipLabel={
                                    selectedClip
                                        ? `${session?.tracks[selectedClip.track]?.name || `Track ${selectedClip.track + 1}`} - Clip #${selectedClip.clip + 1}`
                                        : '全体録音テイク'
                                }
                            />
                        </div>

                        {/* ↔️ 上部ビジュアライザとタイムラインの間の可動式スプリッター（境界線ドラッグリサイズ） */}
                        <div
                            onPointerDown={handleVisualizerResizePointerDown}
                            style={{
                                height: 6,
                                cursor: 'row-resize',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'linear-gradient(180deg, #161b24 0%, #0d1017 100%)',
                                borderTop: '1px solid #1f2735',
                                borderBottom: '1px solid #1f2735',
                                userSelect: 'none',
                                zIndex: 10,
                                margin: '0 12px',
                            }}
                            title="ドラッグして境界線の高さを調節"
                        >
                            <div style={{ width: 36, height: 2, borderRadius: 1, background: '#4b5568' }} />
                        </div>
                    </>
                )}

                {/* 🎙️ カウントイン中オーバーレイ */}
                {countInBeat !== null && (
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            background: 'rgba(0, 0, 0, 0.85)',
                            backdropFilter: 'blur(12px)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 9999,
                            pointerEvents: 'auto',
                        }}
                        onClick={() => onRecordToggle()}
                    >
                        <div style={{ fontSize: 24, fontWeight: 900, color: '#70a1ff', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 12 }}>
                            COUNT IN
                        </div>
                        <div
                            style={{
                                fontSize: 120,
                                fontWeight: 900,
                                color: countInBeat === 1 ? '#ff4757' : '#2ed573',
                                lineHeight: 1,
                                fontFamily: 'monospace',
                                textShadow: countInBeat === 1 ? '0 0 40px rgba(255, 71, 87, 0.9)' : '0 0 40px rgba(46, 213, 115, 0.9)',
                                animation: 'pulse 0.3s ease-out',
                            }}
                        >
                            {countInBeat}
                        </div>
                        <div style={{ fontSize: 13, color: '#a4b0be', marginTop: 20 }}>
                            テンポ: {synth?.bpm ?? 120} BPM（クリックでキャンセル）
                        </div>
                    </div>
                )}

                {/* 録音中のリアルタイムタイマー（録音中のみ表示 / MIC・MIDI・MULTI 自動判定） */}
                {status?.isRecording && (() => {
                    const tracks = session?.tracks ?? [];
                    const hasAudioArm = tracks.some(t => t.armed && t.inputType !== 'midi') || tracks.length === 0;
                    const hasMidiArm = tracks.some(t => t.armed && t.inputType === 'midi');
                    const isMulti = hasAudioArm && hasMidiArm;
                    const label = isMulti ? 'MULTI REC' : hasMidiArm ? 'MIDI REC' : 'MIC REC';
                    const badgeColor = isMulti ? '#a55eea' : hasMidiArm ? '#e1b12c' : '#eb4d4b';
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px' }}>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    background: 'rgba(20, 24, 33, 0.85)',
                                    border: `1px solid ${badgeColor}`,
                                    color: '#ffffff',
                                    padding: '4px 10px',
                                    borderRadius: 6,
                                    fontSize: 11.5,
                                    fontWeight: 800,
                                    letterSpacing: '0.5px',
                                    boxShadow: `0 0 10px ${badgeColor}40`,
                                }}
                            >
                                {isMulti ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <IconMic size={11} color="#70e0ff" />
                                        <IconPiano size={11} color="#f4f2ad" />
                                    </span>
                                ) : hasMidiArm ? (
                                    <IconPiano size={11} color="#f4f2ad" />
                                ) : (
                                    <IconMic size={11} color="#70e0ff" />
                                )}
                                <span>{label}: {recSeconds.toFixed(1)}s</span>
                            </div>
                        </div>
                    );
                })()}

                {/* SYNTH エディタ（MVモード時はワークスペース全画面化のため非表示） */}
                {viewMode !== 'mv' && showSynthPanel && synth?.params ? (() => {
                    const target = editingClipTarget || selectedClip;
                    const activeClip = target ? session?.tracks[target.track]?.clips[target.clip] : undefined;

                    return (
                        <SynthEditor
                            synth={synth}
                            status={status}
                            analysis={analysis}
                            voices={voices}
                            selectedVoiceIdx={selectedVoiceIdx}
                            editingClipTarget={target}
                            clipTrimStart={activeClip?.trimStart}
                            clipSourceDuration={activeClip?.sourceDuration ?? activeClip?.duration}
                            clipVisibleDuration={activeClip?.duration}
                            clipFadeIn={activeClip?.fadeIn}
                            clipFadeOut={activeClip?.fadeOut}
                            onApplyToTrackOrClip={async () => {
                                try {
                                    // 🛑 クリップ反映時は再生を即座に停止
                                    await native.stopPlayback();
                                    await native.stopSessionPlayback();

                                    // 🎯 複数クリップ選択時は、選択中のすべてのクリップに一括適用！
                                    if (selectedClips && selectedClips.length > 0) {
                                        for (const target of selectedClips) {
                                            await native.sessionApplyVoiceToClip(
                                                target.track,
                                                target.clip,
                                                selectedVoiceIdx
                                            );
                                            await native.sessionSetTrackInstrument(target.track, 'voice', selectedVoiceIdx);
                                        }
                                    } else {
                                        const curTarget = editingClipTarget || selectedClip;
                                        if (curTarget) {
                                            const success = await native.sessionApplyVoiceToClip(
                                                curTarget.track,
                                                curTarget.clip,
                                                selectedVoiceIdx
                                            );
                                            if (!success) {
                                                const pos = status?.sessionPosition ?? 0;
                                                await native.sessionInsertVoiceClip(curTarget.track, selectedVoiceIdx, pos);
                                            }
                                            await native.sessionSetTrackInstrument(curTarget.track, 'voice', selectedVoiceIdx);
                                        } else {
                                            const pos = status?.sessionPosition ?? 0;
                                            await native.sessionInsertVoiceClip(0, selectedVoiceIdx, pos);
                                            await native.sessionSetTrackInstrument(0, 'voice', selectedVoiceIdx);
                                        }
                                    }
                                    await refreshSession();
                                    await refreshAnalysis();
                                    await refreshStatus();
                                } catch (e) {
                                    console.error('Failed to apply voice to track/clip:', e);
                                }
                            }}
                            midiDevices={midiDevices}
                            selectedMidiDevice={selectedMidiDevice}
                            midiRecording={midiRecording}
                            midiNotes={midiNotes}
                            voiceName={voiceName}
                            hasVoice={status?.hasVoice ?? false}
                            isRecording={status?.isRecording ?? false}
                            isPlaying={status?.isPlaying ?? false}
                            countInEnabled={countInEnabled}
                            countInBeat={countInBeat}
                            onToggleCountIn={() => setCountInEnabled((v) => !v)}
                            onRecordToggle={() => onRecordToggle(false)}
                            onPlayToggle={onPlayToggle}
                            onTrimVoice={async (startR: number, endR: number) => {
                                await native.trimCurrentVoice(startR, endR);
                                await refreshSynth();
                                await refreshAnalysis();
                                await refreshVoices();
                            }}
                            onAutoTrimVoice={async () => {
                                await native.autoTrimCurrentVoice();
                                await refreshSynth();
                                await refreshAnalysis();
                                await refreshVoices();
                            }}
                            onNormalizeVoice={async (enable: boolean = true) => {
                                await native.normalizeCurrentVoice(enable);
                                await refreshSynth();
                                await refreshAnalysis();
                                await refreshVoices();
                            }}
                            onSetVoiceGain={async (factor: number) => {
                                await native.setVoiceGain(factor);
                                await refreshSynth();
                                await refreshAnalysis();
                                await refreshVoices();
                            }}
                            onResetVoice={async () => {
                                await native.resetVoiceToOriginal();
                                await refreshSynth();
                                await refreshAnalysis();
                                await refreshVoices();
                            }}
                            onReverseVoice={async () => {
                                await native.reverseCurrentVoice();
                                await refreshSynth();
                                await refreshAnalysis();
                                await refreshVoices();
                            }}
                            onClose={() => setShowSynthPanel(false)}
                            onUpdateVoice={async (idx: number) => {
                                await native.updateVoice(idx);
                                await refreshVoices();
                                await refreshSynth();
                            }}
                            onSaveVoiceAs={async (name: string) => {
                                const newIdx = await native.saveVoice(name);
                                const vList = await native.getVoices();
                                if (Array.isArray(vList) && vList.length > 0) {
                                    setVoices(vList as VoiceLibraryEntry[]);
                                    const targetIdx = typeof newIdx === 'number' && newIdx >= 0 ? newIdx : vList.length - 1;
                                    setSelectedVoiceIdx(targetIdx);
                                    if (vList[targetIdx]) {
                                        setVoiceName(vList[targetIdx].name);
                                    }
                                    await refreshSynth();
                                    await refreshStatus();
                                }
                            }}
                            onParamChange={onParamChange}
                            onVoiceNameChange={setVoiceName}
                            onSaveVoice={onSaveVoice}
                            onLoadVoice={onLoadVoice}
                            onRenameVoice={onRenameVoice}
                            onDeleteVoice={onDeleteVoice}
                            onMidiDeviceChange={onMidiDeviceChange}
                            onMidiRecordToggle={onMidiRecordToggle}
                        />
                    );
                })() : null}

                {/* タイムライン ＆ 右側ドッキング・ブラウザーパネル（MVモード時はワークスペース全画面化のため非表示） */}
                {viewMode !== 'mv' && (
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <SessionTimeline
                                theme={currentTheme}
                                session={session}
                                status={status}
                                recSeconds={recSeconds}
                                recStartSeconds={recStartSeconds}
                                isMidiRecording={midiRecording}
                                liveMidiNotes={midiNotes}
                                selectedClip={selectedClip}
                                selectedClips={selectedClips}
                                selectedClipNote={selectedClipNote}
                                selectedNotes={selectedNotes}
                                cutCursor={cutCursor}
                                cutToolActive={cutToolActive}
                                rangeToolActive={rangeToolActive}
                                dragPreview={dragPreview}
                                dragRef={dragRef}
                                onSessionPlayToggle={onSessionPlayToggle}
                                onAddTrack={onAddTrack}
                                onDeleteTrack={onDeleteTrack}
                                onOpenFxChain={(track) => setFxChainTrack(track)}
                                onDropVirtualAnalog={handleDropVirtualAnalog}
                                onDropVoiceChanger={openVoiceChangerForTrack}
                                onArmed={onArmed}
                                onSetTrackInputType={onSetTrackInputType}
                                onMonitor={onMonitor}
                                onMute={onMute}
                                onSolo={onSolo}
                                onGain={onGain}
                                onPan={onPan}
                                onAppendClip={onAppendClip}
                                onDuplicateClip={onDuplicateClip}
                                onDuplicateNotes={onDuplicateNotes}
                                onDeleteNotes={onDeleteNotes}
                                onDeleteClip={onDeleteClip}
                                onDeleteClips={onDeleteClips}
                                onSeek={async (sec) => {
                                    await native.setSessionPosition(sec);
                                    await refreshStatus();
                                }}
                                onToggleCutTool={onToggleCutTool}
                                onToggleRangeTool={onToggleRangeTool}
                                snapEnabled={snapEnabled}
                                onToggleSnap={() => setSnapEnabled(prev => !prev)}
                                followPlayhead={followPlayhead}
                                onToggleFollowPlayhead={toggleFollowPlayhead}
                                zoomAnchorMode={zoomAnchorMode}
                                onCutAtCursor={onCutAtCursor}
                                onClipPointerDown={onClipPointerDown}
                                onClipPointerMove={onClipPointerMove}
                                onClipPointerUp={onClipPointerUp}
                                onTrimClip={onTrimClip}
                                onSelectClip={(track: number, clip: number) => {
                                    if (track < 0 || clip < 0) {
                                        setSelectedClip(null);
                                        setSelectedClips([]);
                                    } else {
                                        setSelectedClip({ track, clip });
                                        setSelectedClips([{ track, clip }]);
                                        void native.setActiveTrack(track);
                                    }
                                    setSelectedClipNote(null);
                                    setSelectedNotes(null);
                                }}
                                onSelectClips={(clips) => {
                                    setSelectedClips(clips);
                                    if (clips.length > 0) {
                                        setSelectedClip(clips[0]);
                                        void native.setActiveTrack(clips[0].track);
                                    } else {
                                        setSelectedClip(null);
                                    }
                                    setSelectedClipNote(null);
                                    setSelectedNotes(null);
                                }}
                                onSelectClipNote={(track: number, clip: number, note: number) => {
                                    setSelectedClipNote({ track, clip, note });
                                    setSelectedClip({ track, clip });
                                    setSelectedNotes({ track, clip, notes: [note] });
                                    void native.setActiveTrack(track);
                                }}
                                onMarqueeSelect={(track: number, clip: number, notes: number[]) => {
                                    setSelectedNotes({ track, clip, notes });
                                    setSelectedClip({ track, clip });
                                    setSelectedClipNote(null);
                                }}
                                onSetCutCursor={(track: number, clip: number, timeSeconds: number) => {
                                    setCutCursor({ track, clip, timeSeconds });
                                }}
                                onAssignClipToSynth={async (trackIdx: number, clipIdx: number, customName?: string) => {
                                    try {
                                        const name = customName || `Track ${trackIdx + 1} Clip ${clipIdx + 1}`;
                                        await native.saveClipAsVoice(trackIdx, clipIdx, name);
                                        const vList = await native.getVoices();
                                        setVoices(vList);
                                        await refreshSynth();
                                        await refreshAnalysis();
                                    } catch (e) {
                                        console.error('Failed to assign clip to synth:', e);
                                    }
                                }}
                                onPlayClipAsSequence={async (trackIdx: number, clipIdx: number) => {
                                    const targetClip = session?.tracks?.[trackIdx]?.clips?.[clipIdx];
                                    try {
                                        const name = `Track ${trackIdx + 1} Clip ${clipIdx + 1}`;
                                        await native.saveClipAsVoice(trackIdx, clipIdx, name);
                                        const vList = await native.getVoices();
                                        setVoices(vList);
                                        const fitSweetSpot = (midi: number) => {
                                            if (midi < 0) return -1;
                                            let note = midi;
                                            while (note < 48) note += 12;
                                            while (note > 76) note -= 12;
                                            return Math.max(36, Math.min(84, note));
                                        };
                                        const notes = targetClip?.notes ?? [];
                                        if (notes.length > 0) {
                                            for (let step = 0; step < 16; ++step) {
                                                if (step < notes.length) {
                                                    await native.setStep(step, fitSweetSpot(notes[step].midi));
                                                } else {
                                                    await native.setStep(step, -1);
                                                }
                                            }
                                        } else {
                                            const rootMidi = 60;
                                            const defaultPattern = [0, -1, 4, -1, 7, -1, 4, -1, 0, 2, 4, 7, 9, 7, 4, 2];
                                            for (let step = 0; step < 16; ++step) {
                                                const offset = defaultPattern[step];
                                                await native.setStep(step, offset >= 0 ? fitSweetSpot(rootMidi + offset) : -1);
                                            }
                                        }
                                        await native.setSequencerPlaying(true);
                                        await refreshStatus();
                                        await refreshSynth();
                                        await refreshAnalysis();
                                    } catch (e) {
                                        console.error('Failed to play clip as sequence:', e);
                                    }
                                }}
                                onPlayClipWithVoice={async (trackIdx: number, clipIdx: number, voiceIndex: number) => {
                                    const targetClip = session?.tracks?.[trackIdx]?.clips?.[clipIdx];
                                    try {
                                        await native.loadVoice(voiceIndex);
                                        const fitSweetSpot = (midi: number) => {
                                            if (midi < 0) return -1;
                                            let note = midi;
                                            while (note < 48) note += 12;
                                            while (note > 76) note -= 12;
                                            return Math.max(36, Math.min(84, note));
                                        };
                                        const notes = targetClip?.notes ?? [];
                                        if (notes.length > 0) {
                                            for (let step = 0; step < 16; ++step) {
                                                if (step < notes.length) {
                                                    await native.setStep(step, fitSweetSpot(notes[step].midi));
                                                } else {
                                                    await native.setStep(step, -1);
                                                }
                                            }
                                        } else {
                                            const rootMidi = 60;
                                            const defaultPattern = [0, -1, 4, -1, 7, -1, 4, -1, 0, 2, 4, 7, 9, 7, 4, 2];
                                            for (let step = 0; step < 16; ++step) {
                                                const offset = defaultPattern[step];
                                                await native.setStep(step, offset >= 0 ? fitSweetSpot(rootMidi + offset) : -1);
                                            }
                                        }
                                        await native.setSequencerPlaying(true);
                                        await refreshStatus();
                                        await refreshSynth();
                                        await refreshAnalysis();
                                    } catch (e) {
                                        console.error('Failed to play clip with selected voice:', e);
                                    }
                                }}
                                onConvertClipToVoice={async (trackIdx: number, clipIdx: number, voiceIndex: number, mode: number = 0) => {
                                    try {
                                        await native.convertClipToSynthVoice(trackIdx, clipIdx, voiceIndex, mode);
                                        await refreshSession();
                                        await refreshSynth();
                                        await refreshAnalysis();
                                    } catch (e) {
                                        console.error('Failed to convert clip to synth voice:', e);
                                    }
                                }}
                                voices={voices}
                                onLoadVoice={async (index: number) => {
                                    setSelectedVoiceIdx(index);
                                    await native.loadVoice(index);
                                    await refreshSynth();
                                    await refreshAnalysis();
                                }}
                                vaPresets={virtualAnalogPresets}
                                onLoadVirtualAnalogPreset={async (index: number) => {
                                    setSelectedVirtualAnalogPresetIdx(index);
                                    await native.loadVirtualAnalogPreset(index);
                                    setHomeInstrumentKind('virtualAnalog');
                                    await native.setVirtualAnalogEnabled(true);
                                    await native.setVoiceSynthEnabled(false);
                                    setVoiceSynthEnabled(false);
                                }}
                                onSelectTrack={async (trackIdx: number) => {
                                    try {
                                        await native.setActiveTrack(trackIdx);
                                        const kind = await native.sessionGetTrackInstrument(trackIdx);
                                        if (kind === 'va') {
                                            setHomeInstrumentKind('virtualAnalog');
                                            await native.setVirtualAnalogEnabled(true);
                                            await native.setVoiceSynthEnabled(false);
                                            setVoiceSynthEnabled(false);
                                            const vaIdx = await native.sessionGetTrackVaPreset(trackIdx);
                                            if (vaIdx >= 0) {
                                                setSelectedVirtualAnalogPresetIdx(vaIdx);
                                                await native.loadVirtualAnalogPreset(vaIdx);
                                            }
                                        } else if (kind === 'voice') {
                                            setHomeInstrumentKind('voice');
                                            await native.setVirtualAnalogEnabled(false);
                                            await native.setVoiceSynthEnabled(true);
                                            setVoiceSynthEnabled(true);
                                            const voiceIdx = await native.sessionGetTrackVoicePreset(trackIdx);
                                            if (voiceIdx >= 0) {
                                                setSelectedVoiceIdx(voiceIdx);
                                                await native.loadVoice(voiceIdx);
                                                await refreshSynth();
                                                await refreshAnalysis();
                                            }
                                        }
                                    } catch (e) {
                                        console.error('Failed to sync track instrument:', e);
                                    }
                                }}
                                onOpenPianoRoll={(trackIdx: number, clipIdx: number) => {
                                    setPianoRollClip({ track: trackIdx, clip: clipIdx });
                                }}
                                onOpenSynthEditorForClip={async (trackIdx: number, clipIdx: number) => {
                                    try {
                                        const trk = session?.tracks[trackIdx];
                                        const trkName = trk?.name || `Track ${trackIdx + 1}`;
                                        const defaultName = `${trkName} Clip ${clipIdx + 1}`;
                                        const newVoiceIdx = await native.saveClipAsVoice(trackIdx, clipIdx, defaultName);
                                        if (newVoiceIdx >= 0) {
                                            await refreshVoices();
                                            await native.loadVoice(newVoiceIdx);
                                            setSelectedVoiceIdx(newVoiceIdx);
                                            await refreshSynth();
                                            await refreshAnalysis();
                                        }
                                        setEditingClipTarget({ track: trackIdx, clip: clipIdx });
                                        setShowSynthPanel(true);
                                    } catch (e) {
                                        console.error('Failed to open clip in synth editor:', e);
                                    }
                                }}
                                onOpenEqModalForClip={(trackIdx: number, clipIdx: number) => {
                                    setEqModalClip({ track: trackIdx, clip: clipIdx });
                                }}
                                onCutDirect={async (track: number, clip: number, timeSeconds: number) => {
                                    await native.sessionSplitClip(track, clip, timeSeconds);
                                    setCutCursor(null);
                                    refreshSession();
                                }}
                                onInsertVoiceClip={async (trackIdx: number, voiceIdx?: number, startSec?: number) => {
                                    const vIdx = voiceIdx !== undefined ? voiceIdx : selectedVoiceIdx;
                                    const pos = startSec !== undefined ? startSec : (status?.sessionPosition ?? 0);
                                    await native.sessionInsertVoiceClip(trackIdx, vIdx, pos);
                                    await refreshSession();
                                }}
                                onRecordToggle={onRecordToggle}
                                countInEnabled={countInEnabled}
                                onToggleCountIn={() => setCountInEnabled((v) => !v)}
                                bpm={synth?.bpm ?? 120}
                                onBpmChange={onBpmChange}
                            />
                        </div>

                        {/* ↔️ タイムラインとブラウザパネルの間の可動式スプリッター境界線（ドラッグで幅を伸縮） */}
                        {showBrowser && (
                            <div
                                onPointerDown={handleBrowserResizeStart}
                                style={{
                                    width: 6,
                                    cursor: 'col-resize',
                                    background: '#0d1017',
                                    borderLeft: '1px solid #1f2735',
                                    borderRight: '1px solid #1f2735',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    userSelect: 'none',
                                    zIndex: 35,
                                    flexShrink: 0,
                                    transition: 'background 0.15s ease',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = '#2563eb'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = '#0d1017'; }}
                                title="ドラッグしてブラウザーパネルの幅を伸縮"
                            >
                                <div style={{ width: 2, height: 32, borderRadius: 1, background: '#4b5568' }} />
                            </div>
                        )}

                        {/* 📁 画面右側ドッキング・ブラウザーパネル */}
                        {showBrowser && (
                            <BrowserPanel
                                width={browserWidth}
                                isOpen={showBrowser}
                                onClose={() => setShowBrowser(false)}
                                onOpenVirtualAnalog={openVirtualAnalogInstrument}
                                onAddVirtualAnalogTrack={handleDropVirtualAnalog}
                                onOpenIntervalSequencer={() => setShowIntervalSequencer(true)}
                                onOpenVoiceChanger={() => {
                                    const track = session?.tracks?.findIndex((item) => item.armed) ?? -1;
                                    openVoiceChangerForTrack(track >= 0 ? track : 0);
                                }}
                                voices={voices}
                                selectedVoiceIndex={selectedVoiceIdx}
                                onSelectVoice={(idx) => {
                                    setSelectedVoiceIdx(idx);
                                    void onLoadVoice(idx);
                                }}
                            />
                        )}
                    </div>
                )}

                {/* 🎹 本格ピアノロール（MIDIエディタ） */}
                {pianoRollClip && session && session.tracks[pianoRollClip.track]?.clips[pianoRollClip.clip] && (
                    <PianoRollEditor
                        trackIndex={pianoRollClip.track}
                        clipIndex={pianoRollClip.clip}
                        track={session.tracks[pianoRollClip.track]}
                        notes={session.tracks[pianoRollClip.track].clips[pianoRollClip.clip].notes}
                        clipDuration={session.tracks[pianoRollClip.track].clips[pianoRollClip.clip].duration}
                        clipStart={session.tracks[pianoRollClip.track].clips[pianoRollClip.clip].start}
                        voices={voices}
                        onUpdateNote={onPianoRollUpdateNote}
                        onAddNote={onPianoRollAddNote}
                        onDeleteNote={onPianoRollDeleteNote}
                        onPreviewNote={onPianoRollPreviewNote}
                        onClose={() => setPianoRollClip(null)}
                    />
                )}

                {/* 🎹 下部コンテナ（シーケンサー・ステップパッド・鍵盤）：MVモード時はワークスペース全画面化のため非表示 */}
                {viewMode !== 'mv' && (
                    <div style={{ flexShrink: 0, background: currentTheme.bgPanel, borderTop: `1px solid ${currentTheme.border}`, zIndex: 10, display: 'flex', flexDirection: 'column', transition: 'background-color 0.2s ease, border-color 0.2s ease' }}>
                        {/* シーケンサーバー */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px 2px 12px', flexWrap: 'wrap' }}>
                            <button
                                onClick={onSeqPlayToggle}
                                disabled={!hasVoice}
                                style={{
                                    background: synth?.playing ? '#e5484d' : '#3ddc84',
                                    color: '#0f1115',
                                    border: 'none',
                                    borderRadius: 6,
                                    padding: '5px 12px',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: hasVoice ? 'pointer' : 'not-allowed',
                                    opacity: hasVoice ? 1 : 0.4,
                                }}
                            >
                                {synth?.playing ? '停止' : 'シーケンス再生'}
                            </button>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#171a21', border: '1px solid #2e3846', borderRadius: 6, padding: '2px 8px' }}>
                                <span style={{ fontSize: 11, fontWeight: 800, color: '#70a1ff' }}>BPM</span>
                                <input
                                    type="range"
                                    min={20}
                                    max={400}
                                    step={0.5}
                                    value={synth?.bpm ?? 120}
                                    onChange={(e) => onBpmChange(Number(e.target.value))}
                                    style={{ width: 90, cursor: 'pointer' }}
                                    title="テンポスライダー (20.0〜400.0 BPM)"
                                />
                                <input
                                    type="number"
                                    min={20}
                                    max={400}
                                    step={0.1}
                                    value={synth?.bpm ? (Math.round(synth.bpm * 10) / 10) : 120}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) onBpmChange(Math.max(20, Math.min(400, val)));
                                    }}
                                    style={{
                                        width: 54,
                                        background: '#0d1017',
                                        color: '#ffffff',
                                        border: '1px solid #3d4758',
                                        borderRadius: 4,
                                        padding: '2px 4px',
                                        fontSize: 12,
                                        fontWeight: 800,
                                        textAlign: 'right',
                                        outline: 'none',
                                    }}
                                    title="BPMを直接キーボード入力 (20.0〜400.0)"
                                />
                            </div>

                            {/* メイン画面の MIDI キーボード選択 & 録音 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#171a21', border: '1px solid #2e3846', borderRadius: 6, padding: '2px 8px' }}>
                                <IconMidi size={14} color="#70a1ff" />
                                <select
                                    value={selectedMidiDevice}
                                    onChange={(e) => onMidiDeviceChange(e.target.value)}
                                    style={{
                                        background: '#0d1017',
                                        color: '#dcdfe4',
                                        border: '1px solid #3d4758',
                                        borderRadius: 4,
                                        padding: '2px 6px',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        maxWidth: 160,
                                    }}
                                >
                                    <option value="">すべての MIDI デバイス</option>
                                    {midiDevices.map((d) => (
                                        <option key={d} value={d}>{d}</option>
                                    ))}
                                </select>
                                {status?.isRecording && (
                                    <div
                                        style={{
                                            background: '#ff4757',
                                            color: '#ffffff',
                                            borderRadius: 4,
                                            padding: '2px 7px',
                                            fontSize: 9.5,
                                            fontWeight: 800,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            boxShadow: '0 0 8px #ff4757',
                                            letterSpacing: '0.5px',
                                        }}
                                        title="マスター録音中（全アームトラック同時キャプチャ中）"
                                    >
                                        <IconRecord size={8} color="#ffffff" />
                                        <span>REC</span>
                                    </div>
                                )}
                            </div>

                            <span style={{ fontSize: 11, color: '#888' }}>
                                選択ノート: <span style={{ color: '#eee', fontWeight: 700 }}>{noteName(selectedNote)}</span>
                            </span>

                            {/* 🤖 声シンセサイザー・エディタを開くクイックボタン */}
                            <button
                                onClick={() => setShowSynthPanel((v) => !v)}
                                style={{
                                    marginLeft: 'auto',
                                    background: showSynthPanel ? '#1e2b24' : '#14171e',
                                    color: showSynthPanel ? '#2ecc71' : '#dcdfe4',
                                    border: showSynthPanel ? '1px solid #2ecc71' : '1px solid rgba(46, 204, 113, 0.45)',
                                    borderRadius: 6,
                                    padding: '3px 9px',
                                    fontSize: 11,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => {
                                    if (!showSynthPanel) {
                                        e.currentTarget.style.background = '#1e2b24';
                                        e.currentTarget.style.borderColor = '#2ecc71';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!showSynthPanel) {
                                        e.currentTarget.style.background = '#14171e';
                                        e.currentTarget.style.borderColor = 'rgba(46, 204, 113, 0.45)';
                                    }
                                }}
                                title={showSynthPanel ? '声シンセサイザー・エディタを閉じる' : '声シンセサイザー・エディタを開く'}
                            >
                                <IconSynth size={12} color="#2ecc71" />
                                <span>声シンセ</span>
                            </button>

                            {/* 🎹 鍵盤・ステップパッドの表示/非表示トグルボタン */}
                            <button
                                onClick={toggleKeyboard}
                                style={{
                                    background: showKeyboard ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.15) 100%)' : '#14171e',
                                    color: showKeyboard ? '#60a5fa' : '#94a3b8',
                                    border: showKeyboard ? '1px solid #3b82f6' : '1px solid #334155',
                                    borderRadius: 6,
                                    padding: '3px 9px',
                                    fontSize: 11,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    boxShadow: showKeyboard ? '0 0 10px rgba(59, 130, 246, 0.3)' : 'none',
                                    transition: 'all 0.15s ease',
                                }}
                                title={showKeyboard ? 'オンスクリーン鍵盤とステップパッドを隠す' : 'オンスクリーン鍵盤とステップパッドを表示'}
                            >
                                <IconPiano size={12} color={showKeyboard ? '#60a5fa' : '#94a3b8'} />
                                <span>鍵盤 {showKeyboard ? '表示中' : '非表示'}</span>
                            </button>

                            {/* 🎤 メイン画面のボイス音源切替セレクター（タイムラインへのドラッグ＆ドロップ対応！） */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 6px', background: '#171a21', border: '1px solid #334155', borderRadius: 6 }}>
                                <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 800 }}>演奏音源</span>
                                <select
                                    value={homeInstrumentKind}
                                    onChange={async (event) => {
                                        const kind = event.target.value as 'voice' | 'virtualAnalog';
                                        setHomeInstrumentKind(kind);
                                        if (kind === 'voice') {
                                            await native.setVirtualAnalogEnabled(false);
                                            await native.setVoiceSynthEnabled(true);
                                            setVoiceSynthEnabled(true);
                                        } else {
                                            await native.setVirtualAnalogEnabled(true);
                                            await native.setVoiceSynthEnabled(false);
                                            setVoiceSynthEnabled(false);
                                        }
                                    }}
                                    style={{ background: '#0d1017', color: '#dcdfe4', border: '1px solid #3d4758', borderRadius: 4, padding: '3px 5px', fontSize: 10, fontWeight: 800 }}
                                    aria-label="ホームで使用する音源種別"
                                >
                                    <option value="voice">ボイス音源</option>
                                    <option value="virtualAnalog">VA音源</option>
                                </select>
                            </div>
                            {homeInstrumentKind === 'virtualAnalog' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 6px', background: '#211f16', border: '1px solid #8b8a50', borderRadius: 6 }}>
                                    <span style={{ color: '#dce28a', fontSize: 10, fontWeight: 900 }}>VA音色:</span>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (virtualAnalogPresets.length === 0) return;
                                            const next = selectedVirtualAnalogPresetIdx <= 0 ? virtualAnalogPresets.length - 1 : selectedVirtualAnalogPresetIdx - 1;
                                            setSelectedVirtualAnalogPresetIdx(next);
                                            await native.loadVirtualAnalogPreset(next);
                                            if (selectedClip && selectedClip.track >= 0) {
                                                await native.sessionSetTrackVaPreset(selectedClip.track, next);
                                            }
                                        }}
                                        disabled={virtualAnalogPresets.length <= 1}
                                        style={{ background: '#3c4228', color: '#f1f3ba', border: 'none', borderRadius: 4, width: 20, height: 20, fontSize: 9, cursor: virtualAnalogPresets.length > 1 ? 'pointer' : 'not-allowed', fontWeight: 900 }}
                                        title="前のVA音色"
                                    >◀</button>
                                    <select
                                        value={selectedVirtualAnalogPresetIdx}
                                        onChange={async (event) => {
                                            const index = Number(event.target.value);
                                            setSelectedVirtualAnalogPresetIdx(index);
                                            if (index >= 0) {
                                                await native.loadVirtualAnalogPreset(index);
                                                if (selectedClip && selectedClip.track >= 0) {
                                                    await native.sessionSetTrackVaPreset(selectedClip.track, index);
                                                }
                                            }
                                        }}
                                        style={{ background: '#111611', color: '#dce28a', border: '1px solid #596348', borderRadius: 4, padding: '3px 5px', fontSize: 10, fontWeight: 800, maxWidth: 190 }}
                                        aria-label="VA音源の音色ストック"
                                    >
                                        <option value={-1}>VA音色ストック（{virtualAnalogPresets.length}件）</option>
                                        {virtualAnalogPresets.map((preset, index) => <option key={`${preset.name}-${index}`} value={index}>{index < 10 ? `0${index}` : index}: {preset.name}</option>)}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (virtualAnalogPresets.length === 0) return;
                                            const next = selectedVirtualAnalogPresetIdx >= virtualAnalogPresets.length - 1 ? 0 : selectedVirtualAnalogPresetIdx + 1;
                                            setSelectedVirtualAnalogPresetIdx(next);
                                            await native.loadVirtualAnalogPreset(next);
                                            if (selectedClip && selectedClip.track >= 0) {
                                                await native.sessionSetTrackVaPreset(selectedClip.track, next);
                                            }
                                        }}
                                        disabled={virtualAnalogPresets.length <= 1}
                                        style={{ background: '#3c4228', color: '#f1f3ba', border: 'none', borderRadius: 4, width: 20, height: 20, fontSize: 9, cursor: virtualAnalogPresets.length > 1 ? 'pointer' : 'not-allowed', fontWeight: 900 }}
                                        title="次のVA音色"
                                    >▶</button>
                                    <button type="button" onClick={() => void openSelectedVirtualAnalog()} style={{ background: '#566331', color: '#f1f3ba', border: '1px solid #8b8a50', borderRadius: 4, padding: '4px 6px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>VA画面</button>
                                </div>
                            )}
                            <div
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData(
                                        'text/plain',
                                        JSON.stringify({
                                            type: 'voice',
                                            voiceIndex: selectedVoiceIdx,
                                            name: voices[selectedVoiceIdx]?.name || 'Custom Voice',
                                        })
                                    );
                                    e.dataTransfer.effectAllowed = 'copy';
                                }}
                                style={{
                                    display: homeInstrumentKind === 'voice' ? 'flex' : 'none',
                                    alignItems: 'center',
                                    gap: 6,
                                    background: currentTheme.id === 'slate' ? '#282c34' : currentTheme.id === 'charcoal' ? '#181a1d' : 'linear-gradient(135deg, #18202d 0%, #111620 100%)',
                                    border: `1px solid ${currentTheme.id === 'slate' ? '#434956' : currentTheme.id === 'charcoal' ? '#2e3137' : '#3b82f6'}`,
                                    borderRadius: 6,
                                    padding: '2px 8px',
                                    cursor: 'grab',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                }}
                                title="✋ この音源バッジを上のトラックへドラッグ＆ドロップしてポイッと配置！"
                            >
                                <span style={{ fontSize: 11, fontWeight: 800, color: '#2ed573', display: 'flex', alignItems: 'center', gap: 4, userSelect: 'none' }}>
                                    <IconSynth size={12} color="#2ed573" /> ボイス音色:
                                </span>

                                {/* 前のボイス */}
                                <button
                                    onClick={async () => {
                                        if (voices.length > 0) {
                                            const nextIdx = selectedVoiceIdx <= 0 ? voices.length - 1 : selectedVoiceIdx - 1;
                                            setSelectedVoiceIdx(nextIdx);
                                            await onLoadVoice(nextIdx);
                                            if (selectedClip && selectedClip.track >= 0) {
                                                await native.sessionSetTrackVoicePreset(selectedClip.track, nextIdx);
                                            }
                                        }
                                    }}
                                    disabled={voices.length <= 1}
                                    style={{ background: '#262d3a', color: '#fff', border: 'none', borderRadius: 4, width: 20, height: 20, fontSize: 9, cursor: voices.length > 1 ? 'pointer' : 'not-allowed', fontWeight: 900 }}
                                    title="前のボイス"
                                >
                                    ◀
                                </button>

                                {/* ボイス音源ドロップダウン */}
                                <select
                                    value={selectedVoiceIdx}
                                    onChange={async (e) => {
                                        const idx = Number(e.target.value);
                                        setSelectedVoiceIdx(idx);
                                        await onLoadVoice(idx);
                                        if (selectedClip && selectedClip.track >= 0) {
                                            await native.sessionSetTrackVoicePreset(selectedClip.track, idx);
                                        }
                                    }}
                                    style={{
                                        background: '#0d1017',
                                        color: '#ffffff',
                                        border: '1px solid #3d4758',
                                        borderRadius: 4,
                                        padding: '2px 6px',
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        maxWidth: 150,
                                    }}
                                >
                                    {voices.length === 0 ? (
                                        <option value={0}>00: デフォルト音源</option>
                                    ) : (
                                        voices.map((v, i) => (
                                            <option key={`v-${i}`} value={i}>
                                                {i < 10 ? `0${i}` : i}: {v.name} ({v.noteCount}音)
                                            </option>
                                        ))
                                    )}
                                </select>

                                {/* 次のボイス */}
                                <button
                                    onClick={async () => {
                                        if (voices.length > 0) {
                                            const nextIdx = selectedVoiceIdx >= voices.length - 1 ? 0 : selectedVoiceIdx + 1;
                                            setSelectedVoiceIdx(nextIdx);
                                            await onLoadVoice(nextIdx);
                                            if (selectedClip && selectedClip.track >= 0) {
                                                await native.sessionSetTrackVoicePreset(selectedClip.track, nextIdx);
                                            }
                                        }
                                    }}
                                    disabled={voices.length <= 1}
                                    style={{ background: '#262d3a', color: '#fff', border: 'none', borderRadius: 4, width: 20, height: 20, fontSize: 9, cursor: voices.length > 1 ? 'pointer' : 'not-allowed', fontWeight: 900 }}
                                    title="次のボイス"
                                >
                                    ▶
                                </button>

                                {/* タイムラインに貼る クイック追加ボタン */}
                                <button
                                    onClick={async () => {
                                        const targetTrk = selectedClip?.track ?? 0;
                                        const pos = status?.sessionPosition ?? 0;
                                        await native.sessionInsertVoiceClip(targetTrk, selectedVoiceIdx, pos);
                                        await refreshSession();
                                    }}
                                    style={{
                                        background: 'linear-gradient(135deg, #1e3799 0%, #0c2461 100%)',
                                        color: '#ffffff',
                                        border: '1px solid #3d7eff',
                                        borderRadius: 4,
                                        padding: '2px 6px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 3,
                                        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                                    }}
                                    title="現在の再生ヘッド位置にこの音源クリップを即座に貼り付け（またはトラックへ直接ドラッグ＆ドロップ）"
                                >
                                    <IconPin size={10} color="#ffffff" />
                                    <span>貼る</span>
                                </button>

                                {/* 原音プレビュー再生ボタン */}
                                <button
                                    onClick={onPlayToggle}
                                    disabled={!status?.hasVoice}
                                    style={{
                                        background: status?.isPlaying ? '#ff4757' : '#2f384a',
                                        color: '#ffffff',
                                        border: '1px solid #4a5568',
                                        borderRadius: 4,
                                        padding: '2px 6px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        cursor: status?.hasVoice ? 'pointer' : 'not-allowed',
                                        opacity: status?.hasVoice ? 1 : 0.4,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 3,
                                    }}
                                    title="現在のボイス原音を試聴再生"
                                >
                                    {status?.isPlaying ? <IconStop size={10} color="#fff" /> : <IconPlay size={10} color="#70a1ff" />}
                                    <span>{status?.isPlaying ? '停止' : '試聴'}</span>
                                </button>

                                {/* 🎙️ 声シンセ発音 ON/OFF 切り替えボタン (SVG) */}
                                <button
                                    onClick={handleToggleVoiceSynth}
                                    style={{
                                        background: voiceSynthEnabled ? '#1e90ff' : '#232b38',
                                        color: voiceSynthEnabled ? '#ffffff' : '#718093',
                                        border: voiceSynthEnabled ? '1px solid #70a1ff' : '1px solid #333d4d',
                                        borderRadius: 4,
                                        padding: '2px 7px',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        boxShadow: voiceSynthEnabled ? '0 0 6px rgba(30, 144, 255, 0.4)' : 'none',
                                        transition: 'all 0.15s ease',
                                    }}
                                    title="MIDIキーボード/画面鍵盤を弾いた時に「声シンセ」を発音させるかどうかを切り替えます（プラグイン音源のみ鳴らしたい時はOFFにできます）"
                                >
                                    <IconMicrophone size={11} color={voiceSynthEnabled ? '#ffffff' : '#718093'} />
                                    <span>声シンセ: {voiceSynthEnabled ? 'ON' : 'OFF'}</span>
                                </button>

                                {/* 基音表示 */}
                                <span style={{ fontSize: 10, color: '#70a1ff', fontWeight: 700, marginLeft: 2, background: '#090d14', padding: '1px 5px', borderRadius: 4, border: '1px solid #232b38' }}>
                                    {synth?.basePitch ? `${Math.round(synth.basePitch)}Hz` : '220Hz'}
                                </span>
                            </div>
                        </div>

                        {/* 🎹 ステップパッド ＆ 鍵盤（showKeyboard で開閉） */}
                        {showKeyboard && (
                            <>
                                {/* ステップパッド */}
                                <div style={{ display: 'flex', gap: 4, padding: '4px 12px' }}>
                                    {Array.from({ length: stepCount }, (_, i) => {
                                        const note = pattern[i];
                                        const active = synth?.playing && i === synth?.seqStep;
                                        return (
                                            <button
                                                key={i}
                                                onClick={() => toggleStep(i)}
                                                disabled={!hasVoice}
                                                style={{
                                                    flex: 1,
                                                    height: 38,
                                                    borderRadius: 5,
                                                    border: active ? '2px solid #ffffff' : '1px solid #2a2d34',
                                                    background: note >= 0 ? '#4d7cff' : '#1a1d23',
                                                    color: note >= 0 ? '#fff' : '#555',
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    cursor: hasVoice ? 'pointer' : 'not-allowed',
                                                    opacity: hasVoice ? 1 : 0.4,
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 1,
                                                }}
                                            >
                                                <span style={{ fontWeight: 800 }}>{note >= 0 ? noteName(note) : '−'}</span>
                                                <span style={{ fontSize: 8.5, color: note >= 0 ? 'rgba(255, 255, 255, 0.9)' : '#718093', fontWeight: note >= 0 ? 900 : 600 }}>{i + 1}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* 鍵盤 */}
                                <Keyboard
                                    keys={keys}
                                    kbWidth={kbWidth}
                                    selectedNote={selectedNote}
                                    pressedNotes={status?.pressedNotes}
                                    hasVoice={hasVoice}
                                    octaveShift={octaveShift}
                                    onOctaveChange={setOctaveShift}
                                    onKeyDown={onKeyDown}
                                    onKeyUp={onKeyUp}
                                />
                            </>
                        )}
                    </div>
                )}

                {/* 🎛️ トラック追加ダイアログモーダル */}
                <AddTrackModal
                    isOpen={isAddTrackModalOpen}
                    onClose={() => setIsAddTrackModalOpen(false)}
                    onAdd={handleConfirmAddTrack}
                    currentTrackCount={session?.tracks?.length ?? 0}
                />

                {/* ⚙️ 設定（UIテーマ・疲労軽減スキン切替）モーダル */}
                {showSettings && (
                    <SettingsModal
                        currentThemeId={themeId}
                        onSelectTheme={(tId) => {
                            setThemeId(tId);
                            saveThemeId(tId);
                        }}
                        audioInputChannels={status?.audioInputChannels}
                        audioInputPeak={status?.audioInputPeak}
                        onOpenAudioSettings={() => { void native.openAudioSettings(); }}
                        audioInputDevice={status?.audioInputDevice}
                        followPlayhead={followPlayhead}
                        onToggleFollowPlayhead={toggleFollowPlayhead}
                        zoomAnchorMode={zoomAnchorMode}
                        onSetZoomAnchorMode={handleSetZoomAnchorMode}
                        onClose={() => setShowSettings(false)}
                    />
                )}
                {/* VST3 インサート FX チェーンモーダル */}
                {fxChainTrack !== null && (
                    <FxChain
                        trackIdx={fxChainTrack}
                        isOpen={fxChainTrack !== null}
                        onClose={() => setFxChainTrack(null)}
                        onOpenVoiceChanger={() => openVoiceChangerForTrack(fxChainTrack)}
                        onOpenEq={() => setEqModalClip({ track: fxChainTrack, clip: -1 })}
                    />
                )}
                {/* 🛡️ プラグインスキャナーモーダル */}
                <PluginScannerModal
                    isOpen={showPluginScanner}
                    onClose={() => setShowPluginScanner(false)}
                />



                {/* ⚡️ インターバル・シーケンス・エディタ */}
                <IntervalSequencerModal
                    isOpen={showIntervalSequencer}
                    onClose={() => setShowIntervalSequencer(false)}
                    currentBpm={synth?.bpm ?? 120}
                    activeTrackIndex={selectedClip?.track ?? 0}
                    voices={voices}
                    selectedVoiceIndex={selectedVoiceIdx}
                    onSelectVoice={setSelectedVoiceIdx}
                    virtualAnalogPresets={virtualAnalogPresets}
                    selectedVirtualAnalogPresetIdx={selectedVirtualAnalogPresetIdx}
                    onSelectVirtualAnalogPreset={setSelectedVirtualAnalogPresetIdx}
                    onApplyToTimeline={handleApplyIntervalSequenceToTimeline}
                />

                {virtualAnalogTrack && (
                    <VirtualAnalogSynthEditor
                        trackIndex={virtualAnalogTrack.index}
                        trackName={virtualAnalogTrack.name}
                        initialPresetIndex={selectedVirtualAnalogPresetIdx}
                        onClose={() => setVirtualAnalogTrack(null)}
                    />
                )}
                {voiceChangerTrack && (
                    <VoiceChangerEditor
                        trackIndex={voiceChangerTrack.index}
                        trackName={voiceChangerTrack.name}
                        onClose={() => setVoiceChangerTrack(null)}
                    />
                )}
                {eqModalClip && (
                    <EqualizerModal
                        trackIndex={eqModalClip.track}
                        clipIndex={eqModalClip.clip}
                        clipName={session?.tracks[eqModalClip.track]?.clips[eqModalClip.clip] ? `Clip ${eqModalClip.clip + 1}` : 'Clip'}
                        initialParams={session?.tracks[eqModalClip.track]?.clips[eqModalClip.clip]?.eq}
                        onClose={() => setEqModalClip(null)}
                        onApplied={async () => {
                            await refreshSession();
                        }}
                    />
                )}
            </div>
        </ThemeProvider>
    );
}
