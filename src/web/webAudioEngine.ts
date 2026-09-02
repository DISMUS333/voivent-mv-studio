//==============================================================================
// Web 版オーディオエンジン (Web Audio API)。
//
// デスクトップ版の AudioEngine (C++) が MV ワークスペースへ提供していた
// トランスポート契約をブラウザだけで再現する:
//  - ユーザー持ち込み音声ファイルの読み込み (decodeAudioData)
//  - 再生 / 一時停止 / シーク (AudioBufferSourceNode 再構成方式)
//  - AnalyserNode 実測 FFT → デスクトップ getTrackSpectrum と同じ dB 配列契約
//  - WAV Base64 レンダリング (renderSessionAudioForMV の Web 版相当)
//
// MV 側は「duration / position / isPlaying」しか知らないため、
// この 1 つの AudioBuffer が Web 版におけるセッション全体となる。
//==============================================================================

/** デスクトップ getTrackSpectrum と同じ 48 バンドの対数 FFT 分割数 */
export const SPECTRUM_BANDS = 48;

type SourceHolder = { node: AudioBufferSourceNode; startedAtCtxTime: number; offsetSec: number };

/**
 * AudioBuffer を 16bit PCM WAV (Base64) へエンコードする (モノラルミックス & ゲイン適用)。
 */
export function encodeWavBase64(buffer: AudioBuffer, startSec: number, endSec: number, gain = 1.0): string {
    const sr = buffer.sampleRate;
    const s0 = Math.max(0, Math.min(buffer.length - 1, Math.floor(startSec * sr)));
    const s1 = Math.max(s0 + 1, Math.min(buffer.length, Math.ceil(endSec * sr)));
    const frameCount = s1 - s0;

    // モノラルへミックスダウン & ゲイン適用
    const mono = new Float32Array(frameCount);
    const channels = Math.min(buffer.numberOfChannels, 2);
    for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < frameCount; i++) {
            mono[i] += (data[s0 + i] * gain) / channels;
        }
    }

    const bytesPerSample = 2;
    const dataSize = frameCount * bytesPerSample;
    const bufferSize = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    const writeStr = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < frameCount; i++) {
        const s = Math.max(-1, Math.min(1, mono[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
    }

    // ArrayBuffer → Base64 (Chunk 化でスタックオーバーフロー回避)
    const raw = new Uint8Array(arrayBuffer);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < raw.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, raw.subarray(i, i + CHUNK) as any);
    }
    return btoa(binary);
}

export class WebAudioEngine {
    private ctx: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private gainNode: GainNode | null = null;
    private buffer: AudioBuffer | null = null;
    private vocalStemBuffer: AudioBuffer | null = null;
    private sourceHolder: SourceHolder | null = null;
    private playing = false;
    private pausedAt = 0;
    private transportGeneration = 0;
    private gain = 1.0;

    /** ユーザー提供音声のファイル名 (UI 表示用) */
    fileName = '';

    private ensureContext(): AudioContext {
        if (!this.ctx) {
            const Ctor: typeof AudioContext =
                window.AudioContext ||
                (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            this.ctx = new Ctor();
            this.analyser = this.ctx.createAnalyser();
            this.analyser.fftSize = 4096;
            this.analyser.smoothingTimeConstant = 0.55;
            this.gainNode = this.ctx.createGain();
            this.gainNode.gain.value = this.gain;
            this.analyser.connect(this.gainNode);
            this.gainNode.connect(this.ctx.destination);
        }
        return this.ctx;
    }

    /** マスター音量 / ゲイン (0.0〜2.0, 1.0 = 100%) を設定 */
    setGain(gain: number): void {
        const clamped = Math.max(0, Math.min(2.0, Number.isFinite(gain) ? gain : 1.0));
        this.gain = clamped;
        if (this.gainNode && this.ctx) {
            this.gainNode.gain.setValueAtTime(clamped, this.ctx.currentTime);
        }
    }

    /** 現在のマスターゲインを取得 */
    getGain(): number {
        return this.gain;
    }

    /** AudioContext はユーザー操作起点で resume が必要 */
    async resumeIfNeeded(): Promise<void> {
        const ctx = this.ensureContext();
        if (ctx.state === 'suspended') {
            try { await ctx.resume(); } catch { /* noop */ }
        }
    }

    /** 音声ファイルをセッションとして読み込む */
    async loadFile(file: File): Promise<{ duration: number; fileName: string }> {
        const ctx = this.ensureContext();
        await this.resumeIfNeeded();
        const bytes = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(bytes);
        this.transportGeneration += 1;
        this.stopInternal();
        this.buffer = decoded;
        this.vocalStemBuffer = null;
        this.pausedAt = 0;
        this.fileName = file.name;
        return { duration: decoded.duration, fileName: file.name };
    }

    hasBuffer(): boolean {
        return this.buffer !== null;
    }

    /** 読み込み済み AudioBuffer (解析ピーク生成用)。未読み込み時は null */
    getBuffer(): AudioBuffer | null {
        return this.buffer;
    }

    /** ステム分離で抽出されたボーカル AudioBuffer を登録 */
    setVocalStemBuffer(buf: AudioBuffer | null): void {
        this.vocalStemBuffer = buf;
    }

    /** ステム分離済みボーカル AudioBuffer を取得 */
    getVocalStemBuffer(): AudioBuffer | null {
        return this.vocalStemBuffer;
    }

    /** ステム分離ボーカルが存在するか */
    hasVocalStem(): boolean {
        return this.vocalStemBuffer !== null;
    }

    duration(): number {
        return this.buffer?.duration ?? 0;
    }

    position(): number {
        const ctx = this.ctx;
        if (!ctx || !this.buffer) return 0;
        if (!this.playing || !this.sourceHolder) return this.clampPos(this.pausedAt);
        const elapsed = ctx.currentTime - this.sourceHolder.startedAtCtxTime;
        return this.clampPos(this.sourceHolder.offsetSec + elapsed);
    }

    isPlaying(): boolean {
        return this.playing;
    }

    async play(expectedGeneration = this.transportGeneration): Promise<boolean> {
        if (!this.buffer) return false;
        const ctx = this.ensureContext();
        await this.resumeIfNeeded();
        if (expectedGeneration !== this.transportGeneration) return false;
        if (this.playing) return true;
        // 終端に達していたら先頭へ戻す
        if (this.pausedAt >= this.buffer.duration - 0.01) this.pausedAt = 0;
        const node = ctx.createBufferSource();
        node.buffer = this.buffer;
        node.connect(this.analyser!);
        const offset = this.clampPos(this.pausedAt);
        node.start(0, offset);
        this.sourceHolder = { node, startedAtCtxTime: ctx.currentTime, offsetSec: offset };
        this.playing = true;
        node.onended = () => {
            // 自然終端のみ扱う (停止操作では onended 発火前に holder を null 化する)
            if (this.sourceHolder?.node === node) {
                this.playing = false;
                this.pausedAt = this.buffer?.duration ?? 0;
                this.sourceHolder = null;
            }
        };
        return true;
    }

    pause(): boolean {
        if (!this.playing) return false;
        const pos = this.position();
        this.transportGeneration += 1;
        this.pausedAt = this.clampPos(pos);
        this.stopInternal();
        return true;
    }

    seek(sec: number): boolean {
        const wasPlaying = this.playing;
        const generation = ++this.transportGeneration;
        this.stopInternal();
        this.pausedAt = this.clampPos(sec);
        if (wasPlaying) void this.play(generation);
        return true;
    }

    /** AnalyserNode 実測 FFT をデスクトップ契約 (dB 値の 48 バンド対数配列) へ変換 */
    getSpectrumDb(): number[] {
        const ctx = this.ctx;
        const analyser = this.analyser;
        if (!ctx || !analyser) return [];
        const bins = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(bins);
        const nyquist = ctx.sampleRate / 2;
        const out: number[] = new Array(SPECTRUM_BANDS).fill(-100);
        const minHertz = 30;
        const binHz = nyquist / bins.length;
        let prevEdge = Math.max(0, Math.floor(minHertz / binHz));
        for (let b = 0; b < SPECTRUM_BANDS; b++) {
            // 30Hz..20kHz を対数分割 (インデックス 0 = 低域)
            const f0 = minHertz * Math.pow(20000 / minHertz, b / SPECTRUM_BANDS);
            const f1 = minHertz * Math.pow(20000 / minHertz, (b + 1) / SPECTRUM_BANDS);
            const edge = Math.max(prevEdge + 1, Math.floor(f1 / binHz));
            let peakDb = -100;
            for (let i = prevEdge; i < edge && i < bins.length; i++) {
                if (bins[i] > peakDb) peakDb = bins[i];
            }
            out[b] = peakDb;
            prevEdge = edge;
        }
        return out;
    }

    /** renderSessionAudioForMV の Web 版: 範囲 WAV を Base64 で返す (ボーカル stem があれば優先) */
    renderWavBase64(startSec?: number, endSec?: number, preferVocalStem = true): string | false {
        const target = (preferVocalStem && this.vocalStemBuffer) ? this.vocalStemBuffer : this.buffer;
        if (!target) return false;
        const s0 = Math.max(0, startSec ?? 0);
        const s1 = Math.min(target.duration, endSec ?? target.duration);
        if (s1 - s0 < 0.05) return false;
        try {
            return encodeWavBase64(target, s0, s1, this.gain);
        } catch (e) {
            console.error('[WebAudioEngine] WAV encode failed:', e);
            return false;
        }
    }

    /** デスクトップ getStatus の Web 版 (MV が参照するフィールドのみ実値) */
    getStatus(): {
        isRecording: boolean; isPlaying: boolean; hasVoice: boolean; hasAnalysis: boolean;
        duration: number; playbackPosition: number; sampleRate: number; hasSession: boolean;
        sessionDuration: number; sessionPosition: number; isSessionPlaying: boolean;
    } {
        const pos = this.position();
        const dur = this.duration();
        return {
            isRecording: false,
            isPlaying: this.playing,
            hasVoice: this.hasBuffer(),
            hasAnalysis: this.hasBuffer(),
            duration: dur,
            playbackPosition: pos,
            sampleRate: this.ctx?.sampleRate ?? 48000,
            hasSession: this.hasBuffer(),
            sessionDuration: dur,
            sessionPosition: pos,
            isSessionPlaying: this.playing,
        };
    }

    private clampPos(sec: number): number {
        const dur = this.buffer?.duration ?? 0;
        if (!Number.isFinite(sec) || sec < 0) return 0;
        return Math.min(sec, dur);
    }

    private stopInternal(): void {
        if (this.sourceHolder) {
            const holder = this.sourceHolder;
            this.sourceHolder = null;
            try {
                holder.node.onended = null;
                holder.node.stop();
                holder.node.disconnect();
            } catch { /* noop */ }
        }
        this.playing = false;
    }
}

let singleton: WebAudioEngine | null = null;

/** アプリ全体で 1 つの WebAudioEngine を共有する */
export function getWebAudioEngine(): WebAudioEngine {
    if (!singleton) {
        singleton = new WebAudioEngine();
        try {
            (globalThis as any).__webAudioEngine = singleton;
        } catch { /* noop */ }
    }
    return singleton;
}
