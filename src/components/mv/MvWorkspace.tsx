//==============================================================================
// MV 専用ワークスペース（3ペイン構成のルートコンポーネント）。
// 左: シーン一覧・世界観プリセット・素材ライブラリ
// 中央: 大画面プレビュー ＋ トランスポート ＋ シーンタイムライン
// 右: 選択シーン詳細（基本設定・背景・キーフレーム・コード・スクリプト）
// 状態は useMvConfigStore / useMvAudioSignals に集約し、各ペインへ配線する。
//==============================================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Analysis, SessionState, Status, SynthState } from '../../types';
import type { MvSceneUpdatedDispatcher, MvSceneUpdatedPayload } from '../../native';
import { isJuce, native } from '../../native';
import { IconDownload, IconExternalLink, IconGlobe, IconSpectrum, IconVideo, IconWaveform } from '../Icons';
import { useMvConfigStore } from './useMvConfigStore';
import { useMvAudioSignals } from './useMvAudioSignals';
import { useMvImportedAudio } from './useMvImportedAudio';
import { useMvTimelineWaveform } from './useMvTimelineWaveform';
import { pickTimelineWaveformAnalysis } from './mvTimelinePeaks';
import { useTheme } from '../../hooks/useTheme';
import { ensureLyricIds } from './types';
import { withAlpha } from '../../theme';
import { usePhrasePreview } from './usePhrasePreview';
import { MvLeftPanel } from './MvLeftPanel';
import { MvCenterPane } from './MvCenterPane';
import { MvRightPanel } from './MvRightPanel';
import { MvExportModal } from './MvExportModal';
import { MvVocalAnalysisModal } from './MvVocalAnalysisModal';
import { DEFAULT_RESOLUTION_ID } from './mvExportPresets';
import { useWebMcp } from './useWebMcp';
import { createWebMcpPreviewCapturePort, createWebMcpVideoRenderPort, type WebMcpRenderPortDeps } from './webMcpRenderPorts';
import { useI18n } from '../../i18n';
import { useStemSeparation } from './stemAnalysis/useStemSeparation';
import type { StemAnalysis } from './stemAnalysis/types';
import { MvStemPanel } from './MvStemPanel';
import { MvStemOfferDialog, isStemOfferDismissed, setStemOfferDismissed } from './MvStemOfferDialog';
import { WebStudioGuideModal } from './WebStudioGuideModal';
import { MvEffectAssetModal } from './effects/MvEffectAssetModal';
import type { MvEffectClip, MvEffectAsset } from './effects/types';
import { ensureEffectClipIds } from './effects/types';
import {
    createEmptyScene,
    clampSceneEndsToDuration,
    deleteScene as removeSceneById,
    duplicateScene,
    sortLyrics,
} from './mvSceneUtils';
import type { AudioSignals, MvScene } from './types';

const AUDIO_FILE_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.ogg,.flac';

interface MvWorkspaceProps {
    analysis: Analysis | null;
    status: Status | null;
    synth: SynthState | null;
    session: SessionState | null;
    /** 現在のプロジェクトパス（MV 設定のプロジェクト別永続化に使用） */
    projectPath?: string | null;
    /** Web 版などで初期ロード済みの AudioBuffer (エクスポート時に直接結合) */
    initialAudioBuffer?: AudioBuffer | null;
    /** Web 版のマスター音量。デスクトップではネイティブ音声経路が管理する */
    exportAudioGain?: number;
    /** WebMCP からマスター音量を変更した時に Web 版 UI へ反映する */
    onExportAudioGainChange?: (gain: number) => void;
}

export const MvWorkspace: React.FC<MvWorkspaceProps> = ({
    analysis,
    status,
    synth,
    session,
    projectPath = null,
    initialAudioBuffer = null,
    exportAudioGain = 1.0,
    onExportAudioGainChange,
}) => {
    // 💾 プロジェクトパスごとの MV 設定ストア（切替時に自動スワップ）
    const { mvConfig, setMvConfig, undo, redo, canUndo, canRedo, storageWarning } = useMvConfigStore(projectPath);
    const { theme } = useTheme();
    const { t } = useI18n();
    const bpm = synth?.bpm ?? 120;

    // ⌨️ MV Studio 全体の Undo / Redo グローバルショートカット (Mac: ⌘Z / ⌘⇧Z, Win: Ctrl+Z / Ctrl+Y)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
            const modifier = isMac ? e.metaKey : e.ctrlKey;
            if (!modifier) return;

            // テキスト入力欄にフォーカスがある時はブラウザ標準の Undo/Redo を優先
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }

            if (e.code === 'KeyZ') {
                if (e.shiftKey) {
                    // Redo (Cmd+Shift+Z / Ctrl+Shift+Z)
                    if (canRedo) {
                        e.preventDefault();
                        redo();
                    }
                } else {
                    // Undo (Cmd+Z / Ctrl+Z)
                    if (canUndo) {
                        e.preventDefault();
                        undo();
                    }
                }
            } else if (e.code === 'KeyY' && !e.shiftKey) {
                // Redo (Cmd+Y / Ctrl+Y)
                if (canRedo) {
                    e.preventDefault();
                    redo();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, canUndo, canRedo]);

    // ── stem 分離結果の最新値をフック間で共有するための ref ──────────────────
    // (useMvImportedAudio のシグナル生成時に getter 経由で参照される。
    //  フック呼び出し順序の循環を避けるため ref + getter パターンを使用)
    const stemAnalysisRef = useRef<StemAnalysis | null>(null);
    const stemReadyRef = useRef(false);

    // 🎵 外部持ち込み音源 (WAV/MP3/M4A) の管理フック (Web 版 initialAudioBuffer と自動統合)
    // getStemAnalysis が設定されている場合は実測 stem シグナルで beat/low/high を強化する
    const importedAudioState = useMvImportedAudio(initialAudioBuffer, {
        bpm,
        masterGain: exportAudioGain,
        getStemAnalysis: () => stemAnalysisRef.current,
        stemMode: () => stemReadyRef.current,
    });
    const { importedAudio, loadAudioFile, clearImportedAudio } = importedAudioState;
    const [isAudioDragOver, setIsAudioDragOver] = useState(false);

    // 音源ロード直後に 1 回だけ「演出精度アップ」オファーを表示 (任意。
    // 「今後表示しない」選択時は localStorage に永続化され二度と出ない)
    const hasAudioNow = importedAudio !== null;
    const prevHasAudioRef = useRef(false);
    useEffect(() => {
        if (!isJuce && hasAudioNow && !prevHasAudioRef.current) {
            if (!isStemOfferDismissed() && stemAnalysisRef.current === null) {
                setShowStemOffer(true);
            }
        }
        prevHasAudioRef.current = hasAudioNow;
    }, [hasAudioNow]);

    // ── stem 分離 (ボーカル / ドラム / ベース / その他) ────────────────────
    // 解析済みメタデータは AudioSignals 強化 (beat/low/high) と WebMCP ツールに供給。
    // PCM は Worker 内のみに保持される (メインスレッドのメモリ常駐ゼロ)。
    const effectiveBufferForStem = importedAudio?.audioBuffer ?? initialAudioBuffer ?? null;
    const stemState = useStemSeparation(effectiveBufferForStem);
    stemAnalysisRef.current = stemState.analysis;
    stemReadyRef.current = stemState.phase === 'ready' && stemState.analysis !== null;

    // 外部音源または Web 版初期音源の AudioBuffer
    const effectiveAudioBuffer = importedAudio?.audioBuffer ?? initialAudioBuffer ?? null;

    // 外部音源ロード時は外部音源のステータス・解析データを優先採用
    const effectiveStatus = importedAudioState.overrideStatus ?? status;
    const effectiveAnalysis = importedAudioState.overrideAnalysis ?? analysis;
    const effectiveSessionDuration = importedAudio ? importedAudio.duration : (session?.duration || 10);
    const effectiveIsPlaying = importedAudio ? importedAudioState.isPlaying : (status?.isSessionPlaying ?? false);

    // 解析対象ボーカルトラック（複数選択可。実オーディオシグナルへ反映）
    const [selectedVocalTracks, setSelectedVocalTracks] = useState<number[]>(() => {
        if (session?.tracks) {
            const voiceIndices: number[] = [];
            session.tracks.forEach((t, idx) => {
                const n = (t.name || '').toLowerCase();
                const isVoice = n.includes('voice') || n.includes('vocal') || n.includes('vo') || n.includes('歌') || n.includes('ボイス');
                if (isVoice || (t.clips && t.clips.length > 0)) {
                    voiceIndices.push(idx);
                }
            });
            if (voiceIndices.length > 0) return voiceIndices;
        }
        return [0];
    });

    // 実測 FFT スペクトラム由来のリアルタイムオーディオシグナル
    // 歌詞データが存在すれば現在時刻の文字から 50音 → viseme を計算して優先採用
    const dawSignals: AudioSignals = useMvAudioSignals({
        status: effectiveStatus,
        bpm,
        trackIndices: selectedVocalTracks,
        lyrics: mvConfig.lyrics,
    });

    // signals: importedAudio 経路は useMvImportedAudio 内で stem 強化済み。
    // 未分離プロジェクトでは従来どおりの値 (後方互換・1 バイトも変化なし)。
    const signals: AudioSignals = importedAudioState.overrideSignals ?? dawSignals;
    const playheadSec = importedAudio ? importedAudioState.currentSec : signals.timeSeconds;
    const isPlaying = effectiveIsPlaying;
    const sessionDuration = effectiveSessionDuration;

    // 初期テンプレートは音声未確定でも使えるよう 300 秒で定義されている。
    // 実音声の長さが分かったら、シーンが音声のない時間まで伸びないよう終端を揃える。
    useEffect(() => {
        if (!Number.isFinite(sessionDuration) || sessionDuration <= 0) return;
        setMvConfig((prev) => {
            const scenes = clampSceneEndsToDuration(prev.scenes, sessionDuration);
            return scenes === prev.scenes ? prev : { ...prev, scenes };
        });
    }, [sessionDuration, setMvConfig, mvConfig.scenes]);

    // 🌊 AUDIO レーン用のセッションミックスダウン波形。
    // デスクトップ (外部音源未読み込み) ではクリップ/ボイス解析は楽曲全体の
    // 波形にならないため、MV 書き出しと同一のミックスダウンから再解析する。
    // クリップ構成・BPM・長さの変化をデバウンス検知して再計算。
    const sessionWaveformSignature = useMemo(() => {
        if (!session) return '';
        const parts = session.tracks.map((t) => `${t.clips.length}:${t.clips
            .map((c) => `${Math.round(c.start * 100)}_${Math.round(c.duration * 100)}_${c.notes?.length ?? 0}`)
            .join(',')}`);
        return `${bpm}|${parts.join('|')}`;
    }, [session, bpm]);
    const mixdownWaveformAnalysis = useMvTimelineWaveform(!importedAudio, sessionDuration, sessionWaveformSignature);
    // ミックスダウン波形を最優先し、無音時は従来のボイス/クリップ解析へフォールバック
    const timelineAnalysis = useMemo(
        () => pickTimelineWaveformAnalysis(mixdownWaveformAnalysis, effectiveAnalysis),
        [mixdownWaveformAnalysis, effectiveAnalysis],
    );

    // ── 再生 / 停止 / シークハンドラー ─────────────────────────────
    const handleSeek = useCallback((sec: number) => {
        if (importedAudio) {
            importedAudioState.seek(sec);
        } else {
            void native.setSessionPosition(sec);
        }
    }, [importedAudio, importedAudioState]);

    const handleTogglePlay = useCallback(() => {
        if (importedAudio) {
            importedAudioState.togglePlay();
        } else {
            if (effectiveIsPlaying) {
                void native.stopSessionPlayback();
            } else {
                void native.startSessionPlayback();
            }
        }
    }, [importedAudio, importedAudioState, effectiveIsPlaying]);

    const handleStop = useCallback(() => {
        if (importedAudio) {
            importedAudioState.stop();
        } else {
            void native.stopSessionPlayback();
            void native.setSessionPosition(0);
        }
    }, [importedAudio, importedAudioState]);

    // 選択中シーン（右ペイン編集対象）
    const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
    // コールバック内から最新の選択シーン ID を参照するための ref
    const selectedSceneIdRef = useRef<string | null>(null);
    selectedSceneIdRef.current = selectedSceneId;

    // ── GIF 出力設定 -------------------------------------------
    const sandboxHostRef = useRef<HTMLDivElement | null>(null);
    // 🎬 Phaser 4 WebGL canvas への直接参照。MV 動画エクスポートの
    // `rasterizePhaserCanvas` (WebGL バッファ直接コピー) で必要。
    const phaserCanvasRef = useRef<HTMLCanvasElement | null>(null);

    // ── モーダル状態 ---------------------------------------------------------
    const [showExportModal, setShowExportModal] = useState(false);
    const [showVocalModal, setShowVocalModal] = useState(false);
    const [showStemPanel, setShowStemPanel] = useState(false);
    // 音源ロード直後の任意オファー (「今後表示しない」済みなら出ない)
    const [showStemOffer, setShowStemOffer] = useState(false);
    const [showWebStudioModal, setShowWebStudioModal] = useState(false);

    // ── プレビューフレーム解像度（エクスポートモーダルと双方向同期） -----------
    const previewResolutionId = mvConfig.previewResolutionId ?? DEFAULT_RESOLUTION_ID;
    const handleChangePreviewResolution = useCallback((id: string) => {
        setMvConfig((prev) => ({ ...prev, previewResolutionId: id }));
    }, [setMvConfig]);

    // WebMCP ツール実行時点の最新値を参照するための ref (ポーリング競合防止)
    const mvConfigRef = useRef(mvConfig);
    mvConfigRef.current = mvConfig;
    const playheadRef = useRef(playheadSec);
    playheadRef.current = playheadSec;
    const webMcpRenderBusyRef = useRef(false);

    // ── WebMCP (Web Model Context Protocol / サイトツール) 自動登録 ───────────
    // 対応ブラウザ・開発者コンソールへ DAW 操作ツール群を公開
    // get_mv_preview / render_mv_video のホスト側ポート (AI の「目」と「納品」)
    const webMcpRenderDeps: WebMcpRenderPortDeps = useMemo(() => ({
        getConfig: () => mvConfigRef.current,
        getBpm: () => bpm,
        getAnalysis: () => effectiveAnalysis,
        getAudioBuffer: () => effectiveAudioBuffer,
        getAudioGain: () => exportAudioGain,
        getPhaserCanvas: () => phaserCanvasRef.current,
        getPlayheadSec: () => playheadRef.current,
        isBusy: () => webMcpRenderBusyRef.current,
        setBusy: (busy: boolean) => { webMcpRenderBusyRef.current = busy; },
    }), [bpm, effectiveAnalysis, effectiveAudioBuffer, exportAudioGain]);
    const previewCapturePort = useMemo(() => createWebMcpPreviewCapturePort(webMcpRenderDeps), [webMcpRenderDeps]);
    const videoRenderPort = useMemo(() => createWebMcpVideoRenderPort(webMcpRenderDeps), [webMcpRenderDeps]);
    const webMcpStatus = useWebMcp({
        config: mvConfig,
        setConfig: setMvConfig,
        bpm: bpm,
        sessionDuration: sessionDuration,
        playheadSec: playheadSec,
        isPlaying: isPlaying,
        analysis: effectiveAnalysis,
        onSeek: handleSeek,
        onTogglePlay: handleTogglePlay,
        onStop: handleStop,
        getPreviewCapture: () => previewCapturePort,
        getVideoRender: () => videoRenderPort,
        getMasterGain: onExportAudioGainChange ? () => exportAudioGain : undefined,
        setMasterGain: onExportAudioGainChange,
        onSelectScene: (sceneId: string) => setSelectedSceneId(sceneId),
        onExportProject: (json: string, filename: string) => {
            try {
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                return true;
            } catch {
                return false;
            }
        },
        getStemAnalysis: () => stemState.analysis,
        runStemSeparation: (_force: boolean) => {
            if (!effectiveBufferForStem) {
                return Promise.resolve({ ok: false, error: '音源が読み込まれていません' });
            }
            if (stemState.phase === 'ready' && stemState.analysis) {
                return Promise.resolve({ ok: true, backend: stemState.backend ?? undefined, elapsedSec: stemState.elapsedSec ?? undefined });
            }
            // ステム分離は手動実行専用。AIの独断・同時実行を防ぎ、ユーザーにUIから押してもらう
            setShowStemPanel(true);
            return Promise.resolve({ ok: false, error: 'ステム分離はユーザーによる手動操作が必要です。画面上部の「Stem分離」ボタンから分離を開始するようユーザーに案内してください。' });
        },
    });

    // スペースキーで再生/停止トグル（テキスト入力中は無視）
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            if (e.code === 'Space') {
                e.preventDefault();
                handleTogglePlay();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [handleTogglePlay]);

    const sortedScenes = useMemo(
        () => [...mvConfig.scenes].sort((a, b) => a.startTime - b.startTime),
        [mvConfig.scenes],
    );
    const currentScene = sortedScenes.find((s) => s.id === selectedSceneId) || sortedScenes[0] || null;

    // 右ペイン用: 選択シーン更新ヘルパー（関数型更新でポーリング競合を防止）
    const updateCurrentScene = useCallback((patch: Partial<MvScene>) => {
        setMvConfig((prev) => {
            const target = prev.scenes.find((s) => s.id === selectedSceneIdRef.current)
                || [...prev.scenes].sort((a, b) => a.startTime - b.startTime)[0]
                || null;
            if (!target) return prev;
            return {
                ...prev,
                scenes: prev.scenes.map((s) => (s.id === target.id ? { ...s, ...patch } : s)),
            };
        });
    }, [setMvConfig]);

    // フレーズプレビュー（▶ ボタン → 前戻りシーク再生 → 終端で自動停止）
    const phrasePreview = usePhrasePreview({ status: effectiveStatus });

    const handleAddScene = () => {
        const lastEnd = sortedScenes.length > 0 ? sortedScenes[sortedScenes.length - 1].endTime : 0;
        const saneDuration = Math.max(0.5, sessionDuration);
        const start = Math.max(0, Math.min(lastEnd, Math.max(0, saneDuration - 0.5)));
        const scene = createEmptyScene(start, Math.min(start + 8, saneDuration), t.sceneN(sortedScenes.length + 1));
        const newSceneId = scene.id;
        // 直前シーンの endTime を新シーン開始位置へ切り詰め
        // 関数型更新: ポーリング再レンダリング競合でシーン配列が巻き戻るのを防止
        setMvConfig((prev) => {
            const prevSorted = [...prev.scenes].sort((a, b) => a.startTime - b.startTime);
            const updatedScenes = prev.scenes.map((s) =>
                prevSorted.length > 0 && s.id === prevSorted[prevSorted.length - 1].id && s.endTime > start
                    ? { ...s, endTime: start }
                    : s,
            );
            return { ...prev, scenes: [...updatedScenes, scene] };
        });
        setSelectedSceneId(newSceneId);
    };

    const handleDuplicateScene = () => {
        if (!currentScene) return;
        const copy = duplicateScene(currentScene);
        setMvConfig((prev) => ({ ...prev, scenes: [...prev.scenes, copy] }));
        setSelectedSceneId(copy.id);
    };

    const handleDeleteScene = () => {
        if (!currentScene || mvConfig.scenes.length <= 1) return;
        setMvConfig((prev) => ({ ...prev, scenes: removeSceneById(prev.scenes, currentScene.id) }));
    };

    // ── ✨ タイムラインエフェクト (FX) 制御 ──────────────────────────────────────
    const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
    const [showEffectAssetModal, setShowEffectAssetModal] = useState<boolean>(false);

    const handleUpdateEffects = useCallback((effects: MvEffectClip[]) => {
        setMvConfig((prev) => ({ ...prev, effects }));
    }, [setMvConfig]);

    const handleSaveEffectAsset = useCallback((asset: MvEffectAsset) => {
        setMvConfig((prev) => ({
            ...prev,
            effectAssets: [...(prev.effectAssets ?? []), asset],
        }));
    }, [setMvConfig]);

    const handleDeleteCustomEffectAsset = useCallback((id: string) => {
        setMvConfig((prev) => ({
            ...prev,
            effectAssets: (prev.effectAssets ?? []).filter((a) => a.id !== id),
        }));
    }, [setMvConfig]);

    const handleAddEffectToTimeline = useCallback((asset: MvEffectAsset, startSec: number, durSec: number) => {
        const newClip: MvEffectClip = {
            id: `fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: asset.name,
            kind: asset.kind,
            startTime: Math.max(0, startSec),
            endTime: Math.max(0, startSec) + Math.max(0.5, durSec),
            intensity: asset.intensity ?? 1.0,
            shaderCode: asset.shaderCode,
            cssCode: asset.cssCode,
            params: asset.params,
        };
        setMvConfig((prev) => ({
            ...prev,
            effects: [...(prev.effects ?? []), newClip].sort((a, b) => a.startTime - b.startTime),
        }));
        setSelectedEffectId(newClip.id);
    }, [setMvConfig]);

    const handleContainerDragOver = (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setIsAudioDragOver(true);
        }
    };

    const handleContainerDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsAudioDragOver(false);
        }
    };

    const handleContainerDrop = (e: React.DragEvent) => {
        setIsAudioDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac)$/i.test(file.name))) {
            e.preventDefault();
            e.stopPropagation();
            void loadAudioFile(file);
        }
    };

    return (
        <div
            onDragOver={handleContainerDragOver}
            onDragLeave={handleContainerDragLeave}
            onDrop={handleContainerDrop}
            style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bgDeep, color: theme.textMain, overflow: 'hidden', position: 'relative' }}
        >
            {/* 音声ファイルドラッグオーバー時のオーバーレイ */}
            {isAudioDragOver && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        background: withAlpha(theme.bgApp, 0.88),
                        backdropFilter: 'blur(4px)',
                        zIndex: 100,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        color: theme.accent,
                        border: `2px dashed ${theme.accent}`,
                        pointerEvents: 'none',
                    }}
                >
                    <IconWaveform size={40} color={theme.accent} />
                    <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: '0.04em' }}>
                        {t.dropAudioOverlay}
                    </span>
                </div>
            )}

            {/* ヘッダー */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', borderBottom: `1px solid ${theme.borderSubtle}`, flexShrink: 0, gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <IconVideo size={14} color={theme.accentInfo} />
                        <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.06em' }}>MV WORKSPACE</span>
                        <span style={{ fontSize: 9.5, color: isPlaying ? theme.success : theme.textMuted, border: `1px solid ${isPlaying ? theme.success : theme.borderLight}`, borderRadius: 3, padding: '1px 6px', fontWeight: 800 }}>
                            {isPlaying ? t.playing : t.ready}
                        </span>
                    </div>

                    {/* 🎵 外部音源の読み込み / 切り替えコントロール (Web版専用) */}
                    {!isJuce && (
                        importedAudio ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: theme.bgControl, border: `1px solid ${theme.border}`, borderRadius: 5, padding: '3px 8px' }}>
                                <IconWaveform size={12} color={theme.accent} />
                                <span style={{ fontSize: 10, fontWeight: 800, color: theme.textMain, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={importedAudio.fileName}>
                                    {importedAudio.fileName}
                                </span>
                                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: theme.accentInfo, fontSize: 9, fontWeight: 800, marginLeft: 2 }} title={t.importAudioFileTitle}>
                                    <span>{t.changeTrack}</span>
                                    <input type="file" accept={AUDIO_FILE_ACCEPT} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadAudioFile(f); e.target.value = ''; }} />
                                </label>
                            </div>
                        ) : (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 5, background: withAlpha(theme.accentInfo, 0.12), color: theme.accentInfo, border: `1px solid ${withAlpha(theme.accentInfo, 0.3)}`, borderRadius: 5, padding: '3px 9px', fontSize: 10, fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s ease' }} title={t.importAudioFileTitle}>
                                <IconWaveform size={11} color={theme.accentInfo} />
                                <span>{t.importAudioFile}</span>
                                <input type="file" accept={AUDIO_FILE_ACCEPT} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadAudioFile(f); e.target.value = ''; }} />
                            </label>
                        )
                    )}

                    {/* 🌐 Web Studio 案内ボタン (デスクトップ版) */}
                    {isJuce && (
                        <button
                            onClick={() => setShowWebStudioModal(true)}
                            title="Voivent Web Studio のご案内 (完成音源のMV制作 / AI 4ステム分離)"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                background: withAlpha(theme.accentSecondary, 0.12),
                                color: theme.accentSecondary,
                                border: `1px solid ${withAlpha(theme.accentSecondary, 0.35)}`,
                                borderRadius: 5,
                                padding: '3px 10px',
                                fontSize: 10.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <IconGlobe size={12} color={theme.accentSecondary} />
                            <span>Web Studio</span>
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Stem分離パネル起動 (Web版専用) */}
                    {!isJuce && (
                        <button
                            onClick={() => setShowStemPanel(true)}
                            title={t.stemPanelTitle}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, background: stemState.phase === 'ready' ? withAlpha(theme.success, 0.18) : theme.bgControl, color: stemState.phase === 'ready' ? theme.success : theme.textMain, border: `1px solid ${stemState.phase === 'ready' ? theme.success : theme.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                        >
                            <IconSpectrum size={12} color={stemState.phase === 'ready' ? theme.success : theme.accentInfo} />
                            <span>{t.stemPanel}</span>
                            {stemState.phase === 'ready' && <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: '0.05em', opacity: 0.9 }}>ON</span>}
                            {stemState.phase === 'separating' && <span style={{ fontSize: 8.5, fontWeight: 900 }}>{Math.round(stemState.separateProgress * 100)}%</span>}
                            {stemState.phase === 'loading-model' && <span style={{ fontSize: 8.5, fontWeight: 900 }}>{Math.round(stemState.modelProgress * 100)}%</span>}
                        </button>
                    )}
                    {/* 動画エクスポート */}
                    <button
                        onClick={() => setShowExportModal(true)}
                        title={t.mvExportTitle}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, background: theme.accentSecondary, color: theme.bgApp, border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                    >
                        <IconDownload size={12} color={theme.bgApp} />
                        <span>{t.mvExport}</span>
                    </button>
                </div>
            </div>

            {/* 保存容量超過警告 */}
            {storageWarning && (
                <div style={{ margin: '8px 14px 0', padding: '7px 12px', background: withAlpha(theme.danger, 0.15), border: `1px solid ${theme.danger}`, borderRadius: 6, color: theme.danger, fontSize: 10.5, fontWeight: 800, flexShrink: 0 }}>
                    {storageWarning}
                </div>
            )}

            {/* 3ペイン本体 */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                <MvLeftPanel
                    config={mvConfig}
                    onUpdateConfig={(c) => setMvConfig(() => c)}
                    selectedSceneId={currentScene?.id ?? null}
                    onSelectScene={(id) => {
                        if (id === '__add__') handleAddScene();
                        else setSelectedSceneId(id);
                    }}
                />

                <MvCenterPane
                    config={mvConfig}
                    signals={signals}
                    sessionDuration={sessionDuration}
                    bpm={bpm}
                    selectedSceneId={currentScene?.id ?? null}
                    onSelectScene={(id) => setSelectedSceneId(id)}
                    playheadSec={playheadSec}
                    isPlaying={isPlaying}
                    currentTimeSec={playheadSec}
                    onSeek={handleSeek}
                    onTogglePlay={handleTogglePlay}
                    onStop={handleStop}
                    onUpdateScenes={(scenes) => setMvConfig((prev) => ({ ...prev, scenes }))}
                    onUpdateLyrics={(lyrics) => setMvConfig((prev) => ({ ...prev, lyrics }))}
                    onUpdateAssets={(assets) => setMvConfig((prev) => ({ ...prev, assets }))}
                    onUpdateEffects={handleUpdateEffects}
                    selectedEffectId={selectedEffectId}
                    onSelectEffect={setSelectedEffectId}
                    onOpenEffectAssetLibrary={() => setShowEffectAssetModal(true)}
                    sandboxHostRef={sandboxHostRef}
                    phaserCanvasRef={phaserCanvasRef}
                    previewResolutionId={previewResolutionId}
                    onChangePreviewResolution={handleChangePreviewResolution}
                    analysis={timelineAnalysis}
                    onUndo={undo}
                    onRedo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                />
                <MvRightPanel
                    config={mvConfig}
                    currentScene={currentScene}
                    onUpdateCurrentScene={updateCurrentScene}
                    session={session}
                    analysis={analysis}
                    bpm={bpm}
                    playheadSec={playheadSec}
                    onSeek={handleSeek}
                    isPlaying={isPlaying}
                    previewingLyricId={phrasePreview.previewingLyricId}
                    onPhrasePreview={phrasePreview.startPreview}
                    selectedTrackIndices={selectedVocalTracks}
                    onChangeSelectedTracks={setSelectedVocalTracks}
                    onAddScene={handleAddScene}
                    onDuplicateScene={handleDuplicateScene}
                    onDeleteScene={handleDeleteScene}
                    onUpdateGlobalCss={(css) => setMvConfig((prev) => ({ ...prev, globalCss: css }))}
                    onUpdateLyrics={(lyrics) => setMvConfig((prev) => ({ ...prev, lyrics }))}
                    onUpdateLyricStyle={(lyricStyle) => setMvConfig((prev) => ({ ...prev, lyricStyle }))}
                    onOpenVocalAnalysisModal={() => setShowVocalModal(true)}
                />
            </div>

            {/* ✨ FX アセットライブラリ＆保存モーダル */}
            <MvEffectAssetModal
                isOpen={showEffectAssetModal}
                onClose={() => setShowEffectAssetModal(false)}
                customAssets={mvConfig.effectAssets ?? []}
                onSaveAsset={handleSaveEffectAsset}
                onDeleteCustomAsset={handleDeleteCustomEffectAsset}
                onAddEffectToTimeline={handleAddEffectToTimeline}
                currentPlayheadSec={playheadSec}
                selectedClip={(mvConfig.effects ?? []).find((fx) => fx.id === selectedEffectId) ?? null}
            />

            {/* 動画エクスポート設定モーダル */}
            <MvExportModal
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                sessionDuration={sessionDuration}
                sandboxHostRef={sandboxHostRef}
                phaserCanvasRef={phaserCanvasRef}
                title={mvConfig.title || 'Voivent Session'}
                selectedResolutionId={previewResolutionId}
                onSelectResolution={handleChangePreviewResolution}
                bpm={bpm}
                lyrics={mvConfig.lyrics}
                scenes={mvConfig.scenes}
                assets={mvConfig.assets}
                lyricStyle={mvConfig.lyricStyle}
                globalCss={mvConfig.globalCss}
                analysis={effectiveAnalysis}
                importedAudioBuffer={effectiveAudioBuffer}
                audioGain={exportAudioGain}
            />

            {/* AI ボーカル解析＆自動配置モーダル（トップレベル描画） */}
            <MvVocalAnalysisModal
                isOpen={showVocalModal}
                onClose={() => setShowVocalModal(false)}
                tracks={(session?.tracks || []) as Array<{ name: string; color?: string; isMidi?: boolean; clips?: unknown[] }>}
                initialSelectedTrackIndices={selectedVocalTracks}
                totalDurationSec={session?.duration || 16}
                onChangeSelectedTracks={setSelectedVocalTracks}
                hasVocalStem={stemState.hasVocalStem}
                onOpenStemPanel={() => {
                    setShowVocalModal(false);
                    setShowStemPanel(true);
                }}
                onApplyLyrics={(newLyrics, mode) => {
                    // バグ修正: AI 文字起こし結果にも id を採番して UI 編集の安定参照を保証
                    const withIds = ensureLyricIds(newLyrics);
                    if (mode === 'replace') {
                        setMvConfig((prev) => ({ ...prev, lyrics: withIds }));
                    } else {
                        setMvConfig((prev) => ({
                            ...prev,
                            lyrics: sortLyrics([...(prev.lyrics || []), ...withIds]),
                        }));
                    }
                }}
            />

            {/* ステム分離の任意オファー (Web版音源ロード直後) */}
            {!isJuce && (
                <>
                    <MvStemOfferDialog
                        isOpen={showStemOffer}
                        onAccept={() => {
                            setShowStemOffer(false);
                            setShowStemPanel(true);
                        }}
                        onLater={() => setShowStemOffer(false)}
                        onNever={() => {
                            setStemOfferDismissed();
                            setShowStemOffer(false);
                        }}
                    />

                    <MvStemPanel
                        isOpen={showStemPanel}
                        onClose={() => setShowStemPanel(false)}
                        audioBuffer={effectiveBufferForStem}
                        stemState={stemState}
                        onAnalysisReady={() => { /* 解析結果は stemState 経由で自動反映 */ }}
                    />
                </>
            )}

            {/* Web Studio 案内モーダル (デスクトップ版) */}
            {isJuce && (
                <WebStudioGuideModal
                    isOpen={showWebStudioModal}
                    onClose={() => setShowWebStudioModal(false)}
                />
            )}

        </div>
    );
};
