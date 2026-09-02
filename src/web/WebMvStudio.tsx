//==============================================================================
// MV Studio Web 版ルートコンポーネント。
// ユーザー持ち込み音声ファイルを読み込み、デスクトップ版と同一の
// MvWorkspace (3 ペイン MV エディタ + WebMCP ツール群) へ接続する。
//
// デスクトップとの差分はこのファイルと src/web/ 配下のみ:
//  - Status は WebAudioEngine の 50ms ポーリングで生成
//  - Analysis は読み込み時にピーク包絡を計算して生成
//  - BPM は UI 入力 (デスクトップの SynthState に相当)
//==============================================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MvWorkspace } from '../components/mv/MvWorkspace';
import { useWebMcpBoot } from '../components/mv/useWebMcpBoot';
import { IconSparkles, IconWaveform, IconVolume, IconVolumeMute, IconReset } from '../components/Icons';
import { WebMcpInfoDialog } from './WebMcpInfoDialog';
import { WEB_MCP_TOOL_CATALOG, WEB_MCP_TOOL_CATALOG_COUNT } from './webMcpToolCatalog';
import { getWebAudioEngine } from './webAudioEngine';
import { computeAnalysisPeaks } from './peaksUtils';
import { detectBpmFromPeaks } from './bpmDetect';
import { useI18n, setLang, type Lang } from '../i18n';
import type { Analysis, SessionState, Status, SynthState, SynthParams } from '../types';
import homeBackground from '../assets/mv-studio-home-bg.png';
import featureExport from '../assets/mv-feature-export.png';
import featureAiLyrics from '../assets/mv-feature-ai-lyrics.png';
import featureStems from '../assets/mv-feature-stems.png';

const DEFAULT_BPM = 120;
const AUDIO_FILE_EXTENSIONS = /\.(mp3|wav|m4a|ogg|flac)$/i;
type SampleTrack = {
    id: string;
    fileName: string;
    url: string;
    number: number;
    kind: { ja: string; en: string };
};

const SAMPLE_TRACKS: SampleTrack[] = [
    { id: 'vocal-01', fileName: 'vocal-01.mp3', url: '/demo/samples/vocal-01.mp3', number: 1, kind: { ja: 'ボーカル曲', en: 'Vocal track' } },
    { id: 'vocal-02', fileName: 'vocal-02.mp3', url: '/demo/samples/vocal-02.mp3', number: 2, kind: { ja: 'ボーカル曲', en: 'Vocal track' } },
    { id: 'instrumental-01', fileName: 'instrumental-01.mp3', url: '/demo/samples/instrumental-01.mp3', number: 1, kind: { ja: 'インスト曲', en: 'Instrumental' } },
    { id: 'instrumental-02', fileName: 'instrumental-02.mp3', url: '/demo/samples/instrumental-02.mp3', number: 2, kind: { ja: 'インスト曲', en: 'Instrumental' } },
    { id: 'instrumental-03', fileName: 'instrumental-03.mp3', url: '/demo/samples/instrumental-03.mp3', number: 3, kind: { ja: 'インスト曲', en: 'Instrumental' } },
    { id: 'instrumental-04', fileName: 'instrumental-04.mp3', url: '/demo/samples/instrumental-04.mp3', number: 4, kind: { ja: 'インスト曲', en: 'Instrumental' } },
];

const DEFAULT_SYNTH_PARAMS: SynthParams = {
    attack: 0.01,
    decay: 0.2,
    sustain: 0.5,
    release: 0.3,
    filterCutoff: 8000,
    filterResonance: 0.5,
    masterGain: 1,
};

export const WebMvStudio: React.FC = () => {
    const engineRef = useRef(getWebAudioEngine());
    const { t } = useI18n();
    const [hasAudio, setHasAudio] = useState(false);
    const [duration, setDuration] = useState(0);
    const [fileName, setFileName] = useState('');
    const [bpm, setBpm] = useState(DEFAULT_BPM);
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const [status, setStatus] = useState<Status | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [masterGain, setMasterGainState] = useState(1.0);

    const setMasterGain = useCallback((g: number) => {
        const clamped = Math.max(0, Math.min(2.0, Number.isFinite(g) ? g : 1.0));
        setMasterGainState(clamped);
        engineRef.current.setGain(clamped);
    }, []);

    // Status を 50ms ポーリングで生成 (デスクトップ MainComponent の 30Hz 相当)
    useEffect(() => {
        if (!hasAudio) return;
        const id = window.setInterval(() => {
            setStatus(engineRef.current.getStatus());
        }, 50);
        return () => window.clearInterval(id);
    }, [hasAudio]);

    const loadFile = useCallback(async (file: File) => {
        setErrorText(null);
        setIsLoading(true);
        try {
            const engine = engineRef.current;
            const result = await engine.loadFile(file);
            const peaks = computeAnalysisPeaks(engine.getBuffer());
            const analysisData: Analysis = {
                duration: result.duration,
                peaks,
                pitch: [],
                pitchTimes: [],
                attackTimes: [],
                notes: [],
            };
            setHasAudio(true);
            setDuration(result.duration);
            setFileName(result.fileName);
            setAnalysis(analysisData);
            setStatus(engine.getStatus());
            // BPM 自動検出: 解析ピークから推定し、UI 初期値へ反映 (手動補正は可能)
            const detected = detectBpmFromPeaks({ peaks, duration: result.duration });
            if (detected) {
                setBpm(detected);
            }
            return true;
        } catch {
            setErrorText(t.loadFailed);
            return false;
        } finally {
            setIsLoading(false);
        }
    }, [t.loadFailed]);

    const loadSample = useCallback(async (sample: SampleTrack) => {
        try {
            const response = await fetch(sample.url);
            if (!response.ok) throw new Error(`Sample request failed: ${response.status}`);
            const blob = await response.blob();
            return await loadFile(new File([blob], sample.fileName, { type: 'audio/mpeg' }));
        } catch {
            setErrorText(t.loadFailed);
            return false;
        }
    }, [loadFile, t.loadFailed]);

    // ページ上のどこへ落としてもブラウザがファイルを開かず、音声を読み込む。
    // React の表示領域外や子要素の境界へ落とした場合も同じ導線に合流させる。
    useEffect(() => {
        if (hasAudio) return;
        const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
        const isAudioFile = (file: File) => file.type.startsWith('audio/') || AUDIO_FILE_EXTENSIONS.test(file.name);
        const onDragOver = (event: DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setIsDragOver(true);
        };
        const onDragLeave = (event: DragEvent) => {
            if (!hasFiles(event) || event.relatedTarget) return;
            setIsDragOver(false);
        };
        const onDrop = (event: DragEvent) => {
            if (!hasFiles(event) || event.defaultPrevented) return;
            event.preventDefault();
            setIsDragOver(false);
            const file = event.dataTransfer?.files?.[0];
            if (file && isAudioFile(file)) void loadFile(file);
        };

        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, [hasAudio, loadFile]);

    // 楽曲ロード前 (ウェルカム画面) に WebMCP ブートツールを先行登録し、
    // エージェントが「デモ曲のロードから」主導できるようにする
    useWebMcpBoot({
        active: !hasAudio,
        ctx: useMemo(() => ({
            isAudioLoaded: () => Boolean(engineRef.current.getBuffer()),
            onLoadFile: (file: File) => loadFile(file),
        }), [loadFile]),
    });

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && (file.type.startsWith('audio/') || AUDIO_FILE_EXTENSIONS.test(file.name))) void loadFile(file);
    }, [loadFile]);

    const session: SessionState = useMemo(() => ({
        sampleRate: status?.sampleRate ?? 48000,
        duration,
        tracks: [
            {
                name: fileName || 'Music',
                gain: 1,
                pan: 0,
                mute: false,
                solo: false,
                armed: false,
                monitor: false,
                clips: [],
            },
        ],
    }), [status?.sampleRate, duration, fileName]);

    const synth: SynthState = useMemo(() => ({
        hasVoice: false,
        basePitch: 0,
        baseMidiNote: 60,
        stepCount: 16,
        bpm,
        playing: Boolean(status?.isSessionPlaying),
        seqStep: 0,
        pattern: [],
        params: DEFAULT_SYNTH_PARAMS,
    }), [bpm, status?.isSessionPlaying]);

    return <WebMvStudioView
        {...{ engineRef, hasAudio, duration, fileName, bpm, setBpm, masterGain, setMasterGain, analysis, status, isLoading, errorText, isDragOver, setIsDragOver, onDrop, loadFile, loadSample, session, synth }}
    />;
};

interface ViewProps {
    engineRef: React.MutableRefObject<ReturnType<typeof getWebAudioEngine>>;
    hasAudio: boolean;
    duration: number;
    fileName: string;
    bpm: number;
    setBpm: (v: number) => void;
    masterGain: number;
    setMasterGain: (v: number) => void;
    analysis: Analysis | null;
    status: Status | null;
    isLoading: boolean;
    errorText: string | null;
    isDragOver: boolean;
    setIsDragOver: (v: boolean) => void;
    onDrop: (e: React.DragEvent) => void;
    loadFile: (f: File) => Promise<boolean>;
    loadSample: (sample: SampleTrack) => Promise<boolean>;
    session: SessionState;
    synth: SynthState;
}

const COLORS = {
    bgApp: '#0d1017',
    bgPanel: '#131822',
    bgInset: '#0a0d14',
    border: '#232d3d',
    textMain: '#dfe5ec',
    textMuted: '#8395a7',
    accent: '#2ed573',
    accentInfo: '#38bdf8',
    danger: '#ef4444',
};
const PREVIEW_COLORS = {
    ink: '#e6e1d8',
    muted: '#9d9a93',
    line: 'rgba(230, 225, 216, 0.32)',
    selected: 'rgba(230, 225, 216, 0.1)',
};

const FILE_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.ogg,.flac';

/** 音声未読み込み時のウェルカム画面 (ドラッグ＆ドロップ) */
const WelcomeScreen: React.FC<Pick<ViewProps, 'isDragOver' | 'setIsDragOver' | 'onDrop' | 'loadFile' | 'loadSample' | 'isLoading' | 'errorText'>> = ({
    isDragOver, setIsDragOver, onDrop, loadFile, loadSample, isLoading, errorText,
}) => {
    const { lang, t } = useI18n();
    const [isWebMcpInfoOpen, setIsWebMcpInfoOpen] = useState(false);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    const [previewTrackId, setPreviewTrackId] = useState<string | null>(null);
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const [previewTime, setPreviewTime] = useState(0);
    const [previewDuration, setPreviewDuration] = useState(0);
    const featureCards = [
        { image: featureExport, title: t.welcomeFeatureExport, description: t.welcomeFeatureExportDesc },
        { image: featureAiLyrics, title: t.welcomeFeatureLyrics, description: t.welcomeFeatureLyricsDesc },
        { image: featureStems, title: t.welcomeFeatureStems, description: t.welcomeFeatureStemsDesc },
    ];
    const formatPreviewTime = (seconds: number) => {
        if (!Number.isFinite(seconds)) return '0:00';
        return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    };
    const togglePreview = async (sample: SampleTrack) => {
        const audio = previewAudioRef.current ?? new Audio();
        previewAudioRef.current = audio;
        if (previewTrackId !== sample.id) {
            audio.pause();
            audio.src = sample.url;
            audio.load();
            setPreviewTrackId(sample.id);
            setPreviewTime(0);
            setPreviewDuration(0);
        }
        if (audio.paused) {
            try {
                await audio.play();
                setPreviewPlaying(true);
            } catch {
                setPreviewPlaying(false);
            }
        } else {
            audio.pause();
            setPreviewPlaying(false);
        }
    };
    const selectPreview = (sample: SampleTrack) => {
        const audio = previewAudioRef.current ?? new Audio();
        previewAudioRef.current = audio;
        audio.pause();
        audio.src = sample.url;
        audio.load();
        setPreviewTrackId(sample.id);
        setPreviewPlaying(false);
        setPreviewTime(0);
        setPreviewDuration(0);
        void audio.play().then(() => setPreviewPlaying(true)).catch(() => setPreviewPlaying(false));
    };
    const selectedPreview = SAMPLE_TRACKS.find((sample) => sample.id === previewTrackId) ?? SAMPLE_TRACKS[0];
    const seekPreview = (value: string) => {
        const audio = previewAudioRef.current;
        if (!audio) return;
        const nextTime = Number(value);
        audio.currentTime = nextTime;
        setPreviewTime(nextTime);
    };
    useEffect(() => {
        const audio = previewAudioRef.current ?? new Audio();
        previewAudioRef.current = audio;
        const onTimeUpdate = () => setPreviewTime(audio.currentTime);
        const onLoadedMetadata = () => setPreviewDuration(audio.duration);
        const onEnded = () => { setPreviewPlaying(false); setPreviewTime(0); };
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('loadedmetadata', onLoadedMetadata);
        audio.addEventListener('ended', onEnded);
        return () => {
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            audio.removeEventListener('ended', onEnded);
            audio.pause();
        };
    }, []);
    return (
        <div
            onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) setIsDragOver(true); }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={onDrop}
            style={{
                minHeight: '100vh',
                position: 'relative',
                overflowX: 'hidden',
                height: '100dvh',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 'clamp(18px, 2vw, 30px)',
                background: COLORS.bgApp,
                color: COLORS.textMain,
                fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif",
                padding: 'clamp(28px, 6vh, 68px) 24px 56px',
                boxSizing: 'border-box',
                border: isDragOver ? `2px dashed ${COLORS.accent}` : `2px dashed ${COLORS.border}`,
            }}
        >
            <style>{`
            @keyframes voiventWelcomeBackgroundDrift {
                0%, 100% { transform: scale(1.035) translate3d(-0.7%, -0.3%, 0); }
                50% { transform: scale(1.075) translate3d(0.7%, 0.35%, 0); }
            }
            @keyframes voiventWelcomeGlowDrift {
                0%, 100% { transform: translate3d(-2%, -1%, 0) scale(1); opacity: 0.35; }
                50% { transform: translate3d(2%, 1%, 0) scale(1.06); opacity: 0.6; }
            }
            .voivent-welcome-bg { animation: voiventWelcomeBackgroundDrift 22s ease-in-out infinite; }
            .voivent-welcome-glow { animation: voiventWelcomeGlowDrift 14s ease-in-out infinite; }
            .voivent-feature-card { transition: transform 180ms ease, border-color 180ms ease, background 180ms ease; }
            .voivent-feature-card:hover { transform: translateY(-4px); border-color: rgba(56, 189, 248, 0.7) !important; background: rgba(19, 24, 34, 0.92) !important; }
            .voivent-feature-card img { transition: filter 180ms ease; }
            .voivent-feature-card:hover img { filter: saturate(0.9) brightness(0.9) !important; }
            .voivent-feature-image-scroll { scrollbar-width: thin; scrollbar-color: rgba(112, 138, 164, 0.72) rgba(10, 14, 21, 0.72); }
            .voivent-feature-image-scroll::-webkit-scrollbar { width: 7px; }
            .voivent-feature-image-scroll::-webkit-scrollbar-track { background: rgba(10, 14, 21, 0.72); }
            .voivent-feature-image-scroll::-webkit-scrollbar-thumb { background: rgba(112, 138, 164, 0.72); border-radius: 999px; }
            .voivent-tool-card { transition: border-color 180ms ease, background 180ms ease; }
            .voivent-tool-card:hover { border-color: rgba(56, 189, 248, 0.5) !important; background: rgba(19, 24, 34, 0.92) !important; }
            .voivent-audio-cta { transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease; }
            .voivent-audio-cta:hover { transform: translateY(-2px); filter: saturate(1.08); box-shadow: 0 12px 30px rgba(46, 213, 115, 0.24) !important; }
            .voivent-audio-cta:active { transform: translateY(0) scale(0.99); }
            @media (prefers-reduced-motion: reduce) {
                .voivent-welcome-bg, .voivent-welcome-glow, .voivent-feature-card, .voivent-feature-card img, .voivent-audio-cta { animation: none !important; transition: none !important; }
            }
        `}</style>
            <div
                aria-hidden="true"
                className="voivent-welcome-bg"
                style={{
                    position: 'absolute',
                    inset: -28,
                    backgroundImage: `url(${homeBackground})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center center',
                    filter: 'blur(1.5px) saturate(0.88) brightness(0.5)',
                    opacity: isDragOver ? 0.7 : 0.62,
                    transition: 'opacity 180ms ease',
                    pointerEvents: 'none',
                }}
            />
            <div
                aria-hidden="true"
                className="voivent-welcome-glow"
                style={{
                    position: 'absolute',
                    inset: '-18%',
                    background: 'radial-gradient(circle at 24% 28%, rgba(56,189,248,0.16), transparent 30%), radial-gradient(circle at 78% 72%, rgba(46,213,115,0.1), transparent 34%)',
                    filter: 'blur(28px)',
                    mixBlendMode: 'screen',
                    pointerEvents: 'none',
                }}
            />
            <div
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(90deg, rgba(13,16,23,0.78) 0%, rgba(13,16,23,0.26) 50%, rgba(13,16,23,0.66) 100%), linear-gradient(0deg, rgba(13,16,23,0.46), rgba(13,16,23,0.12))',
                    pointerEvents: 'none',
                }}
            />
            <div
                style={{
                    position: 'relative',
                    zIndex: 1,
                    width: 'min(1080px, calc(100% - 48px))',
                    marginTop: 'clamp(20px, 10vh, 120px)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'clamp(18px, 2vw, 30px)',
                    padding: 'clamp(30px, 4vw, 58px) clamp(24px, 4vw, 52px) clamp(28px, 3.5vw, 46px)',
                    boxSizing: 'border-box',
                    background: 'rgba(13, 16, 23, 0.68)',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 14,
                    boxShadow: '0 20px 70px rgba(0, 0, 0, 0.4)',
                    backdropFilter: 'blur(8px)',
                }}
            >
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                    <span style={{ fontSize: 'clamp(20px, 2.2vw, 34px)', fontWeight: 900, letterSpacing: '0.08em', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <span>VOIVENT</span>
                        <span style={{ color: '#c3cbd6' }}> MV STUDIO</span>
                    </span>
                    <span style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }}>
                        <LanguageToggleButton />
                    </span>
                </div>
                <div style={{ fontSize: 'clamp(12.5px, 1vw, 17px)', color: COLORS.textMuted, textAlign: 'center', lineHeight: 1.9 }}>
                    {t.welcomeDesc1}<br />
                    {t.welcomeDesc2}
                </div>
                <button
                    type="button"
                    onClick={() => setIsWebMcpInfoOpen(true)}
                    style={{ marginTop: '-12px', padding: 0, color: COLORS.accentInfo, background: 'none', border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                    {t.welcomeWebMcpLearnMore}
                </button>
                <label
                    className="voivent-audio-cta"
                    style={{
                        position: 'relative',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginTop: 'clamp(6px, 1.2vw, 14px)',
                        background: 'linear-gradient(105deg, #2ed573 0%, #35ce91 58%, #38bdf8 100%)', color: '#07141a',
                        borderRadius: 8, padding: 'clamp(12px, 1.2vw, 16px) clamp(22px, 2.2vw, 34px)',
                        minWidth: 'clamp(280px, 28vw, 460px)',
                        fontSize: 'clamp(13px, 1vw, 17px)', fontWeight: 900, letterSpacing: '0.035em', cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 8px 24px rgba(46, 213, 115, 0.14)',
                    }}
                >
                    <span>{isLoading ? t.loading : t.selectAudioFile}</span>
                    <input
                        type="file"
                        accept={FILE_ACCEPT}
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void loadFile(f);
                        }}
                    />
                </label>
                <section aria-label={lang === 'ja' ? 'サンプル曲' : 'Sample tracks'} style={{ width: '100%', marginTop: 'clamp(4px, 0.8vw, 10px)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                        <span style={{ color: COLORS.textMain, fontSize: 12, fontWeight: 800 }}>{lang === 'ja' ? 'すぐ試す' : 'Try a sample'}</span>
                        <span style={{ color: COLORS.textMuted, fontSize: 10 }}>{lang === 'ja' ? '選んで試聴・ダウンロード' : 'Preview, then open or download'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'rgba(8, 9, 11, 0.88)', border: `1px solid ${PREVIEW_COLORS.line}`, borderRadius: 4, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                        <button
                            type="button"
                            aria-label={previewPlaying ? (lang === 'ja' ? '一時停止' : 'Pause') : (lang === 'ja' ? '再生' : 'Play')}
                            onClick={() => void togglePreview(selectedPreview)}
                            style={{ width: 36, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1px solid ${PREVIEW_COLORS.ink}`, borderRadius: 3, background: PREVIEW_COLORS.ink, color: '#101114', cursor: 'pointer' }}
                        >
                            {previewPlaying ? (
                                <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M7 5h3v14H7zm7 0h3v14h-3z" /></svg>
                            ) : (
                                <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="m8 5 11 7-11 7z" /></svg>
                            )}
                        </button>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                                <span style={{ color: PREVIEW_COLORS.ink, fontSize: 11, fontWeight: 800, letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedPreview.kind[lang]} {String(selectedPreview.number).padStart(2, '0')}</span>
                                <span style={{ color: PREVIEW_COLORS.muted, fontSize: 9, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{previewTrackId ? `${formatPreviewTime(previewTime)} / ${formatPreviewTime(previewDuration)}` : (lang === 'ja' ? '曲を選択' : 'Choose a track')}</span>
                            </div>
                            <input type="range" min="0" max={previewDuration || 0} step="0.1" value={previewTime} disabled={!previewTrackId || !previewDuration} onChange={(e) => seekPreview(e.target.value)} aria-label={lang === 'ja' ? '試聴位置' : 'Preview position'} style={{ width: '100%', display: 'block', accentColor: PREVIEW_COLORS.ink, cursor: previewTrackId ? 'pointer' : 'default' }} />
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 0 4px', scrollbarWidth: 'thin' }}>
                        {SAMPLE_TRACKS.map((sample) => (
                            <div key={sample.id} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 7, padding: '8px 10px', background: previewTrackId === sample.id ? PREVIEW_COLORS.selected : 'rgba(8, 9, 11, 0.72)', border: `1px solid ${previewTrackId === sample.id ? PREVIEW_COLORS.ink : PREVIEW_COLORS.line}`, borderRadius: 3 }}>
                                <button type="button" onClick={() => selectPreview(sample)} style={{ border: 'none', padding: '5px 7px', margin: '-5px -2px', background: 'none', color: PREVIEW_COLORS.ink, fontSize: 10, fontWeight: 800, letterSpacing: '0.03em', cursor: 'pointer', whiteSpace: 'nowrap' }}>{sample.kind[lang]} {String(sample.number).padStart(2, '0')}</button>
                                <button type="button" disabled={isLoading} onClick={() => void loadSample(sample)} style={{ border: `1px solid ${PREVIEW_COLORS.line}`, borderRadius: 3, padding: '3px 7px', background: 'transparent', color: PREVIEW_COLORS.muted, fontSize: 9, fontWeight: 800, cursor: isLoading ? 'wait' : 'pointer' }}>{lang === 'ja' ? '試す' : 'Open'}</button>
                                <a href={sample.url} download={sample.fileName} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: PREVIEW_COLORS.muted, textDecoration: 'none' }} title={lang === 'ja' ? 'MP3を保存' : 'Download MP3'}><svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" /></svg></a>
                            </div>
                        ))}
                    </div>
                </section>
                {errorText && (
                    <div style={{ color: COLORS.danger, fontSize: 11.5, fontWeight: 700 }}>{errorText}</div>
                )}
            </div>
            <WebMcpInfoDialog isOpen={isWebMcpInfoOpen} onClose={() => setIsWebMcpInfoOpen(false)} />
            <div
                style={{
                    position: 'relative',
                    zIndex: 1,
                    width: 'min(1240px, calc(100% - 48px))',
                    marginTop: 'clamp(10px, 2.5vh, 28px)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '0 4px 9px' }}>
                    <span style={{ color: COLORS.textMain, fontSize: 'clamp(12px, 1vw, 15px)', fontWeight: 800 }}>{t.welcomeFeatureRail}</span>
                    <span style={{ color: COLORS.accentInfo, fontSize: 10, fontWeight: 900, letterSpacing: '0.16em' }}>FEATURES</span>
                </div>
                <div
                    style={{
                        display: 'flex',
                        gap: 14,
                        overflowX: 'auto',
                        padding: '4px 4px 12px',
                        scrollSnapType: 'x mandatory',
                        scrollbarWidth: 'thin',
                    }}
                >
                    {featureCards.map((feature) => (
                        <article
                            key={feature.title}
                            className="voivent-feature-card"
                            style={{
                                flex: '1 0 min(360px, 31vw)',
                                minWidth: 'min(320px, 82vw)',
                                overflow: 'hidden',
                                scrollSnapAlign: 'start',
                                background: 'rgba(13, 16, 23, 0.8)',
                                border: `1px solid ${COLORS.border}`,
                                borderRadius: 10,
                                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.24)',
                            }}
                        >
                            <div
                                className="voivent-feature-image-scroll"
                                style={{
                                    aspectRatio: '16 / 9',
                                    width: '100%',
                                    overflowY: 'auto',
                                    overflowX: 'hidden',
                                    overscrollBehavior: 'contain',
                                    background: 'rgba(7, 10, 16, 0.82)',
                                }}
                            >
                                <img
                                    src={feature.image}
                                    alt=""
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        height: 'auto',
                                        minHeight: '100%',
                                        objectFit: 'contain',
                                        objectPosition: 'top center',
                                        filter: 'saturate(0.72) brightness(0.68)',
                                    }}
                                />
                            </div>
                            <div style={{ padding: '11px 14px 13px' }}>
                                <div style={{ color: COLORS.textMain, fontSize: 'clamp(12px, 1vw, 15px)', fontWeight: 800 }}>{feature.title}</div>
                                <div style={{ marginTop: 4, color: COLORS.textMuted, fontSize: 'clamp(10px, 0.78vw, 12px)', lineHeight: 1.45 }}>{feature.description}</div>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
            <section
                aria-labelledby="webmcp-tools-title"
                style={{
                    position: 'relative', zIndex: 1, width: 'min(1240px, calc(100% - 48px))',
                    marginTop: 'clamp(24px, 4vh, 44px)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '0 4px 9px' }}>
                    <span id="webmcp-tools-title" style={{ color: COLORS.textMain, fontSize: 'clamp(12px, 1vw, 15px)', fontWeight: 800 }}>
                        {lang === 'ja' ? 'AIが操作できること' : 'What the AI can control'}
                    </span>
                    <span style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 700 }}>
                        {WEB_MCP_TOOL_CATALOG_COUNT} tools
                    </span>
                </div>
                <p style={{ margin: '0 4px 14px', color: COLORS.textMuted, fontSize: 'clamp(10px, 0.78vw, 12px)', lineHeight: 1.6 }}>
                    {lang === 'ja'
                        ? 'WebMCP対応のAIエージェントは、会話から次の制作機能を呼び出せます。'
                        : 'A WebMCP-aware AI agent can call the following creative tools through conversation.'}
                </p>
                <div
                    style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(330px, 100%), 1fr))',
                        gap: 12,
                    }}
                >
                    {WEB_MCP_TOOL_CATALOG.map((group) => (
                        <article
                            key={group.title.en}
                            className="voivent-tool-card"
                            style={{
                                padding: '14px 15px 12px', background: 'rgba(13, 16, 23, 0.78)',
                                border: `1px solid ${COLORS.border}`, borderRadius: 10,
                            }}
                        >
                            <h3 style={{ margin: '0 0 10px', color: COLORS.textMain, fontSize: 12, fontWeight: 800 }}>
                                {group.title[lang]}
                            </h3>
                            <div style={{ display: 'grid', gap: 8 }}>
                                {group.items.map((tool) => (
                                    <div key={tool.name.en} style={{ display: 'grid', gridTemplateColumns: '7px 1fr', gap: 8, alignItems: 'start' }}>
                                        <span aria-hidden="true" style={{ width: 5, height: 5, marginTop: 5, borderRadius: '50%', background: COLORS.accentInfo }} />
                                        <div>
                                            <div style={{ color: '#cdd6e0', fontSize: 11, fontWeight: 800 }}>{tool.name[lang]}</div>
                                            <div style={{ marginTop: 2, color: COLORS.textMuted, fontSize: 10, lineHeight: 1.45 }}>{tool.description[lang]}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </article>
                    ))}
                </div>
            </section>
        </div>
    );
};

//==============================================================================
// 言語切替ボタン (JA / EN トグル)。
// 押下ごとに ja ⇄ en を切り替え、i18n ストア経由で全 UI へ即時反映する。
//==============================================================================
const LanguageToggleButton: React.FC = () => {
    const { lang, t } = useI18n();
    const next: Lang = lang === 'ja' ? 'en' : 'ja';
    return (
        <button
            onClick={() => setLang(next)}
            title={lang === 'ja' ? t.langSwitchToEn : t.langSwitchToJa}
            style={{
                background: 'transparent',
                color: COLORS.textMuted,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 5,
                padding: '6px 13px',
                minWidth: 48,
                minHeight: 30,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: '0.08em',
                cursor: 'pointer',
            }}
        >
            {lang === 'ja' ? 'EN' : 'JA'}
        </button>
    );
};

/** 音声読み込み後のスタジオ画面 */
const StudioScreen: React.FC<ViewProps> = ({
    engineRef, fileName, bpm, setBpm, masterGain, setMasterGain, analysis, status, session, synth, duration, loadFile,
}) => {
    const { t } = useI18n();
    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: COLORS.bgApp }}>
            <div
                style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '6px 14px',
                    borderBottom: '1px solid #1c2333',
                    background: COLORS.bgPanel,
                    color: COLORS.textMain,
                    flexShrink: 0,
                }}
            >
                <IconWaveform size={14} color={COLORS.accent} />
                <span
                    title={fileName}
                    style={{ fontSize: 12, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}
                >
                    {fileName}
                </span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: COLORS.textMuted }}>
                    BPM
                    <input
                        type="number"
                        min={40}
                        max={300}
                        value={bpm}
                        onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v >= 40 && v <= 300) setBpm(Math.round(v));
                        }}
                        style={{
                            width: 58, background: COLORS.bgInset, color: COLORS.textMain,
                            border: `1px solid ${COLORS.border}`, borderRadius: 5,
                            padding: '4px 7px', fontSize: 11, fontWeight: 800,
                        }}
                    />
                </label>
                <span style={{ fontSize: 10, color: COLORS.textMuted, whiteSpace: 'nowrap' }}>
                    {status?.isSessionPlaying ? t.playing : t.ready} · {Math.round(status?.sessionPosition ?? 0)}s / {Math.round(duration)}s
                </span>

                {/* マスター音量 / ゲイン調整 & リセット */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: COLORS.bgInset,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 6,
                        padding: '3px 8px',
                    }}
                    title={t.masterVolume}
                >
                    {masterGain <= 0.001 ? (
                        <IconVolumeMute size={13} color={COLORS.textMuted} />
                    ) : (
                        <IconVolume size={13} color={COLORS.accentInfo} />
                    )}
                    <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={masterGain}
                        onChange={(e) => setMasterGain(Number(e.target.value))}
                        title={t.masterVolume}
                        style={{
                            width: 64,
                            height: 3,
                            accentColor: COLORS.accentInfo,
                            cursor: 'pointer',
                        }}
                    />
                    <span
                        style={{
                            fontSize: 10,
                            fontWeight: 800,
                            fontFamily: 'monospace',
                            color: masterGain === 1.0 ? COLORS.textMuted : COLORS.accentInfo,
                            minWidth: 34,
                            textAlign: 'right',
                        }}
                    >
                        {Math.round(masterGain * 100)}%
                    </span>
                    {masterGain !== 1.0 && (
                        <button
                            onClick={() => setMasterGain(1.0)}
                            title={t.resetVolume}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                padding: '1px 2px',
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                color: COLORS.textMuted,
                            }}
                        >
                            <IconReset size={11} color={COLORS.textMuted} />
                        </button>
                    )}
                </div>

                <label
                    style={{
                        marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
                        background: '#161c28', color: COLORS.textMuted,
                        border: `1px solid ${COLORS.border}`, borderRadius: 6,
                        padding: '5px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    }}
                >
                    {t.changeTrack}
                    <input
                        type="file"
                        accept={FILE_ACCEPT}
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void loadFile(f);
                        }}
                    />
                </label>
                <LanguageToggleButton />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
                <MvWorkspace
                    analysis={analysis}
                    status={status}
                    synth={synth}
                    session={session}
                    projectPath={null}
                    initialAudioBuffer={engineRef.current.getBuffer()}
                    exportAudioGain={masterGain}
                    onExportAudioGainChange={setMasterGain}
                />
            </div>
        </div>
    );
};

/** ルート: 状態に応じてウェルカム / スタジオを切り替える */
const WebMvStudioView: React.FC<ViewProps> = (props) => {
    if (!props.hasAudio) {
        return (
            <WelcomeScreen
                isDragOver={props.isDragOver}
                setIsDragOver={props.setIsDragOver}
                onDrop={props.onDrop}
                loadFile={props.loadFile}
                loadSample={props.loadSample}
                isLoading={props.isLoading}
                errorText={props.errorText}
            />
        );
    }
    return <StudioScreen {...props} />;
};
