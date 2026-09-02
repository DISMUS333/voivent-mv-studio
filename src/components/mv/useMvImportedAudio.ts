import { useCallback, useEffect, useRef, useState } from 'react';
import { getDict } from '../../i18n';
import { computeAnalysisPeaks } from '../../web/peaksUtils';
import { amplitudeAtTime, beatPulseAtTime } from './mvOfflineRender';
import type { Analysis, Status } from '../../types';
import type { AudioSignals } from './types';
import type { StemAnalysis } from './stemAnalysis/types';
import { withStemSignals } from './stemAnalysis/stemSignals';

function clampMasterGain(gain: number | undefined): number {
    return Number.isFinite(gain) ? Math.max(0, Math.min(2, gain as number)) : 1.0;
}

export interface ImportedAudioData {
    file: File;
    fileName: string;
    duration: number;
    audioBuffer: AudioBuffer;
    peaks: Array<[number, number]>;
}

export interface UseMvImportedAudioResult {
    /** 読み込み済み外部音源データ (未読み込み時は null) */
    importedAudio: ImportedAudioData | null;
    /** 読み込み中フラグ */
    isLoading: boolean;
    /** 読み込みエラー文字列 (null = 正常) */
    errorText: string | null;
    /** 音声ファイルのロード処理 */
    loadAudioFile: (file: File) => Promise<boolean>;
    /** 外部音源を破棄して元の DAW セッションへ戻す */
    clearImportedAudio: () => void;
    /** 外部音源の再生 / 一時停止トグル */
    togglePlay: () => void;
    /** 外部音源のシーク (秒) */
    seek: (sec: number) => void;
    /** 外部音源の停止 */
    stop: () => void;
    /** 外部音源に基づく Status スナップショット (未ロード時は null) */
    overrideStatus: Status | null;
    /** 外部音源に基づく Analysis スナップショット (未ロード時は null) */
    overrideAnalysis: Analysis | null;
    /** 外部音源に基づくリアルタイム AudioSignals (未ロード時は null) */
    overrideSignals: AudioSignals | null;
    /** 現在の再生秒数 */
    currentSec: number;
    /** 再生中フラグ */
    isPlaying: boolean;
}

export function useMvImportedAudio(
    initialBuffer?: AudioBuffer | null,
    options?: {
        bpm?: number;
        /** 再生出力と動画エクスポートへ適用するマスターゲイン (0.0〜2.0) */
        masterGain?: number;
        /** stem 分離解析結果 (指定時のみ実測シグナルへ強化)。ref 経由で最新を参照 */
        getStemAnalysis?: () => StemAnalysis | null;
        /** stem 強化モード (既定 true) */
        stemMode?: () => boolean;
    },
): UseMvImportedAudioResult {
    const [importedAudio, setImportedAudio] = useState<ImportedAudioData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [errorText, setErrorText] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentSec, setCurrentSec] = useState(0);

    const audioCtxRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const analyserNodeRef = useRef<AnalyserNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const startContextTimeRef = useRef(0);
    const pauseOffsetRef = useRef(0);
    /** currentSec state の鏡 ref（stop() 内で毎フレーム useCallback 再生成を避けるために使用） */
    const currentSecRef = useRef(0);
    const freqDataRef = useRef<Uint8Array | null>(null);
    const [signals, setSignals] = useState<AudioSignals | null>(null);

    /**
     * ⏸ 停止中プレビュー更新の生命線: audioTimeRef。
     * 再生 rAF ループが止まった後も「論理再生位置」を保持し、
     * シーク位置が signals.timeSeconds へ確実に反映されるようにする。
     * これがないと停止中は signals が無音の DAW 実測値 (timeSeconds=0) へ
     * フォールバックし、シークしてもシーン・歌詞プレビューが固まったままになる。
     */
    const audioTimeRef = useRef(0);

    /**
     * 停止中のシーク反映を signals へ確実に流すためのヘルパー。
     * timeSeconds は audioTimeRef (論理再生位置) を唯一の情報源とする。
     * 波形振幅は解析ピークから、拍は BPM から決定論的に再現する
     * (書き出しエンジンと同一の算出経路でプレビュー / 書き出しの整合を担保)。
     */
    const buildStoppedSignals = useCallback((): AudioSignals => {
        const duration = importedAudio?.duration ?? 0;
        const peaks = importedAudio?.peaks ?? undefined;
        const t = audioTimeRef.current;
        const bpm = options?.bpm ?? 120;
        const amp = amplitudeAtTime(peaks, duration, t);
        const base: AudioSignals = {
            peak: amp,
            low: Math.min(1, amp * 1.1),
            mid: Math.min(1, amp * 0.8),
            high: Math.min(1, amp * 0.55),
            beat: beatPulseAtTime(bpm, t),
            isPlaying: false,
            timeSeconds: t,
            bpm,
        };
        // stem 分離済みなら実測シグナルへ強化 (未分離時は base のまま = 後方互換)
        return withStemSignals(base, options?.getStemAnalysis?.() ?? null, options?.stemMode?.() ?? true);
    }, [importedAudio, options?.bpm]);

    // initialBuffer が渡された場合の自動初期化
    useEffect(() => {
        if (!initialBuffer) return;
        setImportedAudio((prev) => {
            if (prev?.audioBuffer === initialBuffer) return prev;
            const peaks = computeAnalysisPeaks(initialBuffer);
            return {
                file: new File([], 'Track.wav'),
                fileName: 'Track.wav',
                duration: initialBuffer.duration,
                audioBuffer: initialBuffer,
                peaks,
            };
        });
    }, [initialBuffer]);

    const getAudioCtx = useCallback((): AudioContext => {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;
            const gainNode = ctx.createGain();
            gainNode.gain.value = clampMasterGain(options?.masterGain);
            analyser.connect(gainNode);
            gainNode.connect(ctx.destination);
            analyserNodeRef.current = analyser;
            gainNodeRef.current = gainNode;
            freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
            audioCtxRef.current = ctx;
        }
        if (audioCtxRef.current.state === 'suspended') {
            void audioCtxRef.current.resume();
        }
        return audioCtxRef.current;
    }, [options?.masterGain]);

    // 音量バー変更時は再生中の音声出力にも即時反映する。
    // AnalyserNode はゲインより前段にあるため、MV の音声反応量は従来どおり変えない。
    useEffect(() => {
        const ctx = audioCtxRef.current;
        const gainNode = gainNodeRef.current;
        if (!ctx || !gainNode) return;
        gainNode.gain.setValueAtTime(clampMasterGain(options?.masterGain), ctx.currentTime);
    }, [options?.masterGain]);

    const stopSource = useCallback(() => {
        if (sourceNodeRef.current) {
            const node = sourceNodeRef.current;
            sourceNodeRef.current = null;
            try {
                node.onended = null;
                node.stop();
                node.disconnect();
            } catch {
                // すでに停止している場合は無視
            }
        }
    }, []);

    const seek = useCallback((sec: number) => {
        const dur = importedAudio?.duration ?? 0;
        const clamped = Math.max(0, Math.min(dur, sec));
        pauseOffsetRef.current = clamped;
        currentSecRef.current = clamped;
        audioTimeRef.current = clamped;
        setCurrentSec(clamped);

        if (isPlaying && importedAudio) {
            stopSource();
            const ctx = getAudioCtx();
            const source = ctx.createBufferSource();
            source.buffer = importedAudio.audioBuffer;
            if (analyserNodeRef.current) {
                source.connect(analyserNodeRef.current);
            }
            startContextTimeRef.current = ctx.currentTime;
            source.start(0, clamped);
            source.onended = () => {
                if (sourceNodeRef.current === source) {
                    sourceNodeRef.current = null;
                    setIsPlaying(false);
                    pauseOffsetRef.current = 0;
                    currentSecRef.current = 0;
                    audioTimeRef.current = 0;
                    setCurrentSec(0);
                }
            };
            sourceNodeRef.current = source;
        } else {
            // ⏸ 停止中シーク: 再生 rAF ループが止まっているため signals は
            // 更新されない。ここで明示的に stopped シグナルを発行しないと
            // プレビュー (シーン・歌詞・シェーダー) がシーク位置へ追従しない
            // (2026-08 Web 版実機不具合の根本原因)。
            setSignals(buildStoppedSignals());
        }
    }, [importedAudio, isPlaying, getAudioCtx, stopSource, buildStoppedSignals]);

    const togglePlay = useCallback(() => {
        if (!importedAudio) return;
        const ctx = getAudioCtx();

        if (isPlaying) {
            // 一時停止: 論理再生位置を確定して保持する (シグナル供給は停止)
            const elapsed = ctx.currentTime - startContextTimeRef.current;
            const pos = Math.min(importedAudio.duration, pauseOffsetRef.current + elapsed);
            pauseOffsetRef.current = pos;
            currentSecRef.current = pos;
            audioTimeRef.current = pos;
            setCurrentSec(pos);
            setIsPlaying(false);
            setSignals(buildStoppedSignals());
            stopSource();
        } else {
            // 再生開始
            const startOffset = pauseOffsetRef.current >= importedAudio.duration ? 0 : pauseOffsetRef.current;
            pauseOffsetRef.current = startOffset;
            currentSecRef.current = startOffset;
            audioTimeRef.current = startOffset;
            setCurrentSec(startOffset);
            const source = ctx.createBufferSource();
            source.buffer = importedAudio.audioBuffer;
            if (analyserNodeRef.current) {
                source.connect(analyserNodeRef.current);
            }
            startContextTimeRef.current = ctx.currentTime;
            source.start(0, startOffset);
            source.onended = () => {
                if (sourceNodeRef.current === source) {
                    sourceNodeRef.current = null;
                    setIsPlaying(false);
                    pauseOffsetRef.current = 0;
                    currentSecRef.current = 0;
                    setCurrentSec(0);
                }
            };
            sourceNodeRef.current = source;
            setIsPlaying(true);
        }
    }, [importedAudio, isPlaying, getAudioCtx, stopSource]);

    // 「先頭へ戻る」ボタン (handleStop) は 0 秒へ戻して停止するのが契约。
    // 実機バグ（2026-08, Web 版のみ）: 旧実装は現位置でポーズするだけで
    // 再生位置をリセットしておらず、Web 版は importedAudio が常に存在するため
    // handleStop の DAW 側分岐 (setSessionPosition(0)) が実行されず、
    // 「押しても 0 秒に戻らない」不具合になっていた。デスクトップの
    // session 停止＋位置リセットと同じ挙動へ統一する。
    const stop = useCallback(() => {
        stopSource();
        setIsPlaying(false);
        pauseOffsetRef.current = 0;
        currentSecRef.current = 0;
        audioTimeRef.current = 0;
        setCurrentSec(0);
        // 先頭へ戻したことをプレビューへ即座に反映させる
        setSignals(buildStoppedSignals());
    }, [stopSource, buildStoppedSignals]);

    // 🎬 楽曲ロード直後 (停止中) もシグナルを供給する。
    // signals が null の間は DAW 実測シグナルへフォールバックするため、
    // 初期シーン / 歌詞の 0 秒時点プレビューが正しく描かれない。
    // ロード完了時に stopped シグナルを 1 回発行して解決する。
    useEffect(() => {
        if (importedAudio && !isPlaying) {
            setSignals(buildStoppedSignals());
        }
        // importedAudio が差し替わるたび (ロード / クリア) に再発行
    }, [importedAudio, isPlaying, buildStoppedSignals]);

    // 再生中の時刻追従 ＆ FFT シグナル更新 (60fps)
    useEffect(() => {
        if (!isPlaying || !importedAudio || !audioCtxRef.current) return;
        let rafId: number;

        const updateFrame = () => {
            const ctx = audioCtxRef.current;
            if (ctx && analyserNodeRef.current && freqDataRef.current) {
                const elapsed = ctx.currentTime - startContextTimeRef.current;
                const pos = Math.min(importedAudio.duration, pauseOffsetRef.current + elapsed);
                currentSecRef.current = pos;
                audioTimeRef.current = pos;
                setCurrentSec(pos);

                analyserNodeRef.current.getByteFrequencyData(freqDataRef.current as any);
                const data = freqDataRef.current;
                const len = data.length;

                // low (0..len/4), mid (len/4..len*3/4), high (len*3/4..len)
                let lowSum = 0;
                let midSum = 0;
                let highSum = 0;
                const q1 = Math.floor(len * 0.25);
                const q3 = Math.floor(len * 0.75);

                for (let i = 0; i < q1; i++) lowSum += data[i];
                for (let i = q1; i < q3; i++) midSum += data[i];
                for (let i = q3; i < len; i++) highSum += data[i];

                const low = lowSum / Math.max(1, q1 * 255);
                const mid = midSum / Math.max(1, (q3 - q1) * 255);
                const high = highSum / Math.max(1, (len - q3) * 255);
                const peak = Math.max(low, mid, high);

                setSignals(withStemSignals({
                    low,
                    mid,
                    high,
                    peak,
                    viseme: peak > 0.3 ? (low > mid ? 'o' : mid > high ? 'a' : 'e') : 'sil',
                    visemeStrength: Math.min(1, peak * 1.2),
                    pitchHz: low > 0.4 ? 120 + mid * 200 : 0,
                    beat: low > 0.6 ? 1 : 0,
                    timeSeconds: pos,
                    isPlaying: true,
                    bpm: 120,
                } as any, options?.getStemAnalysis?.() ?? null, options?.stemMode?.() ?? true));

                if (pos >= importedAudio.duration) {
                    stop();
                    return;
                }
            }
            rafId = requestAnimationFrame(updateFrame);
        };

        rafId = requestAnimationFrame(updateFrame);
        return () => cancelAnimationFrame(rafId);
    }, [isPlaying, importedAudio, stop]);

    const loadAudioFile = useCallback(async (file: File): Promise<boolean> => {
        setIsLoading(true);
        setErrorText(null);
        stop();

        try {
            const ctx = getAudioCtx();
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            const peaks = computeAnalysisPeaks(audioBuffer, 1024);

            setImportedAudio({
                file,
                fileName: file.name,
                duration: audioBuffer.duration,
                audioBuffer,
                peaks,
            });
            setCurrentSec(0);
            currentSecRef.current = 0;
            pauseOffsetRef.current = 0;
            audioTimeRef.current = 0;
            setIsLoading(false);
            return true;
        } catch (err: any) {
            console.error('[useMvImportedAudio] Failed to decode audio file:', err);
            setErrorText(getDict().importedAudioDecodeErr);
            setIsLoading(false);
            return false;
        }
    }, [getAudioCtx, stop]);

    const clearImportedAudio = useCallback(() => {
        stop();
        setImportedAudio(null);
        // DAW 実測シグナルへ確実に復帰させる (null = フォールバック再開)
        setSignals(null);
        setErrorText(null);
    }, [stop]);

    // Status スナップショットの生成
    const overrideStatus: Status | null = importedAudio ? {
        isPlaying: false,
        isRecording: false,
        playbackPosition: 0,
        sampleRate: importedAudio.audioBuffer.sampleRate,
        hasVoice: false,
        hasAnalysis: true,
        duration: importedAudio.duration,
        hasSession: true,
        sessionDuration: importedAudio.duration,
        sessionPosition: currentSec,
        isSessionPlaying: isPlaying,
    } : null;

    // Analysis スナップショットの生成
    const overrideAnalysis: Analysis | null = importedAudio ? {
        duration: importedAudio.duration,
        peaks: importedAudio.peaks,
        pitch: [],
        pitchTimes: [],
        attackTimes: [],
        notes: [],
    } : null;

    return {
        importedAudio,
        isLoading,
        errorText,
        loadAudioFile,
        clearImportedAudio,
        togglePlay,
        seek,
        stop,
        overrideStatus,
        overrideAnalysis,
        overrideSignals: signals,
        currentSec,
        isPlaying,
    };
}
