//==============================================================================
// ステム分離の状態管理フック。
// idle → loading-model → separating → ready / error のステートマシンを管理し、
// 分離 PCM は Worker 内にのみ保持する (メインスレッドのメモリ常駐ゼロ)。
//==============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StemWorkerClient } from './stemWorkerClient';
import type { StemAnalysis, StemKind } from './types';
import { AUTO_PCM_RELEASE_SEC } from './types';
import { getWebAudioEngine } from '../../../web/webAudioEngine';

// Web デプロイ時に vite.config.web.ts の define で注入されるモデル URL。
// 未定義 (デスクトップ) の場合は既定の same-origin /models/ を使う。
declare const __STEM_MODEL_URL__: string | undefined;
// Web デプロイ時に注入される ort WASM URL (same-origin /ort/)。
// 未定義 (デスクトップ) の場合は ort 既定の解決に任せる。
declare const __ORT_WASM_URL__: string | undefined;

export type StemSeparationPhase =
    | 'idle'
    | 'loading-model'
    | 'separating'
    | 'ready'
    | 'error';

export interface UseStemSeparationResult {
    phase: StemSeparationPhase;
    /** 解析済みメタデータ (描画 / AI 供給の唯一のデータ源) */
    analysis: StemAnalysis | null;
    /** モデル取得進捗 0..1 (loading-model 時)。total=0 はセッション構築中の不定進捗 */
    modelProgress: number;
    /** モデル取得完了後の onnxruntime セッション構築中か (推論エンジン準備) */
    buildingSession: boolean;
    /** 分離進捗 0..1 (separating 時) */
    separateProgress: number;
    errorText: string | null;
    /** 推論バックエンド表記 (例: webgpu) */
    backend: 'webgpu' | 'wasm' | null;
    /** 最後の分離にかかった秒数 */
    elapsedSec: number | null;
    /** 分離を実行 (既に完了済みなら再実行しない) */
    run: () => Promise<boolean>;
    /** 強制再分離 */
    force: () => Promise<boolean>;
    /** worker 内 PCM を解放 (試聴 / WAV 保存を不可にする) */
    releasePcm: () => void;
    /** 分離済み PCM から 16bit WAV を生成して返す (解放済み / 未分離時はエラー) */
    exportWav: (kind: StemKind) => Promise<ArrayBuffer>;
    /**
     * 分離済み PCM からピーク配列を取得 (ミニ波形描画用)。
     * WAV 生成不要・数 KB のみ。PCM 解放後はエラー。
     */
    getPeaks: (kind: StemKind, numPoints?: number) => Promise<Float32Array>;
    /** PCM 解放済みか */
    isPcmReleased: boolean;
    /** 分離済みボーカル音声が利用可能か */
    hasVocalStem: boolean;
    /** 音源変更時に結果を破棄する (ワークスペース側から呼ぶ) */
    reset: () => void;
    /** AI からの実行要求を扱うためのユーザー許可フラグ */
    aiConsent: boolean;
    setAiConsent: (v: boolean) => void;
}

const DEFAULT_MODEL_URL = '/models/htdemucs_embedded.onnx';

/** モデル取得 URL の解決順: VITE_STEM_MODEL_URL > Web ビルド注入値 > 既定 */
function resolveModelUrl(): string {
    const fromEnv = (import.meta as any).env?.VITE_STEM_MODEL_URL;
    if (fromEnv) return fromEnv as string;
    if (typeof __STEM_MODEL_URL__ !== 'undefined') return __STEM_MODEL_URL__;
    return DEFAULT_MODEL_URL;
}

const isDesktopJuce = typeof window !== 'undefined' && Boolean((window as any).__JUCE__?.backend);

export function useStemSeparation(audioBuffer: AudioBuffer | null): UseStemSeparationResult {
    const [phase, setPhase] = useState<StemSeparationPhase>('idle');
    const [analysis, setAnalysis] = useState<StemAnalysis | null>(null);
    const [modelProgress, setModelProgress] = useState(0);
    /** モデル DL 完了後の ort セッション構築中フラグ (total=0 の進捗で表現される) */
    const [buildingSession, setBuildingSession] = useState(false);
    const [separateProgress, setSeparateProgress] = useState(0);
    const [errorText, setErrorText] = useState<string | null>(null);
    const [backend, setBackend] = useState<'webgpu' | 'wasm' | null>(null);
    const [elapsedSec, setElapsedSec] = useState<number | null>(null);
    const [isPcmReleased, setIsPcmReleased] = useState(false);
    const [aiConsent, setAiConsent] = useState(false);

    const clientRef = useRef<StemWorkerClient | null>(null);
    const runningRef = useRef(false);
    const bufferRef = useRef<AudioBuffer | null>(audioBuffer);
    bufferRef.current = audioBuffer;
    /** 完了済み音源の fingerprint (同一音源の再実行防止) */
    const doneFingerprintRef = useRef<string | null>(null);

    const fingerprintOf = (buf: AudioBuffer | null): string => {
        if (!buf) return '';
        return `${buf.duration.toFixed(3)}_${buf.length}_${buf.sampleRate}`;
    };

    const getClient = useCallback(() => {
        if (!clientRef.current) {
            const c = new StemWorkerClient();
            c.setHandlers({
                onModelProgress: (loaded, total) => {
                    if (total <= 0) {
                        // total=0 は「セッション構築中」シグナル
                        setBuildingSession(true);
                        return;
                    }
                    setModelProgress(total > 0 ? loaded / total : 0);
                },
                onModelReady: (b) => {
                    setBuildingSession(false);
                    setBackend(b as 'webgpu' | 'wasm');
                },
                onSeparateProgress: (p) => setSeparateProgress(p),
                onLog: (phase, message) => {
                    // 診断用: 推論環境・モデル取得・セッション構築の経過を
                    // コンソールに残す (パネルのフリーズ診断に必須)
                    console.info(`[stem:${phase}] ${message}`);
                },
            });
            clientRef.current = c;
        }
        return clientRef.current;
    }, []);

    const execute = useCallback(async (force: boolean): Promise<boolean> => {
        const buf = bufferRef.current;
        if (!buf) {
            setErrorText('音源が読み込まれていません');
            setPhase('error');
            return false;
        }
        if (runningRef.current) return false;
        const fp = fingerprintOf(buf);
        if (!force && doneFingerprintRef.current === fp && analysis) {
            return true;
        }

        // デスクトップ DAW 環境の案内: 各トラックから直接高音質に解析されるため、
        // 重い 2mix 音源分離は外部音源を取り込む Web 版専用機能とする
        if (isDesktopJuce) {
            setErrorText('デスクトップ版はDAWトラックから直接高精度に解析されるため、AI音源分離はWeb版専用です。');
            setPhase('error');
            return false;
        }

        runningRef.current = true;
        setErrorText(null);
        try {
            const client = getClient();
            setPhase('loading-model');
            setModelProgress(0);
            const modelUrl = resolveModelUrl();
            let absoluteModelUrl = modelUrl;
            if (typeof window !== 'undefined') {
                try {
                    absoluteModelUrl = new URL(modelUrl, window.location.href).toString();
                } catch { /* no-op */ }
            }
            let absoluteOrtWasmUrl: string | undefined;
            try {
                if (typeof __ORT_WASM_URL__ !== 'undefined') {
                    absoluteOrtWasmUrl = new URL(__ORT_WASM_URL__, window.location.href).toString();
                }
            } catch { /* no-op */ }
            await client.loadModel(absoluteModelUrl, absoluteOrtWasmUrl);
            setPhase('separating');
            setSeparateProgress(0);
            const t0 = performance.now();
            const result = await client.separate(buf);
            setElapsedSec(Math.round(((performance.now() - t0) / 1000) * 10) / 10);
            setAnalysis(result);
            doneFingerprintRef.current = fp;
            setIsPcmReleased(false);
            setPhase('ready');

            // 🎙️ ステム分離で抽出されたボーカル WAV を WebAudioEngine に登録 (ASR / 文字起こしで優先利用)
            try {
                const vocalWav = await client.exportWav('vocals');
                if (vocalWav && typeof window !== 'undefined') {
                    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
                    const vocalAudioBuffer = await ctx.decodeAudioData(vocalWav.slice(0));
                    getWebAudioEngine().setVocalStemBuffer(vocalAudioBuffer);
                }
            } catch (e) {
                console.warn('[useStemSeparation] Failed to register vocal stem buffer into WebAudioEngine:', e);
            }

            // メモリ規律: 長尺曲は解析完了後に PCM を即解放
            if (buf.duration > AUTO_PCM_RELEASE_SEC) {
                client.releasePcm();
                setIsPcmReleased(true);
            }
            return true;
        } catch (e) {
            setErrorText(e instanceof Error ? e.message : String(e));
            setPhase('error');
            return false;
        } finally {
            runningRef.current = false;
        }
    }, [getClient, analysis]);

    const run = useCallback(() => execute(false), [execute]);
    const force = useCallback(() => execute(true), [execute]);

    const releasePcm = useCallback(() => {
        clientRef.current?.dispose();
        clientRef.current = null;
        setIsPcmReleased(true);
        try { getWebAudioEngine().setVocalStemBuffer(null); } catch { /* noop */ }
    }, []);

    const exportWav = useCallback(async (kind: StemKind): Promise<ArrayBuffer> => {
        const client = getClient();
        return client.exportWav(kind);
    }, [getClient]);

    const getPeaks = useCallback(async (kind: StemKind, numPoints = 600): Promise<Float32Array> => {
        const client = getClient();
        return client.getPeaks(kind, numPoints);
    }, [getClient]);

    const reset = useCallback(() => {
        if (runningRef.current) return;
        setPhase('idle');
        setAnalysis(null);
        setErrorText(null);
        setSeparateProgress(0);
        setElapsedSec(null);
        setBuildingSession(false);
        doneFingerprintRef.current = null;
        setIsPcmReleased(false);
        clientRef.current?.dispose();
        clientRef.current = null;
        try { getWebAudioEngine().setVocalStemBuffer(null); } catch { /* noop */ }
    }, []);

    // アンマウント時に worker を破棄
    useEffect(() => {
        return () => {
            clientRef.current?.dispose();
            clientRef.current = null;
            try { getWebAudioEngine().setVocalStemBuffer(null); } catch { /* noop */ }
        };
    }, []);

    // 音源が差し替わったら過去の結果は無効 (誤合成的再生を構造的に防止)
    const bufferKey = audioBuffer ? fingerprintOf(audioBuffer) : '';
    useEffect(() => {
        if (doneFingerprintRef.current && doneFingerprintRef.current !== bufferKey) {
            reset();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bufferKey]);

    return useMemo(() => ({
        phase,
        analysis,
        modelProgress,
        buildingSession,
        separateProgress,
        errorText,
        backend,
        elapsedSec,
        run,
        force,
        releasePcm,
        exportWav,
        getPeaks,
        isPcmReleased,
        hasVocalStem: phase === 'ready' && analysis !== null,
        reset,
        aiConsent,
        setAiConsent,
    }), [phase, analysis, modelProgress, buildingSession, separateProgress, errorText, backend, elapsedSec, run, force, releasePcm, exportWav, getPeaks, isPcmReleased, reset, aiConsent]);
}

export type { StemKind };
