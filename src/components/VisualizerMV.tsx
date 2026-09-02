//==============================================================================
// オーディオリアクティブ MV ビジュアライザー & 波形解析コンポーネント。
// 音楽・声のピッチ・アタック・MIDI に連動して、自然とエモい MV が生成される。
//==============================================================================
import React, { useEffect, useRef, useState } from 'react';
import type { Analysis, SessionState, Status, SynthState } from '../types';
import { formatTime, hzToY, noteName } from '../lib/music';
import {
    IconDownload,
    IconPlay,
    IconSparkles,
    IconStop,
    IconVideo,
    IconWaveform,
    IconSpectrum,
    IconCircleWave,
    IconLaserWave,
    IconWarpGrid,
    IconEyeOff,
    IconCode,
    IconSliders,
} from './Icons';
import { native } from '../native';
import { flushSync } from 'react-dom';
import type { MvSceneUpdatedPayload, MvSceneUpdatedDispatcher } from '../native';
import { AudioReactiveSandbox } from './mv/AudioReactiveSandbox';
import { MvWorkspace } from './mv/MvWorkspace';
import { useMvAudioSignals } from './mv/useMvAudioSignals';
import { useMvConfigStore } from './mv/useMvConfigStore';
import type { AudioSignals } from './mv/types';
import { VoiceToMidiControls } from './voiceToMidi/VoiceToMidiControls';
import { VoiceToMidiOverlay } from './voiceToMidi/VoiceToMidiOverlay';
import { extractMidiNotesFromVoice } from './voiceToMidi/voiceToMidiMath';
import type { VoiceToMidiSettings } from './voiceToMidi/types';

export type MVTheme = 'cyber' | 'lofi' | 'aura' | 'minimal';
export type VisualStyle = 'spectrum' | 'ring' | 'wave' | 'warp' | 'off';

export interface DisplayNote {
    midi: number;
    start: number;
    end: number;
    color?: string;
}

interface VisualizerMVProps {
    analysis: Analysis | null;
    status: Status | null;
    synth: SynthState | null;
    session: SessionState | null;
    selectedNote: number;
    mode?: 'mv' | 'waveform';
    activeClipLabel?: string;
    /** 現在のプロジェクトパス（MV 設定のプロジェクト別永続化に使用） */
    projectPath?: string | null;
    /** MV モードを 3 ペイン専用ワークスペースとして全画面表示するか（既定 true）。
     *  false にすると従来のモーダル型 UI（クラシック UI）へフォールバックする */
    useWorkspace?: boolean;
}

/**
 * MV モード時は 3 ペイン専用ワークスペースへ委譲し、それ以外は
 * 従来の単一ビジュアライザーを描画する薄いラッパー。
 * （フック順序規則を守るため、分岐はフックを持たないこの層で行う）
 */
export function VisualizerMV(props: VisualizerMVProps) {
    const { mode = 'mv', useWorkspace = true } = props;
    if (mode === 'mv' && useWorkspace) {
        return (
            <MvWorkspace
                analysis={props.analysis}
                status={props.status}
                synth={props.synth}
                session={props.session}
                projectPath={props.projectPath ?? null}
            />
        );
    }
    return <VisualizerMVClassic {...props} />;
}

/** 従来型ビジュアライザー本体（波形解析・クラシック UI フォールバック用） */
function VisualizerMVClassic({
    analysis,
    status,
    synth,
    session,
    selectedNote,
    mode = 'mv',
    activeClipLabel,
    projectPath = null,
}: Omit<VisualizerMVProps, 'useWorkspace'>) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    // 🎬 AI サンドボックス DOM の録画対象コンテナ参照（エクスポート時にラスタライズ）
    const sandboxHostRef = useRef<HTMLDivElement | null>(null);
    // 📁 プロジェクトパス（App から渡された currentProject.path を保持。未保存時は null）
    const projectPathRef = useRef<string | null>(projectPath ?? null);
    projectPathRef.current = projectPath ?? null;
    const [theme, setTheme] = useState<MVTheme>('cyber');
    const [visualStyle, setVisualStyle] = useState<VisualStyle>('spectrum');
    const [isCustomMv, setIsCustomMv] = useState<boolean>(true); // デフォルトでAI動的サンドボックスモードを有効化
    // 💾 プロジェクトパスごとに永続化される MV 設定ストア（プロジェクト切替時に自動スワップ）
    const { mvConfig, setMvConfig } = useMvConfigStore(projectPathRef.current);
    // タイトルはプロジェクト名から初期化し、未保存時のみデフォルト表示
    const [trackTitle, setTrackTitle] = useState(() => {
        if (projectPath) {
            const base = projectPath.split('/').pop() || '';
            return base.replace(/\.(voivent|json)$/i, '') || 'Voivent Session';
        }
        return 'Voivent Session';
    });
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    // プロジェクト切替時にタイトルを追従（ユーザーが手動編集済みでも上書きする）
    useEffect(() => {
        if (projectPath) {
            const base = projectPath.split('/').pop() || '';
            setTrackTitle(base.replace(/\.(voivent|json)$/i, '') || 'Voivent Session');
        }
    }, [projectPath]);
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportRangeType, setExportRangeType] = useState<'all' | 'custom'>('all');
    const [exportStartSec, setExportStartSec] = useState(0);
    const [exportEndSec, setExportEndSec] = useState(session?.duration || 16);
    const [isRecordingVideo, setIsRecordingVideo] = useState(false);
    const [recordingSec, setRecordingSec] = useState(0);
    const [exportMessage, setExportMessage] = useState<string | null>(null);
    const [exportProgress, setExportProgress] = useState(0); // 0-100

    // 🎤 Voice to MIDI（鼻歌メロディ抽出）の設定と抽出状態
    const [v2mSettings, setV2mSettings] = useState<VoiceToMidiSettings>({
        noiseGateThreshold: 0.05,
        minNoteDurationSec: 0.08,
        pitchSmoothing: 3,
        scale: 'chromatic',
        rootKey: 0,
        velocitySensitivity: 1.0,
    });
    const [isInsertingV2M, setIsInsertingV2M] = useState(false);

    // 抽出された MIDI ノート（リアルタイムにパラメータ追従）
    const extractedV2MNotes = React.useMemo(() => {
        if (!analysis || !analysis.pitch || analysis.pitch.length === 0) return [];
        // peaks から振幅配列を計算
        const rmsArray = analysis.peaks && analysis.peaks.length > 0
            ? analysis.peaks.map(([mn, mx]) => Math.max(Math.abs(mn), Math.abs(mx)))
            : [];
        return extractMidiNotesFromVoice(
            analysis.pitch,
            analysis.pitchTimes || [],
            rmsArray,
            v2mSettings
        );
    }, [analysis, v2mSettings]);

    // タイムラインへ MIDI クリップとして配置
    const handleInsertV2MToTimeline = async () => {
        if (extractedV2MNotes.length === 0 || isInsertingV2M) return;
        setIsInsertingV2M(true);
        try {
            // アーム中または選択中のトラック（なければ0番トラック）
            const armedIdx = session?.tracks.findIndex((t) => t.armed) ?? -1;
            const targetTrack = armedIdx >= 0 ? armedIdx : 0;
            const isVa = session?.tracks[targetTrack]?.inputType === 'midi';
            const playheadSec = status?.sessionPosition ?? 0;

            const payload = extractedV2MNotes.map((n) => ({
                midi: n.midi,
                startSeconds: n.startSeconds,
                endSeconds: n.endSeconds,
                velocity: n.velocity,
            }));

            await native.sessionInsertMidiNotesClip(targetTrack, payload, isVa, playheadSec);
            setExportMessage('🎵 タイムラインへ MIDI クリップを配置しました！');
            setTimeout(() => setExportMessage(null), 2500);
        } catch (err) {
            console.error('Failed to insert V2M clip:', err);
            setExportMessage('❌ タイムラインへの配置に失敗しました');
            setTimeout(() => setExportMessage(null), 3000);
        } finally {
            setIsInsertingV2M(false);
        }
    };

    // 🎛️ 解析対象トラック選択状態（実オーディオシグナル生成へ反映）
    const [selectedVocalTracks] = useState<number[]>([0]);

    // 🤖 外部 AI (MCP) からのリアルタイム SVG シーン更新イベントリスナー
    useEffect(() => {
        const handleMcpUpdate = (e: CustomEvent<MvSceneUpdatedPayload>) => {
            const { svgCode, cssCode } = e.detail ?? {};
            if (svgCode) {
                setMvConfig((prev) => {
                    const newScenes = [...prev.scenes];
                    if (newScenes.length > 0) {
                        newScenes[0] = { ...newScenes[0], svgCode, cssCode: cssCode || prev.globalCss };
                    }
                    const updated = {
                        ...prev,
                        scenes: newScenes,
                        globalCss: cssCode || prev.globalCss,
                    };
                    return updated;
                });
            }
        };

        window.addEventListener('voivent-mcp-update-scene', handleMcpUpdate as EventListener);
        (window as Window & { __voiventUpdateMvScene?: MvSceneUpdatedDispatcher }).__voiventUpdateMvScene =
            (sceneId: string, svgCode: string, cssCode?: string) => {
                window.dispatchEvent(new CustomEvent<MvSceneUpdatedPayload>('voivent-mcp-update-scene', { detail: { sceneId, svgCode, cssCode } }));
            };

        return () => {
            window.removeEventListener('voivent-mcp-update-scene', handleMcpUpdate as EventListener);
        };
    }, []);

    // 解像度プリセット
    type ResolutionPreset = {
        id: string;
        label: string;
        subLabel: string;
        width: number;
        height: number;
        platform: string;
    };
    const RESOLUTION_PRESETS: ResolutionPreset[] = [
        { id: 'youtube_fhd', label: '1920 × 1080', subLabel: 'Full HD', width: 1920, height: 1080, platform: 'YouTube / 横動画' },
        { id: 'shorts_fhd', label: '1080 × 1920', subLabel: 'Vertical HD', width: 1080, height: 1920, platform: 'TikTok / Shorts 縦型' },
        { id: 'square_hd', label: '1080 × 1080', subLabel: 'Square HD', width: 1080, height: 1080, platform: 'Instagram 正方形' },
        { id: 'hd720', label: '1280 × 720', subLabel: 'HD 720p', width: 1280, height: 720, platform: 'YouTube / 軽量' },
        { id: 'shorts_720', label: '720 × 1280', subLabel: 'Vertical 720p', width: 720, height: 1280, platform: 'TikTok / 軽量縦型' },
    ];
    type BitratePreset = { id: string; label: string; subLabel: string; bps: number };
    const BITRATE_PRESETS: BitratePreset[] = [
        { id: 'hq', label: '高画質', subLabel: '12 Mbps', bps: 12_000_000 },
        { id: 'std', label: '標準', subLabel: '6 Mbps', bps: 6_000_000 },
        { id: 'lite', label: '軽量', subLabel: '3 Mbps', bps: 3_000_000 },
    ];
    const [selectedResolution, setSelectedResolution] = useState(RESOLUTION_PRESETS[0].id);
    const [selectedBitrate, setSelectedBitrate] = useState(BITRATE_PRESETS[1].id);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<number | null>(null);
    const exportCanvasRef = useRef<HTMLCanvasElement | null>(null); // オフスクリーン高解像度キャンバス

    // 🎥 MP4 優先 / 解像度・ビットレート指定 MV エクスポート
    const executeVideoExport = async () => {
        const preset = RESOLUTION_PRESETS.find((p) => p.id === selectedResolution) ?? RESOLUTION_PRESETS[0];
        const bitratePreset = BITRATE_PRESETS.find((b) => b.id === selectedBitrate) ?? BITRATE_PRESETS[1];
        const duration = session?.duration || 10;
        const startSec = exportRangeType === 'all' ? 0 : Math.max(0, exportStartSec);
        const targetEndSec = exportRangeType === 'all' ? Math.max(4, duration) : Math.max(startSec + 1, exportEndSec);
        const totalDurationSec = targetEndSec - startSec;

        // 🎯 録画ソース解決: クラシック Canvas があればそれを使用し、
        // AI サンドボックスモード時は DOM ラスタライズにフォールバックする。
        const useDomCapture = !canvasRef.current && Boolean(sandboxHostRef.current);
        if (!canvasRef.current && !sandboxHostRef.current) return;

        // オフスクリーンキャンバスを指定解像度で作成
        const offCanvas = document.createElement('canvas');
        offCanvas.width = preset.width;
        offCanvas.height = preset.height;
        exportCanvasRef.current = offCanvas;
        const offCtx = offCanvas.getContext('2d');

        setShowExportModal(false);
        setExportMessage('音声レンダリング中...');
        setExportProgress(0);

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Step 1: ネイティブからセッション音声を WAV Base64 でレンダリング
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        let audioTrack: MediaStreamTrack | null = null;
        let audioCtx: AudioContext | null = null;
        let audioSource: AudioBufferSourceNode | null = null;

        try {
            const wavB64 = await native.renderSessionAudioForMV(startSec, targetEndSec);
            if (wavB64 && typeof wavB64 === 'string') {
                // Base64 → ArrayBuffer → AudioBuffer
                const binary = atob(wavB64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

                audioCtx = new AudioContext();
                const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);

                // AudioContext → MediaStream への橋渡し
                const dest = audioCtx.createMediaStreamDestination();
                audioSource = audioCtx.createBufferSource();
                audioSource.buffer = audioBuffer;
                audioSource.connect(dest);

                audioTrack = dest.stream.getAudioTracks()[0] ?? null;
            }
        } catch (e) {
            console.warn('[VisualizerMV] Audio pre-render failed, video only:', e);
        }
        // 音声プリレンダ失敗時は無音動画になる旨を明示（黙示的な無音動画生成の防止）
        if (!audioTrack) {
            setExportMessage('警告: 音声レンダリングに失敗したため、無音動画になります');
        }

        setExportMessage('録画中...');

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Step 2: letterbox / pillarbox でアスペクト比を保ったままコピー
        // クラシック Canvas モード: 直接 drawImage。
        // AI サンドボックスモード: DOM を foreignObject 経由で毎フレーム非同期ラスタライズ。
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        let copyActive = true;
        let rasterizing = false;
        let lastFrame: HTMLImageElement | null = null;
        const copyLoop = () => {
            if (!copyActive || !offCtx) return;

            const dstW = preset.width;
            const dstH = preset.height;

            // DOM / Phaser キャンバス フレームのラスタライズ
            if (useDomCapture && sandboxHostRef.current) {
                const phaserCanvas = sandboxHostRef.current.querySelector('canvas');
                if (phaserCanvas && phaserCanvas.width > 0 && phaserCanvas.height > 0) {
                    const srcAspect = phaserCanvas.width / phaserCanvas.height;
                    const dstAspect = dstW / dstH;
                    let drawW = dstW;
                    let drawH = dstH;
                    if (srcAspect > dstAspect) {
                        drawH = Math.round(dstW / srcAspect);
                    } else if (srcAspect < dstAspect) {
                        drawW = Math.round(dstH * srcAspect);
                    }
                    const dx = Math.round((dstW - drawW) / 2);
                    const dy = Math.round((dstH - drawH) / 2);
                    offCtx.fillStyle = '#000000';
                    offCtx.fillRect(0, 0, dstW, dstH);
                    try {
                        offCtx.drawImage(phaserCanvas, dx, dy, drawW, drawH);
                    } catch {
                        /* drawImage 失敗時は黒維持 */
                    }
                }
            } else if (!useDomCapture && canvasRef.current && offCtx) {
                // クラシック Canvas: 選択した出力比率を優先し、中央クロップで最大活用。
                const c = canvasRef.current;
                const srcW = c.width;
                const srcH = c.height;
                const srcAspect = srcW / Math.max(1, srcH);
                const dstAspect = dstW / dstH;
                let cropW = srcW;
                let cropH = srcH;
                if (srcAspect > dstAspect) {
                    cropW = Math.round(srcH * dstAspect);
                } else if (srcAspect < dstAspect) {
                    cropH = Math.round(srcW / dstAspect);
                }
                const cropX = Math.round((srcW - cropW) / 2);
                const cropY = Math.round((srcH - cropH) / 2);
                offCtx.drawImage(c, cropX, cropY, cropW, cropH, 0, 0, dstW, dstH);
            }
            requestAnimationFrame(copyLoop);
        };
        requestAnimationFrame(copyLoop);

        try {
            // 映像ストリーム（オフスクリーンキャンバスから）
            const videoStream = offCanvas.captureStream(60);

            // 音声トラックがあれば追加
            if (audioTrack) {
                videoStream.addTrack(audioTrack);
            }

            // MP4 優先、WebM フォールバック
            const allTypes = [
                'video/mp4;codecs=avc1,mp4a.40.2',
                'video/mp4;codecs=avc1',
                'video/mp4;codecs=h264',
                'video/mp4',
                'video/webm;codecs=vp9,opus',
                'video/webm;codecs=vp9',
                'video/webm;codecs=vp8,opus',
                'video/webm;codecs=vp8',
                'video/webm',
            ];
            const mimeType = allTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
            const isMP4 = mimeType.startsWith('video/mp4');

            const recorder = new MediaRecorder(videoStream, {
                mimeType,
                videoBitsPerSecond: bitratePreset.bps,
            });

            recordedChunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunksRef.current.push(e.data);
            };

            recorder.onstop = async () => {
                copyActive = false;
                audioSource?.stop();
                audioCtx?.close();
                setIsRecordingVideo(false);
                setRecordingSec(0);
                setExportProgress(100);
                if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
                await native.stopSessionPlayback();

                const blobType = isMP4 ? 'video/mp4' : 'video/webm';
                const ext = isMP4 ? 'mp4' : 'webm';
                const blob = new Blob(recordedChunksRef.current, { type: blobType });
                const reader = new FileReader();
                reader.onloadend = async () => {
                    const base64Data = (reader.result as string).split(',')[1];
                    const safeTitle = trackTitle.replace(/[\s\\/:*?"<>|]+/g, '_');
                    const filename = `${safeTitle}_${preset.id}.${ext}`;
                    try {
                        const savedPath = await native.saveExportedVideo(base64Data, filename);
                        const sizeMB = (blob.size / 1048576).toFixed(1);
                        const hasAudio = audioTrack ? ' 🎵音声あり' : '';
                        if (savedPath) {
                            setExportMessage(`保存完了${hasAudio}\n${ext.toUpperCase()} ${preset.width}×${preset.height} / ${sizeMB} MB\n${savedPath}`);
                        } else {
                            setExportMessage(`エクスポート完了${hasAudio} — ${ext.toUpperCase()} ${sizeMB} MB`);
                        }
                    } catch {
                        setExportMessage('エクスポート完了');
                    }
                    setTimeout(() => { setExportMessage(null); setExportProgress(0); }, 8000);
                };
                reader.readAsDataURL(blob);
            };

            recorder.start(100);
            mediaRecorderRef.current = recorder;
            setIsRecordingVideo(true);
            setRecordingSec(0);

            // セッション再生 ＋ 音声ソース再生（同期）
            await native.startSessionPlayback();
            audioSource?.start(0);

            let elapsed = 0;
            recordingTimerRef.current = window.setInterval(() => {
                elapsed += 1;
                setRecordingSec(elapsed);
                setExportProgress(Math.min(99, Math.round((elapsed / Math.max(1, totalDurationSec)) * 100)));
                if (elapsed >= Math.ceil(totalDurationSec)) stopVideoExport();
            }, 1000);

        } catch (e) {
            copyActive = false;
            console.error('MV export failed:', e);
            setExportMessage('エクスポートに失敗しました');
            setTimeout(() => { setExportMessage(null); setExportProgress(0); }, 3000);
        }
    };

    const stopVideoExport = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    // アニメーション用 Ref
    const animFrameRef = useRef<number>(0);
    const timeRef = useRef<number>(0);
    const pulseRef = useRef<number>(0);
    const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; size: number; alpha: number; hue: number }>>([]);
    const hitSparksRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string }>>([]);
    const liveShootingNotesRef = useRef<Array<{ midi: number; z: number; speed: number; color: string }>>([]);
    const prevPressedNotesRef = useRef<number[]>([]);

    // パーティクルの初期化
    useEffect(() => {
        const parts = [];
        for (let i = 0; i < 60; i++) {
            parts.push({
                x: Math.random(),
                y: Math.random(),
                vx: (Math.random() - 0.5) * 0.002,
                vy: -Math.random() * 0.003 - 0.001,
                size: Math.random() * 3 + 1,
                alpha: Math.random() * 0.7 + 0.3,
                hue: Math.random() * 60 + 260, // パープル〜ピンク系
            });
        }
        particlesRef.current = parts;
    }, []);

    // 60FPS レンダリングループ
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let active = true;

        const render = () => {
            if (!active) return;
            timeRef.current += 0.016;

            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;

            if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
                canvas.width = width * dpr;
                canvas.height = height * dpr;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // 再生位置と現在の音圧・ピッチの取得
            const isPlaying = Boolean(status?.isPlaying || status?.isSessionPlaying || synth?.playing);
            const isRecording = Boolean(status?.isRecording);
            const curPlaybackSec = status?.isSessionPlaying
                ? (status?.sessionPosition || 0)
                : status?.isPlaying
                    ? (status?.playbackPosition || 0)
                    : 0;

            const playhead = status?.duration && status.playbackPosition
                ? status.playbackPosition / status.duration
                : (isPlaying ? (timeRef.current * 0.2) % 1 : 0);

            // 全トラック＆解析＆シーケンサーからノートを収集（再生中のみ表示）
            const allNotes: DisplayNote[] = [];
            const notePalette = ['#ff4757', '#ff6b81', '#70a1ff', '#2ed573', '#eccc68', '#a55eea', '#ffa502'];

            if (isPlaying) {
                if (session?.tracks) {
                    session.tracks.forEach((tr, trIdx) => {
                        tr.clips.forEach((cl) => {
                            if (cl.notes) {
                                cl.notes.forEach((n, nIdx) => {
                                    allNotes.push({
                                        midi: n.midi,
                                        start: cl.start + n.start,
                                        end: cl.start + n.end,
                                        color: notePalette[(trIdx * 3 + nIdx) % notePalette.length],
                                    });
                                });
                            }
                        });
                    });
                }

                if (allNotes.length === 0 && analysis?.notes) {
                    analysis.notes.forEach((n, idx) => {
                        allNotes.push({
                            midi: n.midi,
                            start: n.start,
                            end: n.end,
                            color: notePalette[idx % notePalette.length],
                        });
                    });
                }
            }

            // 現在再生位置でのピッチ・アタックを抽出
            let currentPitch = 0;
            if (analysis?.pitch && analysis.pitchTimes && analysis.duration > 0) {
                const curSec = (status?.playbackPosition || 0);
                const pIdx = analysis.pitchTimes.findIndex((t) => t >= curSec);
                if (pIdx >= 0) currentPitch = analysis.pitch[pIdx] || 0;
            }
            if (currentPitch === 0 && synth?.basePitch) {
                currentPitch = synth.basePitch;
            }

            // リアルタイム生演奏（録音していなくても鍵盤を押した瞬間に反応）
            const currentPressed = status?.pressedNotes || [];
            const prevPressed = prevPressedNotesRef.current;
            currentPressed.forEach((note) => {
                if (prevPressed.indexOf(note) === -1) {
                    // 新規打鍵！奥へ向かって射出するノートを生成
                    const color = notePalette[(note % 12) % notePalette.length];
                    liveShootingNotesRef.current.push({
                        midi: note,
                        z: 0.0, // 手前(z=0)から奥(z=1)へ
                        speed: 0.025,
                        color: color,
                    });
                }
            });
            prevPressedNotesRef.current = currentPressed;

            // MIDI 打鍵または録音によるパルス
            const hasActiveKeys = currentPressed.length > 0 || isRecording;
            if (hasActiveKeys || isRecording) {
                pulseRef.current = Math.min(1.0, pulseRef.current + 0.3);
            } else {
                pulseRef.current *= 0.92;
            }

            if (mode === 'waveform') {
                //==============================================================
                // 📊 波形解析プロモード
                //==============================================================
                drawStandardWaveform(ctx, analysis, width, height, playhead, status);
            } else {
                //==============================================================
                // 🎬 エモい MV モード（3D MIDI ノートフォール & リアルタイム生演奏）
                //==============================================================
                if (theme === 'cyber') {
                    drawCyberTheme(ctx, width, height, timeRef.current, pulseRef.current, currentPitch, analysis, allNotes, curPlaybackSec, isPlaying, playhead, trackTitle, hitSparksRef.current, liveShootingNotesRef.current, currentPressed, status, visualStyle);
                } else if (theme === 'lofi') {
                    drawLofiTheme(ctx, width, height, timeRef.current, pulseRef.current, particlesRef.current, allNotes, curPlaybackSec, currentPitch, isPlaying, trackTitle);
                } else if (theme === 'aura') {
                    drawAuraTheme(ctx, width, height, timeRef.current, pulseRef.current, currentPitch, allNotes, curPlaybackSec, analysis, isPlaying, playhead, trackTitle);
                } else {
                    drawMinimalTheme(ctx, width, height, timeRef.current, pulseRef.current, currentPitch, allNotes, curPlaybackSec, analysis, isPlaying, trackTitle);
                }
            }

            animFrameRef.current = requestAnimationFrame(render);
        };

        animFrameRef.current = requestAnimationFrame(render);

        return () => {
            active = false;
            cancelAnimationFrame(animFrameRef.current);
        };
    }, [mode, theme, analysis, status, synth, trackTitle, isCustomMv]);

    // ⚡️ オーディオリアクティブ・シグナルのリアルタイム生成
    const bpm = synth?.bpm ?? 120;

    // ⚡️ 実測 FFT スペクトラム由来のオーディオシグナル（ネイティブ getTrackSpectrum ポーリング）
    // 歌詞タブで選択した解析対象トラックへ実接続（空配列時はトラック 0 扱い）
    // 歌詞データが存在すれば 50音 → viseme を C++ 結果より優先適用
    const signals = useMvAudioSignals({
        status,
        bpm,
        trackIndices: selectedVocalTracks,
        lyrics: mvConfig?.lyrics,
    });


    return (
        <div style={{ flex: 1, margin: '10px 12px 0 12px', position: 'relative', minHeight: 140, borderRadius: 10, overflow: 'hidden', border: '1px solid #232733', boxShadow: 'inset 0 0 20px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column' }}>
            {/* 🤖 AI 動的 SVG サンドボックス または 🎨 クラシック Canvas */}
            <div style={{ flex: 1, position: 'relative', width: '100%', minHeight: 100 }}>
                {mode === 'mv' && isCustomMv ? (
                    <div ref={sandboxHostRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
                        <AudioReactiveSandbox
                            scenes={mvConfig.scenes}
                            lyrics={mvConfig.lyrics}
                            globalCss={mvConfig.globalCss}
                            signals={signals}
                            assets={mvConfig.assets}
                            lyricStyle={mvConfig.lyricStyle}
                        />
                    </div>
                ) : (
                    <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                )}

                {/* 🎤 Voice to MIDI 抽出ノートオーバーレイ描画 */}
                {mode === 'waveform' && (
                    <>
                        <VoiceToMidiOverlay
                            notes={extractedV2MNotes}
                            totalDurationSec={analysis?.duration || 1.0}
                            width={canvasRef.current?.clientWidth || 800}
                            height={canvasRef.current?.clientHeight || 200}
                        />
                        {/* 🏷️ 対象クリップバッジ（インダストリアル機材風表示） */}
                        <div
                            style={{
                                position: 'absolute',
                                top: 8,
                                left: 10,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                background: 'rgba(13, 16, 23, 0.82)',
                                backdropFilter: 'blur(6px)',
                                border: '1px solid #2a3445',
                                borderRadius: 5,
                                padding: '3px 8px',
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#00f2fe',
                                letterSpacing: '0.04em',
                                pointerEvents: 'none',
                                userSelect: 'none',
                                zIndex: 12,
                            }}
                        >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00f2fe', boxShadow: '0 0 6px #00f2fe' }} />
                            <span>{activeClipLabel || '全体録音テイク'}</span>
                        </div>
                    </>
                )}
            </div>

            {/* 🎛️ Voice to MIDI 専用コントロールバー（波形解析モード時） */}
            {mode === 'waveform' && (
                <VoiceToMidiControls
                    settings={v2mSettings}
                    onChangeSettings={setV2mSettings}
                    extractedCount={extractedV2MNotes.length}
                    isInserting={isInsertingV2M}
                    onInsertToTimeline={handleInsertV2MToTimeline}
                    onClearNotes={() => setV2mSettings({ ...v2mSettings })}
                    selectedTrackName={
                        session?.tracks.find((t) => t.armed)?.name ||
                        session?.tracks[0]?.name ||
                        'Track 1'
                    }
                />
            )}

            {/* MV コントロールバー（右上オーバーレイ：テーマ・演出・エクスポート） */}
            {/* ※ シーン編集は MV ワークスペース（MvWorkspace）に一本化されたため、
                ここでは表示のみを行い、編集はワークスペース側で行う */}
            <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(15, 17, 21, 0.75)', backdropFilter: 'blur(8px)', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }}>
                {/* 🎨 演出スタイル切替（クラシック CYBER テーマ時のみ表示） */}
                {mode === 'mv' && !isCustomMv && theme === 'cyber' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(15, 18, 26, 0.85)', border: '1px solid #283344', borderRadius: 6, padding: '2px 4px' }}>
                        <span style={{ fontSize: 10, color: '#747d8c', padding: '0 4px', fontWeight: 700 }}>演出:</span>
                        <button
                            onClick={() => setVisualStyle('spectrum')}
                            title="ネオン・スペクトラムバー"
                            style={{
                                background: visualStyle === 'spectrum' ? '#2f3542' : 'transparent',
                                color: visualStyle === 'spectrum' ? '#70a1ff' : '#747d8c',
                                border: visualStyle === 'spectrum' ? '1px solid #4d7cff' : '1px solid transparent',
                                borderRadius: 4,
                                padding: '3px 6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 10,
                                fontWeight: 700,
                            }}
                        >
                            <IconSpectrum size={12} color={visualStyle === 'spectrum' ? '#70a1ff' : '#747d8c'} />
                            <span>バー</span>
                        </button>
                        <button
                            onClick={() => setVisualStyle('ring')}
                            title="サイバー・オーディオリング"
                            style={{
                                background: visualStyle === 'ring' ? '#2f3542' : 'transparent',
                                color: visualStyle === 'ring' ? '#70a1ff' : '#747d8c',
                                border: visualStyle === 'ring' ? '1px solid #4d7cff' : '1px solid transparent',
                                borderRadius: 4,
                                padding: '3px 6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 10,
                                fontWeight: 700,
                            }}
                        >
                            <IconCircleWave size={12} color={visualStyle === 'ring' ? '#70a1ff' : '#747d8c'} />
                            <span>リング</span>
                        </button>
                        <button
                            onClick={() => setVisualStyle('wave')}
                            title="レーザーリボン波形"
                            style={{
                                background: visualStyle === 'wave' ? '#2f3542' : 'transparent',
                                color: visualStyle === 'wave' ? '#70a1ff' : '#747d8c',
                                border: visualStyle === 'wave' ? '1px solid #4d7cff' : '1px solid transparent',
                                borderRadius: 4,
                                padding: '3px 6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 10,
                                fontWeight: 700,
                            }}
                        >
                            <IconLaserWave size={12} color={visualStyle === 'wave' ? '#70a1ff' : '#747d8c'} />
                            <span>波形</span>
                        </button>
                        <button
                            onClick={() => setVisualStyle('warp')}
                            title="シンセウェーブ・ワープグリッド"
                            style={{
                                background: visualStyle === 'warp' ? '#2f3542' : 'transparent',
                                color: visualStyle === 'warp' ? '#70a1ff' : '#747d8c',
                                border: visualStyle === 'warp' ? '1px solid #4d7cff' : '1px solid transparent',
                                borderRadius: 4,
                                padding: '3px 6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 10,
                                fontWeight: 700,
                            }}
                        >
                            <IconWarpGrid size={12} color={visualStyle === 'warp' ? '#70a1ff' : '#747d8c'} />
                            <span>ワープ</span>
                        </button>
                        <button
                            onClick={() => setVisualStyle('off')}
                            title="演出 OFF"
                            style={{
                                background: visualStyle === 'off' ? 'rgba(255, 71, 87, 0.2)' : 'transparent',
                                color: visualStyle === 'off' ? '#ff6b81' : '#747d8c',
                                border: visualStyle === 'off' ? '1px solid #ff4757' : '1px solid transparent',
                                borderRadius: 4,
                                padding: '3px 6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 10,
                                fontWeight: 700,
                            }}
                        >
                            <IconEyeOff size={12} color={visualStyle === 'off' ? '#ff6b81' : '#747d8c'} />
                            <span>OFF</span>
                        </button>
                    </div>
                )}

                {/* AI 動的 MV サンドボックス（サイケデリック幾何学・ミニマルグリッチ・サイバーパンク） & エディタ */}
                {mode === 'mv' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                            onClick={() => setIsCustomMv((v) => !v)}
                            style={{
                                background: isCustomMv ? 'rgba(168, 85, 247, 0.22)' : 'transparent',
                                color: isCustomMv ? '#c084fc' : '#8395a7',
                                border: isCustomMv ? '1px solid #a855f7' : '1px solid #2d3748',
                                borderRadius: 5,
                                padding: '3px 8px',
                                fontSize: 10.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                            }}
                            title="AI 動的 SVG サンドボックス MV モードの ON/OFF"
                        >
                            <IconSparkles size={12} color={isCustomMv ? '#c084fc' : '#8395a7'} />
                            <span>AI サンドボックス: {isCustomMv ? 'ON' : 'OFF'}</span>
                        </button>

                        <span
                            style={{
                                background: '#1e293b',
                                color: '#38bdf8',
                                border: '1px solid #0284c7',
                                borderRadius: 5,
                                padding: '4px 9px',
                                fontSize: 10,
                                fontWeight: 800,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                            }}
                            title="シーン編集は MV ワークスペース（MVモードタブ）で行ってください"
                        >
                            <IconSliders size={12} color="#38bdf8" />
                            <span>編集は MV ワークスペースへ</span>
                        </span>
                    </div>
                )}

                {/* テーマ切替（クラシック MV モード時のみ） */}
                {mode === 'mv' && !isCustomMv && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 10, color: '#888', marginLeft: 4 }}>テーマ:</span>
                        {(['cyber', 'lofi', 'aura', 'minimal'] as MVTheme[]).map((t) => (
                            <button
                                key={t}
                                onClick={() => setTheme(t)}
                                style={{
                                    background: theme === t ? '#3d4758' : 'transparent',
                                    color: theme === t ? '#70a1ff' : '#aaa',
                                    border: theme === t ? '1px solid #5352ed' : '1px solid transparent',
                                    borderRadius: 4,
                                    padding: '3px 7px',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    textTransform: 'uppercase',
                                }}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                )}

                {/* 🎥 MV 動画エクスポートボタン */}
                {mode === 'mv' && (
                    <button
                        onClick={() => {
                            if (isRecordingVideo) {
                                stopVideoExport();
                            } else {
                                setExportEndSec(Math.ceil(session?.duration || 16));
                                setShowExportModal(true);
                            }
                        }}
                        style={{
                            background: isRecordingVideo
                                ? 'linear-gradient(135deg, #ff4757, #ff6b81)'
                                : 'linear-gradient(135deg, #6c5ce7, #a29bfe)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '4px 10px',
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            boxShadow: isRecordingVideo ? '0 0 12px rgba(255, 71, 87, 0.7)' : 'none',
                        }}
                        title={isRecordingVideo ? '録画を停止して動画を保存' : '範囲指定エクスポート'}
                    >
                        {isRecordingVideo ? <IconStop size={11} color="#fff" /> : <IconDownload size={12} color="#fff" />}
                        <span>{isRecordingVideo ? '録画停止 & 保存' : 'MVエクスポート'}</span>
                        {isRecordingVideo && (
                            <span style={{ fontSize: 10, background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 4 }}>
                                {formatTime(recordingSec)}
                            </span>
                        )}
                    </button>
                )}
            </div>

            {/* エクスポート設定モーダル */}
            {showExportModal && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0, 0, 0, 0.82)',
                        backdropFilter: 'blur(10px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 9999,
                    }}
                    onClick={(e) => { if (e.target === e.currentTarget) setShowExportModal(false); }}
                >
                    <div
                        style={{
                            background: '#111622',
                            border: '1px solid #2a3650',
                            borderRadius: 14,
                            padding: '22px 26px',
                            width: 'min(520px, 96vw)',
                            maxHeight: '90vh',
                            overflowY: 'auto',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.9)',
                            color: '#f1f2f6',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 20,
                        }}
                    >
                        {/* ヘッダー */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                <div style={{ background: 'rgba(108, 92, 231, 0.2)', padding: 8, borderRadius: 8 }}>
                                    <IconVideo size={18} color="#a29bfe" />
                                </div>
                                <div>
                                    <div style={{ fontSize: 15, fontWeight: 900, color: '#f1f2f6' }}>MV 動画エクスポート</div>
                                    <div style={{ fontSize: 10.5, color: '#8395a7', marginTop: 2 }}>プラットフォームに合わせた設定で書き出し</div>
                                </div>
                            </div>
                            <button onClick={() => setShowExportModal(false)} style={{ background: 'none', border: 'none', color: '#636e72', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
                        </div>

                        {/* 解像度プリセット */}
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: '#a29bfe', letterSpacing: '0.5px', marginBottom: 10 }}>解像度 / プラットフォーム</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                {RESOLUTION_PRESETS.map((preset) => (
                                    <button
                                        key={preset.id}
                                        onClick={() => setSelectedResolution(preset.id)}
                                        style={{
                                            background: selectedResolution === preset.id ? 'rgba(108, 92, 231, 0.18)' : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${selectedResolution === preset.id ? '#a29bfe' : '#2a3650'}`,
                                            borderRadius: 8,
                                            padding: '10px 12px',
                                            color: '#f1f2f6',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            transition: 'all 0.12s ease',
                                        }}
                                    >
                                        <div style={{ fontSize: 11.5, fontWeight: 900, color: selectedResolution === preset.id ? '#a29bfe' : '#c5ceff' }}>{preset.label}</div>
                                        <div style={{ fontSize: 10, color: '#6c7a8a', marginTop: 2 }}>{preset.subLabel}</div>
                                        <div style={{ fontSize: 9.5, color: selectedResolution === preset.id ? '#8c7ae6' : '#4a5568', marginTop: 3, fontWeight: 700 }}>{preset.platform}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ビットレート */}
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: '#a29bfe', letterSpacing: '0.5px', marginBottom: 10 }}>画質 / ビットレート</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {BITRATE_PRESETS.map((bp) => (
                                    <button
                                        key={bp.id}
                                        onClick={() => setSelectedBitrate(bp.id)}
                                        style={{
                                            flex: 1,
                                            background: selectedBitrate === bp.id ? 'rgba(108, 92, 231, 0.18)' : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${selectedBitrate === bp.id ? '#a29bfe' : '#2a3650'}`,
                                            borderRadius: 8,
                                            padding: '9px 10px',
                                            color: '#f1f2f6',
                                            cursor: 'pointer',
                                            textAlign: 'center',
                                            transition: 'all 0.12s ease',
                                        }}
                                    >
                                        <div style={{ fontSize: 12, fontWeight: 900, color: selectedBitrate === bp.id ? '#a29bfe' : '#c5ceff' }}>{bp.label}</div>
                                        <div style={{ fontSize: 10, color: '#6c7a8a', marginTop: 2 }}>{bp.subLabel}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 書き出し範囲 */}
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: '#a29bfe', letterSpacing: '0.5px', marginBottom: 10 }}>書き出し範囲</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {(['all', 'custom'] as const).map((v) => (
                                    <button
                                        key={v}
                                        onClick={() => setExportRangeType(v)}
                                        style={{
                                            flex: 1,
                                            background: exportRangeType === v ? 'rgba(108, 92, 231, 0.18)' : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${exportRangeType === v ? '#a29bfe' : '#2a3650'}`,
                                            borderRadius: 8,
                                            padding: '9px 12px',
                                            color: exportRangeType === v ? '#a29bfe' : '#8395a7',
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            fontWeight: 800,
                                            transition: 'all 0.12s ease',
                                        }}
                                    >
                                        {v === 'all' ? `全体 (${formatTime(session?.duration || 0)})` : '範囲指定'}
                                    </button>
                                ))}
                            </div>
                            {exportRangeType === 'custom' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, background: '#0a0d14', padding: '10px 12px', borderRadius: 8, border: '1px solid #1e2a3a' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 9.5, color: '#6c7a8a', marginBottom: 4 }}>開始 (秒)</div>
                                        <input type="number" min={0} value={exportStartSec} onChange={(e) => setExportStartSec(Number(e.target.value))}
                                            style={{ width: '100%', background: '#161b26', color: '#fff', border: '1px solid #364156', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontWeight: 700, boxSizing: 'border-box' }} />
                                    </div>
                                    <span style={{ color: '#4a5568', paddingTop: 16 }}>—</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 9.5, color: '#6c7a8a', marginBottom: 4 }}>終了 (秒)</div>
                                        <input type="number" min={exportStartSec + 1} value={exportEndSec} onChange={(e) => setExportEndSec(Number(e.target.value))}
                                            style={{ width: '100%', background: '#161b26', color: '#fff', border: '1px solid #364156', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontWeight: 700, boxSizing: 'border-box' }} />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* フォーマット表示（自動判定） */}
                        <div style={{ background: '#0a0e18', border: '1px solid #1e2a3a', borderRadius: 8, padding: '10px 14px', fontSize: 10.5, color: '#6c7a8a' }}>
                            <span style={{ color: '#a29bfe', fontWeight: 800 }}>出力フォーマット:</span>{'  '}
                            {MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') || MediaRecorder.isTypeSupported('video/mp4')
                                ? <span style={{ color: '#2ecc71', fontWeight: 700 }}>MP4 (H.264)</span>
                                : <span style={{ color: '#f39c12', fontWeight: 700 }}>WebM (VP9) — お使いの環境はMP4非対応</span>
                            }
                        </div>

                        {/* アクション */}
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                            <button onClick={() => setShowExportModal(false)}
                                style={{ background: 'rgba(255,255,255,0.05)', color: '#8395a7', border: '1px solid #2a3650', borderRadius: 8, padding: '9px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                キャンセル
                            </button>
                            <button onClick={executeVideoExport}
                                style={{ background: 'linear-gradient(135deg, #6c5ce7, #a29bfe)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontSize: 12, fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 4px 16px rgba(108,92,231,0.4)' }}>
                                <IconDownload size={13} color="#fff" />
                                <span>録画してエクスポート</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* エクスポート進行中プログレスバー & 完了トースト */}
            {isRecordingVideo && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(0,0,0,0.5)', zIndex: 200 }}>
                    <div style={{ height: '100%', width: `${exportProgress}%`, background: 'linear-gradient(90deg, #a29bfe, #6c5ce7)', transition: 'width 0.9s ease', borderRadius: '0 2px 2px 0' }} />
                </div>
            )}
            {exportMessage && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: 16,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(10, 12, 20, 0.97)',
                        border: '1px solid #a29bfe',
                        color: '#ffffff',
                        padding: '10px 18px',
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 800,
                        boxShadow: '0 6px 20px rgba(0,0,0,0.7), 0 0 20px rgba(108,92,231,0.3)',
                        zIndex: 110,
                        whiteSpace: 'pre-line',
                        textAlign: 'center',
                        maxWidth: '80%',
                        wordBreak: 'break-all',
                        lineHeight: 1.6,
                    }}
                >
                    {exportMessage}
                </div>
            )}

            {/* タイトル編集（左上オーバーレイ） */}
            {mode === 'mv' && (
                <div style={{ position: 'absolute', top: 12, left: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isEditingTitle ? (
                        <input
                            type="text"
                            value={trackTitle}
                            onChange={(e) => setTrackTitle(e.target.value)}
                            onBlur={() => setIsEditingTitle(false)}
                            onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
                            autoFocus
                            style={{
                                background: 'rgba(0,0,0,0.6)',
                                color: '#fff',
                                border: '1px solid #70a1ff',
                                borderRadius: 4,
                                padding: '2px 8px',
                                fontSize: 12,
                                fontWeight: 700,
                                outline: 'none',
                            }}
                        />
                    ) : (
                        <div
                            onClick={() => setIsEditingTitle(true)}
                            style={{
                                color: 'rgba(255,255,255,0.7)',
                                fontSize: 11,
                                fontWeight: 700,
                                letterSpacing: 1.5,
                                textTransform: 'uppercase',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                background: 'rgba(0,0,0,0.3)',
                                padding: '3px 8px',
                                borderRadius: 4,
                            }}
                            title="クリックしてタイトルを変更"
                        >
                            <IconSparkles size={11} color="#ff9f43" />
                            {trackTitle}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

//------------------------------------------------------------------------------
// ① Cyber Neon テーマ (Cyberpunk / 80s Synthwave + 3D MIDI ノートフォール)
//------------------------------------------------------------------------------
function drawCyberTheme(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    time: number,
    pulse: number,
    pitch: number,
    analysis: Analysis | null,
    notes: DisplayNote[],
    playbackSec: number,
    isPlaying: boolean | undefined,
    playhead: number,
    title: string,
    sparks: Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string }>,
    shootingNotes: Array<{ midi: number; z: number; speed: number; color: string }>,
    pressedKeys: number[],
    status: Status | null,
    visualStyle: VisualStyle = 'spectrum',
) {
    // 背景グラデーション
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0a0512');
    bgGrad.addColorStop(1, '#050308');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 消失点・地平線
    const horizonY = h * 0.55;
    const vpX = w * 0.5;

    // ネオンサン（中央の巨大なレトロサン）
    const sunRadius = Math.min(w, h) * 0.24 + pulse * 12;
    const sunGrad = ctx.createLinearGradient(vpX, horizonY - sunRadius, vpX, horizonY);
    sunGrad.addColorStop(0, '#ff9f43');
    sunGrad.addColorStop(0.5, '#ff4757');
    sunGrad.addColorStop(1, '#5352ed');

    ctx.save();
    ctx.beginPath();
    ctx.arc(vpX, horizonY, sunRadius, Math.PI, 0, false);
    ctx.fillStyle = sunGrad;
    ctx.shadowColor = '#ff4757';
    ctx.shadowBlur = 25 + pulse * 30;
    ctx.fill();
    ctx.restore();

    // サンのブラインドストライプ（80s スタイル）
    ctx.fillStyle = '#0a0512';
    for (let y = horizonY - sunRadius * 0.8; y < horizonY; y += 7) {
        const sliceH = ((y - (horizonY - sunRadius)) / sunRadius) * 3 + 1;
        ctx.fillRect(vpX - sunRadius, y, sunRadius * 2, sliceH);
    }

    // 3D ネオングリッド床
    ctx.save();
    ctx.strokeStyle = `rgba(112, 161, 255, ${0.35 + pulse * 0.35})`;
    ctx.lineWidth = 1;
    ctx.shadowColor = '#5352ed';
    ctx.shadowBlur = 10 + pulse * 15;

    // レーン放射線（音階グリッド）
    const numLanes = 24;
    for (let l = -numLanes / 2; l <= numLanes / 2; l++) {
        const xBottom = vpX + l * (w / 14) * 1.6;
        ctx.beginPath();
        ctx.moveTo(vpX, horizonY);
        ctx.lineTo(xBottom, h);
        ctx.stroke();
    }

    // 横ライン（スクロールアニメーション）
    const speed = (time * (isPlaying ? 140 : 40)) % 40;
    for (let d = 0; d < h - horizonY; d += 14) {
        const yPos = horizonY + Math.pow((d + speed) / (h - horizonY + 40), 2) * (h - horizonY);
        if (yPos <= h) {
            ctx.beginPath();
            ctx.moveTo(0, yPos);
            ctx.lineTo(w, yPos);
            ctx.stroke();
        }
    }
    ctx.restore();

    // 手前のネオンヒットバー（判定ライン）
    const hitLineY = h * 0.94;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 15 + pulse * 20;
    ctx.beginPath();
    ctx.moveTo(w * 0.05, hitLineY);
    ctx.lineTo(w * 0.95, hitLineY);
    ctx.stroke();
    ctx.restore();

    // 音階レンジ定義（画面内に綺麗に収まるよう 45(A2)〜84(C6)）
    const lookAheadSec = 2.8;
    const minMidi = 45;
    const maxMidi = 84;
    const midiSpan = maxMidi - minMidi;

    // ヘルパー：MIDI ノートから画面 X 座標を計算（画面幅の安全マージン 82% に配置して見切れ防止）
    const getXForMidi = (midi: number, z: number) => {
        const noteRatio = stdClamp((midi - minMidi) / midiSpan, 0.05, 0.95);
        const laneOffset = (noteRatio - 0.5) * 2; // -1..1
        return vpX + laneOffset * (w * 0.38) * (1 + (1 - z) * 1.15);
    };

    //==========================================================================
    // 🎹 3D 流れる MIDI ノート（奥から手前へフォール）
    //==========================================================================
    ctx.save();
    for (const n of notes) {
        const dtStart = n.start - playbackSec;
        const dtEnd = n.end - playbackSec;

        if (dtEnd >= -0.2 && dtStart <= lookAheadSec) {
            const zFront = Math.max(0, dtStart / lookAheadSec);
            const zBack = Math.min(1.0, Math.max(0, dtEnd / lookAheadSec));

            const yFront = hitLineY - (1 - Math.pow(1 - zFront, 2)) * (hitLineY - horizonY);
            const yBack = hitLineY - (1 - Math.pow(1 - zBack, 2)) * (hitLineY - horizonY);

            const xFront = getXForMidi(n.midi, zFront);
            const xBack = getXForMidi(n.midi, zBack);

            const widthFront = Math.max(8, (w / 34) * (1 + (1 - zFront) * 1.2));
            const widthBack = Math.max(4, (w / 34) * (1 + (1 - zBack) * 1.2));

            const color = n.color || '#ff4757';
            const isHit = dtStart <= 0.05 && dtEnd >= -0.05;

            // 3D 台形ブロックを描画
            ctx.beginPath();
            ctx.moveTo(xBack - widthBack / 2, yBack);
            ctx.lineTo(xBack + widthBack / 2, yBack);
            ctx.lineTo(xFront + widthFront / 2, yFront);
            ctx.lineTo(xFront - widthFront / 2, yFront);
            ctx.closePath();

            const blockGrad = ctx.createLinearGradient(0, yBack, 0, yFront);
            blockGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
            blockGrad.addColorStop(0.3, color);
            blockGrad.addColorStop(1, isHit ? '#ffffff' : color);

            ctx.fillStyle = blockGrad;
            ctx.shadowColor = color;
            ctx.shadowBlur = isHit ? 25 : 12;
            ctx.fill();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = isHit ? 2.5 : 1;
            ctx.stroke();

            if (isHit && Math.random() < 0.3) {
                sparks.push({
                    x: xFront,
                    y: hitLineY,
                    vx: (Math.random() - 0.5) * 6,
                    vy: -Math.random() * 5 - 2,
                    life: 1.0,
                    color: color,
                });
            }

            if (zFront < 0.35 && yFront > horizonY + 20) {
                ctx.save();
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${Math.max(9, Math.round(13 * (1 - zFront)))}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.shadowColor = color;
                ctx.shadowBlur = 8;
                ctx.fillText(noteName(n.midi), xFront, yFront - 4);
                ctx.restore();
            }
        }
    }
    ctx.restore();

    //==========================================================================
    // ⚡️ 生演奏（録音なしで弾いた時）のリアルタイム演出！
    //==========================================================================
    ctx.save();
    // 1. 現在押されているキーの位置から天・奥へ伸びるネオンレーザービーム
    for (const note of pressedKeys) {
        const xPos = getXForMidi(note, 0.0);
        const color = '#00f2fe';

        // 垂直・斜め奥へ突き抜ける光の柱
        const beamGrad = ctx.createLinearGradient(xPos, hitLineY, vpX, horizonY);
        beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        beamGrad.addColorStop(0.3, 'rgba(0, 242, 254, 0.7)');
        beamGrad.addColorStop(1, 'rgba(255, 71, 87, 0.0)');

        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(xPos - 12, hitLineY);
        ctx.lineTo(xPos + 12, hitLineY);
        ctx.lineTo(vpX + 4, horizonY);
        ctx.lineTo(vpX - 4, horizonY);
        ctx.closePath();
        ctx.fill();

        // 手前ヒットライン上の白熱光球
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(xPos, hitLineY, 10, 0, Math.PI * 2);
        ctx.fill();

        // 弾いた音名表示
        ctx.font = '900 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 15;
        ctx.fillText(noteName(note), xPos, hitLineY - 16);

        // 継続スパーク
        if (Math.random() < 0.4) {
            sparks.push({
                x: xPos,
                y: hitLineY,
                vx: (Math.random() - 0.5) * 8,
                vy: -Math.random() * 6 - 3,
                life: 1.0,
                color: '#00f2fe',
            });
        }
    }

    // 2. 弾いた瞬間に奥へ飛んでいく光のブロック（Live Shooting Notes）
    for (let i = shootingNotes.length - 1; i >= 0; i--) {
        const sn = shootingNotes[i];
        sn.z += sn.speed;
        if (sn.z >= 1.0) {
            shootingNotes.splice(i, 1);
            continue;
        }

        const yPos = hitLineY - (1 - Math.pow(1 - sn.z, 2)) * (hitLineY - horizonY);
        const xPos = getXForMidi(sn.midi, sn.z);
        const width = Math.max(6, (w / 34) * (1 + (1 - sn.z) * 1.2));
        const height = Math.max(4, 18 * (1 - sn.z));

        ctx.fillStyle = sn.color;
        ctx.shadowColor = sn.color;
        ctx.shadowBlur = 20 * (1 - sn.z * 0.5);
        ctx.beginPath();
        ctx.roundRect(xPos - width / 2, yPos - height / 2, width, height, 4);
        ctx.fill();
    }
    ctx.restore();

    // ヒット時のスパーク・パーティクルを描画＆更新
    ctx.save();
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.2;
        s.life -= 0.04;
        if (s.life <= 0) {
            sparks.splice(i, 1);
            continue;
        }
        ctx.fillStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 10;
        ctx.globalAlpha = s.life;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.life * 4 + 1, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    //==========================================================================
    // 🎨 多彩なオーディオリアクティブ演出（モード切替）
    //==========================================================================
    if (visualStyle === 'spectrum') {
        // 📊 ネオン・スペクトラムバー（地平線から跳ねるマルチカラーイコライザー）
        const peaks = analysis?.peaks || [];
        const barCount = 32;
        const barWidth = Math.max(4, (w * 0.7) / barCount);
        const startX = (w - barCount * barWidth) / 2;

        ctx.save();
        for (let i = 0; i < barCount; i++) {
            const pIdx = Math.floor((i / barCount) * peaks.length);
            const peakAmp = peaks[pIdx] ? Math.max(Math.abs(peaks[pIdx][0]), Math.abs(peaks[pIdx][1])) : 0.05;
            const barH = Math.max(4, peakAmp * (h * 0.45) * (1 + pulse * 0.6) + Math.sin(time * 6 + i * 0.3) * (isPlaying ? 4 : 1));
            const x = startX + i * barWidth + barWidth * 0.15;
            const y = horizonY - barH;

            const grad = ctx.createLinearGradient(0, horizonY, 0, y);
            grad.addColorStop(0, 'rgba(83, 82, 237, 0.3)');
            grad.addColorStop(0.5, '#70a1ff');
            grad.addColorStop(1, '#ff4757');

            ctx.fillStyle = grad;
            ctx.shadowColor = '#70a1ff';
            ctx.shadowBlur = 8;
            ctx.fillRect(x, y, barWidth * 0.7, barH);

            // バー頂点のネオンチップ
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x, y - 2, barWidth * 0.7, 2);
        }
        ctx.restore();
    } else if (visualStyle === 'ring') {
        // 🪐 サイバー・オーディオリング（太陽周囲の幾重ものパルスリング）
        ctx.save();
        const ringCount = 3;
        for (let r = 0; r < ringCount; r++) {
            const radius = sunRadius + 16 + r * 20 + pulse * (16 + r * 8);
            ctx.beginPath();
            ctx.arc(vpX, horizonY, radius, Math.PI, 0, false);
            ctx.strokeStyle = r === 0 ? '#ff6b81' : r === 1 ? '#70a1ff' : '#2ed573';
            ctx.lineWidth = 2.5 - r * 0.5;
            ctx.shadowColor = ctx.strokeStyle;
            ctx.shadowBlur = 15;
            ctx.stroke();
        }
        ctx.restore();
    } else if (visualStyle === 'wave') {
        // ⚡ RGBネオン・レーザーリボン波形（色鮮やかな色収差レーザー）
        if (analysis?.peaks && analysis.peaks.length > 0) {
            ctx.save();
            const peaks = analysis.peaks;
            const n = peaks.length;

            // マゼンタレイヤー
            ctx.lineWidth = 3 + pulse * 3;
            ctx.strokeStyle = '#ff4757';
            ctx.shadowColor = '#ff4757';
            ctx.shadowBlur = 16;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const amp = Math.max(Math.abs(peaks[i][0]), Math.abs(peaks[i][1]));
                const x = (i / n) * w;
                const y = horizonY - 12 - amp * (h * 0.35) * (1 + pulse * 0.5);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // シアン・ホワイトコア
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#00f2fe';
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const amp = Math.max(Math.abs(peaks[i][0]), Math.abs(peaks[i][1]));
                const x = (i / n) * w;
                const y = horizonY - 15 - amp * (h * 0.35) * (1 + pulse * 0.5);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.restore();
        }
    } else if (visualStyle === 'warp') {
        // 🌌 ワープグリッドパルス
        ctx.save();
        ctx.strokeStyle = `rgba(0, 242, 254, ${0.4 + pulse * 0.5})`;
        ctx.lineWidth = 2 + pulse * 2;
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(vpX, horizonY, sunRadius * 0.5 + pulse * 25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // 中央のタイポグラフィ
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.shadowColor = '#ff6b81';
    ctx.shadowBlur = 15 + pulse * 20;
    ctx.fillText(title, w / 2, horizonY - sunRadius - 15);
    ctx.restore();
}

//------------------------------------------------------------------------------
// ② Lo-Fi Stars & Chill テーマ (チルな宇宙・オーロラ・レコード粒子 + 流れるノート)
//------------------------------------------------------------------------------
function drawLofiTheme(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    time: number,
    pulse: number,
    particles: Array<{ x: number; y: number; vx: number; vy: number; size: number; alpha: number; hue: number }>,
    notes: DisplayNote[],
    playbackSec: number,
    pitch: number,
    isPlaying: boolean | undefined,
    title: string,
) {
    // 背景
    ctx.fillStyle = '#080a10';
    ctx.fillRect(0, 0, w, h);

    // 脈動するオーロラサークル
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.32 + pulse * 18 + Math.sin(time * 2) * 6;

    const auraGrad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
    auraGrad.addColorStop(0, 'rgba(255, 107, 157, 0.4)');
    auraGrad.addColorStop(0.6, 'rgba(112, 161, 255, 0.2)');
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 浮遊する星屑パーティクル
    for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < 0) p.y = 1;
        if (p.x < 0) p.x = 1;
        if (p.x > 1) p.x = 0;

        const px = p.x * w;
        const py = p.y * h;

        ctx.fillStyle = `hsla(${p.hue}, 80%, 75%, ${p.alpha * (0.6 + pulse * 0.4)})`;
        ctx.beginPath();
        ctx.arc(px, py, p.size + pulse * 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // 水平に流れるチルなメロディノート
    ctx.save();
    for (const n of notes) {
        const dt = n.start - playbackSec;
        if (dt >= -1.0 && dt <= 4.0) {
            const x = cx + dt * (w * 0.25);
            const y = cy + (n.midi - 60) * -4;
            const size = Math.max(6, (n.end - n.start) * 40);

            ctx.fillStyle = n.color || '#70a1ff';
            ctx.shadowColor = n.color || '#70a1ff';
            ctx.shadowBlur = 12;
            ctx.globalAlpha = Math.max(0.2, 1 - Math.abs(dt) / 3);

            ctx.beginPath();
            ctx.roundRect(x, y - 6, size, 12, 6);
            ctx.fill();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText(noteName(n.midi), x + 4, y + 3);
        }
    }
    ctx.restore();

    // レコード盤の針・スピンライン
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    for (let r = radius * 0.4; r <= radius; r += 16) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();

    // タイトル
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 20px "Courier New", Courier, monospace';
    ctx.shadowColor = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur = 10;
    ctx.fillText(title, cx, cy + 6);
    ctx.restore();
}

//------------------------------------------------------------------------------
// ③ Vocal Aura & Spectrum テーマ (円形イコライザー + 螺旋ノート)
//------------------------------------------------------------------------------
function drawAuraTheme(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    time: number,
    pulse: number,
    pitch: number,
    notes: DisplayNote[],
    playbackSec: number,
    analysis: Analysis | null,
    isPlaying: boolean | undefined,
    playhead: number,
    title: string,
) {
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const baseR = Math.min(w, h) * 0.28;

    // 円形スペクトラムバー
    const bars = 48;
    const peaks = analysis?.peaks || [];
    for (let i = 0; i < bars; i++) {
        const angle = (i / bars) * Math.PI * 2 + time * 0.4;
        const peakIdx = Math.floor((i / bars) * peaks.length);
        const amp = peaks[peakIdx] ? Math.max(Math.abs(peaks[peakIdx][0]), Math.abs(peaks[peakIdx][1])) : 0.1;
        const barLen = 10 + amp * (baseR * 0.9) + pulse * 20;

        const x1 = cx + Math.cos(angle) * baseR;
        const y1 = cy + Math.sin(angle) * baseR;
        const x2 = cx + Math.cos(angle) * (baseR + barLen);
        const y2 = cy + Math.sin(angle) * (baseR + barLen);

        ctx.strokeStyle = `hsl(${(i * 7 + time * 40) % 360}, 90%, 65%)`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // 螺旋状に外側から吸い込まれるノートオーラ
    ctx.save();
    for (const n of notes) {
        const dt = n.start - playbackSec;
        if (dt >= -0.5 && dt <= 3.0) {
            const progress = dt / 3.0;
            const r = baseR + progress * (w * 0.35);
            const angle = (n.midi % 12) * (Math.PI * 2 / 12) + time * 0.5;
            const nx = cx + Math.cos(angle) * r;
            const ny = cy + Math.sin(angle) * r;

            ctx.fillStyle = n.color || '#ff4757';
            ctx.shadowColor = n.color || '#ff4757';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(nx, ny, 6 + (1 - progress) * 6, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();

    // 中心サークル
    ctx.fillStyle = '#10141f';
    ctx.beginPath();
    ctx.arc(cx, cy, baseR - 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 16px -apple-system, sans-serif';
    ctx.fillText(title, cx, cy - 4);
    if (pitch > 0) {
        ctx.fillStyle = '#70a1ff';
        ctx.font = '600 11px sans-serif';
        ctx.fillText(`${Math.round(pitch)} Hz`, cx, cy + 16);
    }
    ctx.restore();
}

//------------------------------------------------------------------------------
// ④ Minimal Spectrum テーマ
//------------------------------------------------------------------------------
function drawMinimalTheme(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    time: number,
    pulse: number,
    pitch: number,
    notes: DisplayNote[],
    playbackSec: number,
    analysis: Analysis | null,
    isPlaying: boolean | undefined,
    title: string,
) {
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, w, h);

    // ミニマルな垂直スペクトラム
    const peaks = analysis?.peaks || [];
    const count = Math.min(80, Math.floor(w / 8));
    const step = w / count;

    for (let i = 0; i < count; i++) {
        const pIdx = Math.floor((i / count) * peaks.length);
        const amp = peaks[pIdx] ? Math.max(Math.abs(peaks[pIdx][0]), Math.abs(peaks[pIdx][1])) : 0.05;
        const barH = Math.max(4, amp * h * 0.7 + pulse * 15 + Math.sin(i * 0.3 + time * 3) * 4);
        const x = i * step + step * 0.1;
        const y = (h - barH) / 2;

        const grad = ctx.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, '#5352ed');
        grad.addColorStop(0.5, '#70a1ff');
        grad.addColorStop(1, '#ff4757');

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, step * 0.8, barH);
    }
}

function stdClamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

//------------------------------------------------------------------------------
// 従来の標準波形解析（波形・ピッチ・アタック・再生ヘッド）
//------------------------------------------------------------------------------
function drawStandardWaveform(
    ctx: CanvasRenderingContext2D,
    analysis: Analysis | null,
    w: number,
    h: number,
    playheadRatio: number,
    status: Status | null,
) {
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, w, h);

    if (!analysis) {
        ctx.fillStyle = '#555';
        ctx.font = '14px sans-serif';
        ctx.fillText('声を録音すると、ここに波形とピッチが表示されます', 20, 40);
        return;
    }

    // 波形
    const peaks = analysis.peaks;
    if (peaks && peaks.length > 0) {
        ctx.fillStyle = '#3ddc84';
        const n = peaks.length;
        const barW = Math.max(1, w / n);
        for (let i = 0; i < n; i++) {
            const [mn, mx] = peaks[i];
            const x = i * barW;
            const yTop = h / 2 - mx * (h / 2);
            const yBottom = h / 2 - mn * (h / 2);
            ctx.fillRect(x, yTop, barW, Math.max(1, yBottom - yTop));
        }
    }

    // ピッチ曲線
    const pitch = analysis.pitch;
    const pitchTimes = analysis.pitchTimes;
    if (pitch && pitch.length > 0) {
        ctx.strokeStyle = '#ff6b9d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < pitch.length; i++) {
            const hz = pitch[i];
            const t = pitchTimes[i] / analysis.duration;
            const x = t * w;
            const y = hzToY(hz, h);
            if (hz > 0) {
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            } else {
                started = false;
            }
        }
        ctx.stroke();
    }

    // アタック点
    if (analysis.attackTimes && analysis.attackTimes.length > 0) {
        ctx.fillStyle = '#ffc857';
        for (const time of analysis.attackTimes) {
            const x = (time / analysis.duration) * w;
            ctx.fillRect(x - 1, 0, 2, h);
        }
    }

    // 再生ヘッド
    if (playheadRatio > 0) {
        const x = playheadRatio * w;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
}
