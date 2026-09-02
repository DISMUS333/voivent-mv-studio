//==============================================================================
// webVideoExporter の単体テスト。
//  - start 契約: コーデック検出 → MP4/WebM 自動フォールバック・bitrate/fps 引継ぎ
//  - append 契約: フレーム索引の連続性検査・秒単位タイムスタンプ生成
//  - finish 契約: finalize → Blob ダウンロード・セッション後始末
//  - リークガード: ImageBitmap の close() 保証と VideoFrame の所有権移管 (sample.close()
//    で基盤フレームも解放されることを実 mediabunny 準拠のモックで検証)
// mediabunny はモック化し、muxer への渡し方 (契約) のみを検証する。
//==============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── mediabunny モック (vi.mock の hoisting 対策で vi.hoisted に定義) ────────
const mb = vi.hoisted(() => {
    const state = {
        videoSourceConfigs: [] as Array<Record<string, unknown>>,
        audioSourceConfigs: [] as Array<Record<string, unknown>>,
        videoTrackMeta: [] as Array<Record<string, unknown>>,
        videoAddCalls: [] as unknown[],
        audioAddCalls: [] as unknown[],
        videoSamples: [] as Array<{ timestamp: number; duration: number }>,
        videoFrames: [] as Array<{ timestamp?: number; duration?: number }>,
        decodedAudioBuffer: null as unknown,
        offlineCtorRates: [] as number[],
        videoSourceClosed: 0,
        audioClosed: 0,
        bitmapClosed: 0,
        videoFrameClosed: 0,
        failVideoSampleCtor: false,
        outputCancelCount: 0,
        outputFinalizeCount: 0,
        audioTrackCount: 0,
        videoCodecResult: 'avc' as string | null,
        audioCodecResult: 'aac' as string | null,
        lastOutputFormat: null as unknown,
        targetBuffer: null as ArrayBuffer | null,
    };

    function resetState(): void {
        state.videoSourceConfigs.length = 0;
        state.audioSourceConfigs.length = 0;
        state.videoTrackMeta.length = 0;
        state.videoAddCalls.length = 0;
        state.audioAddCalls.length = 0;
        state.videoSamples.length = 0;
        state.videoFrames.length = 0;
        state.offlineCtorRates.length = 0;
        state.decodedAudioBuffer = { sampleRate: 48000, duration: 1.0, numberOfChannels: 1 };
        state.videoSourceClosed = 0;
        state.audioClosed = 0;
        state.bitmapClosed = 0;
        state.videoFrameClosed = 0;
        state.failVideoSampleCtor = false;
        state.outputCancelCount = 0;
        state.outputFinalizeCount = 0;
        state.audioTrackCount = 0;
        state.videoCodecResult = 'avc';
        state.audioCodecResult = 'aac';
        state.lastOutputFormat = null;
        state.targetBuffer = null;
    }

    class MockBufferTarget {
        buffer: ArrayBuffer | null = null;
    }
    class MockMp4OutputFormat {}
    class MockWebMOutputFormat {}
    class MockVideoSampleSource {
        add = async (s: unknown): Promise<void> => { state.videoAddCalls.push(s); };
        close = (): void => { state.videoSourceClosed++; };
        constructor(config: Record<string, unknown>) {
            state.videoSourceConfigs.push(config);
        }
    }
    class MockAudioBufferSource {
        add = async (b: unknown): Promise<void> => { state.audioAddCalls.push(b); };
        close = (): void => { state.audioClosed++; };
        constructor(config: Record<string, unknown>) {
            state.audioSourceConfigs.push(config);
        }
    }
    class MockVideoSample {
        timestamp: number;
        duration: number;
        /** 実物同様、VideoFrame 由来のデータを参照保持し close() で基盤も解放する */
        private ownedFrame: { close: () => void } | null = null;
        close = (): void => {
            this.ownedFrame?.close();
            this.ownedFrame = null;
        };
        constructor(data: unknown, init?: { timestamp?: number; duration?: number }) {
            if (state.failVideoSampleCtor) throw new Error('mock VideoSample ctor failure');
            this.timestamp = init?.timestamp ?? 0;
            this.duration = init?.duration ?? 0;
            if (data && typeof (data as { close?: unknown }).close === 'function') {
                this.ownedFrame = data as { close: () => void };
            }
            state.videoSamples.push(this);
        }
    }
    class MockOutput {
        format: unknown;
        target: MockBufferTarget;
        tracks: unknown[] = [];
        start = async (): Promise<void> => { /* noop */ };
        finalize = async (): Promise<void> => {
            state.outputFinalizeCount++;
            // 実 muxer 同様に、finalize 完了時に target.buffer が設定される
            this.target.buffer = state.targetBuffer;
        };
        cancel = async (): Promise<void> => { state.outputCancelCount++; };
        addVideoTrack = (_s: unknown, meta?: Record<string, unknown>): unknown => {
            state.videoTrackMeta.push(meta ?? {});
            return {};
        };
        addAudioTrack = (_s: unknown): unknown => {
            state.audioTrackCount++;
            return {};
        };
        constructor(opts: { format: unknown; target: MockBufferTarget }) {
            this.format = opts.format;
            this.target = opts.target;
            state.lastOutputFormat = opts.format;
        }
    }
    const getFirstEncodableVideoCodec = vi.fn(async () => state.videoCodecResult);
    const getFirstEncodableAudioCodec = vi.fn(async () => state.audioCodecResult);

    return {
        // vi.mock はこのオブジェクトを mediabunny モジュールとして返すため、
        // キーは実 export 名と一致させる必要がある
        state,
        resetState,
        BufferTarget: MockBufferTarget,
        Mp4OutputFormat: MockMp4OutputFormat,
        WebMOutputFormat: MockWebMOutputFormat,
        VideoSample: MockVideoSample,
        Output: MockOutput,
        VideoSampleSource: MockVideoSampleSource,
        AudioBufferSource: MockAudioBufferSource,
        getFirstEncodableVideoCodec,
        getFirstEncodableAudioCodec,
    };
});

vi.mock('mediabunny', () => mb);

import {
    __getSessionStateForTest,
    appendWebMvFrames,
    cancelWebMvExport,
    finishWebMvExport,
    jpegBase64ToVideoSample,
    startWebMvExport,
} from './webVideoExporter';

// ── テストデータ生成ヘルパー ────────────────────────────────────────────────

/** 疑似 JPEG フレームの Base64 (デコードは createImageBitmap スタブが吸収) */
function makeFrameB64(i: number): string {
    return btoa(`frame-${i}`);
}

/** 44 バイトの最小 WAV ヘッダを持つ Base64 (sampleRate を実形式で埋め込む) */
function makeWavBase64(sampleRate = 48000): string {
    const buf = new ArrayBuffer(44);
    const v = new DataView(buf);
    const w = (o: number, s: string) => {
        for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    w(0, 'RIFF');
    v.setUint32(4, 36, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, 0, true);
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

/** テスト用の 2D コンテキストスタブ (描画は記録のみ) */
function makeFakeCtx(): CanvasRenderingContext2D {
    return { drawImage: () => {} } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
    mb.resetState();
    // WebCodecs 関連のブラウザグローバルをスタブ
    vi.stubGlobal('VideoFrame', class {
        constructor(_src: unknown, init: { timestamp?: number; duration?: number }) {
            mb.state.videoFrames.push(init);
        }
        close = (): void => { mb.state.videoFrameClosed++; };
    });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
        width: 16,
        height: 16,
        close: (): void => { mb.state.bitmapClosed++; },
    })));
    vi.stubGlobal('OfflineAudioContext', class {
        sampleRate: number;
        constructor(_ch: number, _len: number, rate: number) {
            this.sampleRate = rate;
            mb.state.offlineCtorRates.push(rate);
        }
        decodeAudioData = async (): Promise<unknown> => mb.state.decodedAudioBuffer;
    });
});

afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // モジュール内セッション状態の後始末
    await cancelWebMvExport();
});


describe('startWebMvExport — コーデック検出とコンテナ選択', () => {
    it('H.264 対応環境では MP4 を選択し bitrate/fps を引き継ぐ', async () => {
        mb.state.videoCodecResult = 'avc';
        const result = await startWebMvExport(1280, 720, 30, 6_000_000, 'test.mp4', makeWavBase64());
        expect(result).toBe('mp4');
        // 映像ソースに bitrate と keyFrameInterval が渡る
        expect(mb.state.videoSourceConfigs[0]).toMatchObject({ codec: 'avc', bitrate: 6_000_000 });
        // トラックメタに frameRate が設定される
        expect(mb.state.videoTrackMeta[0]).toMatchObject({ frameRate: 30 });
        // 音声 AAC が構成される
        expect(mb.state.audioSourceConfigs[0]).toMatchObject({ codec: 'aac' });
    });

    it('H.264 非対応環境では WebM (VP9/VP8 + Opus) へフォールバックする', async () => {
        mb.state.videoCodecResult = 'vp9';
        mb.state.audioCodecResult = 'opus';
        const result = await startWebMvExport(1280, 720, 30, 6_000_000, 'test.mp4', makeWavBase64());
        expect(result).toBe('webm');
        expect(mb.state.videoSourceConfigs[0]).toMatchObject({ codec: 'vp9' });
        expect(mb.state.audioSourceConfigs[0]).toMatchObject({ codec: 'opus' });
    });

    it('映像エンコーダが 1 つも無い環境では false を返す', async () => {
        mb.state.videoCodecResult = null;
        const result = await startWebMvExport(1280, 720, 30, 6_000_000, 'test.mp4');
        expect(result).toBe(false);
    });

    it('WebCodecs 非対応ブラウザでは false を返す', async () => {
        vi.stubGlobal('VideoFrame', undefined);
        const result = await startWebMvExport(1280, 720, 30, 6_000_000, 'test.mp4');
        expect(result).toBe(false);
    });

    it('音声 WAV 無しでも映像のみで開始できる', async () => {
        const result = await startWebMvExport(640, 360, 30, 3_000_000, 'test.mp4');
        expect(result).toBe('mp4');
        expect(mb.state.audioSourceConfigs).toHaveLength(0);
    });

    it('fps=0 等の不正値は既定 30fps へ補正される', async () => {
        await startWebMvExport(640, 360, 0, 3_000_000, 'test.mp4');
        expect(mb.state.videoTrackMeta[0]).toMatchObject({ frameRate: 30 });
        expect(__getSessionStateForTest()?.fps).toBe(30);
    });
});

describe('startWebMvExport — 音声デコードと finish 投入', () => {
    it('音声は start 時にデコードされ、finish 時に全投入されて close される', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        await startWebMvExport(1280, 720, 30, 6_000_000, 'test.mp4', makeWavBase64(44100));
        // start 時点ではトラックが追加される
        expect(mb.state.audioTrackCount).toBe(1);

        // finish 時に音声が投入されて close される
        mb.state.targetBuffer = new ArrayBuffer(1024);
        await finishWebMvExport();

        expect(mb.state.audioAddCalls).toHaveLength(1);
        expect(mb.state.audioClosed).toBe(1);
    });

    it('音声デコード失敗時は映像のみで続行する', async () => {
        mb.state.decodedAudioBuffer = null;
        vi.stubGlobal('OfflineAudioContext', class {
            constructor() { /* noop */ }
            decodeAudioData = async (): Promise<unknown> => {
                throw new Error('decode error');
            };
        });
        const result = await startWebMvExport(1280, 720, 30, 6_000_000, 'test.mp4', makeWavBase64());
        expect(result).toBe('mp4');
        expect(mb.state.audioSourceConfigs).toHaveLength(0);
    });
});


describe('appendWebMvFrames — フレーム受入', () => {
    it('連続索引のフレームを受け入れ、秒単位タイムスタンプを生成する', async () => {
        const started = await startWebMvExport(320, 180, 30, 3_000_000, 't.mp4');
        expect(started).toBe('mp4');

        const ok = await appendWebMvFrames([makeFrameB64(0), makeFrameB64(1), makeFrameB64(2)], 0);
        expect(ok).toBe(true);
        expect(mb.state.videoAddCalls).toHaveLength(3);
        // index/fps: 0 → 0s, 1 → 1/30s, 2 → 2/30s
        expect(mb.state.videoSamples[0].timestamp).toBe(0);
        expect(mb.state.videoSamples[1].timestamp).toBeCloseTo(1 / 30, 9);
        expect(mb.state.videoSamples[2].timestamp).toBeCloseTo(2 / 30, 9);
        // 全フレームで duration = 1/fps
        for (const s of mb.state.videoSamples) expect(s.duration).toBeCloseTo(1 / 30, 9);
    });

    it('逆順・飛び番号の索引は拒否する', async () => {
        await startWebMvExport(320, 180, 30, 3_000_000, 't.mp4');
        const ok = await appendWebMvFrames([makeFrameB64(5)], 5);
        expect(ok).toBe(false);
        expect(mb.state.videoAddCalls).toHaveLength(0);
    });

    it('セッション無しの append は false を返す', async () => {
        const ok = await appendWebMvFrames([makeFrameB64(0)], 0);
        expect(ok).toBe(false);
    });

    it('data URL 形式のフレーム (toDataURL 出力) も受け入れる', async () => {
        await startWebMvExport(320, 180, 30, 3_000_000, 't.mp4');
        const ok = await appendWebMvFrames([`data:image/jpeg;base64,${makeFrameB64(0)}`], 0);
        expect(ok).toBe(true);
        expect(mb.state.videoAddCalls).toHaveLength(1);
    });
});

describe('finishWebMvExport — 最終化とダウンロード', () => {
    it('finalize 後に target.buffer を動画 Blob としてダウンロードする', async () => {
        // downloadBlob 内の DOM 操作のみスタブ (canvas 生成は妨害しない)
        const createObjectURL = vi
            .spyOn(URL, 'createObjectURL')
            .mockReturnValue('blob:mock');
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const anchorClick = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);

        await startWebMvExport(320, 180, 30, 3_000_000, 't.mp4');
        await appendWebMvFrames([makeFrameB64(0)], 0);
        // muxer がバッファを生成した想定
        mb.state.targetBuffer = new ArrayBuffer(1024);
        const name = await finishWebMvExport();
        expect(typeof name).toBe('string');
        expect(name as string).toMatch(/\.mp4$/);
        expect(mb.state.outputFinalizeCount).toBe(1);
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(anchorClick).toHaveBeenCalledTimes(1);
        // セッションは解消され、以降の append は失敗する
        expect(await appendWebMvFrames([makeFrameB64(9)], 9)).toBe(false);
        expect(revokeObjectURL).not.toHaveBeenCalled(); // 10 秒待機は即時ではない
    });

    it('mux 出力が空の場合は false を返す', async () => {
        await startWebMvExport(320, 180, 30, 3_000_000, 't.mp4');
        await appendWebMvFrames([makeFrameB64(0)], 0);
        // targetBuffer を設定しないまま finalize
        const name = await finishWebMvExport();
        expect(name).toBe(false);
    });

    it('セッション無しの finish は false を返す', async () => {
        expect(await finishWebMvExport()).toBe(false);
    });

    it('WebM フォールバック時はダウンロード拡張子が .webm に正規化される', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        mb.state.videoCodecResult = 'vp9';
        mb.state.audioCodecResult = 'opus';
        await startWebMvExport(320, 180, 30, 3_000_000, 'movie.mp4');
        await appendWebMvFrames([makeFrameB64(0)], 0);
        mb.state.targetBuffer = new ArrayBuffer(512);
        const name = await finishWebMvExport();
        // start 指定が .mp4 でも実際のコンテナに合わせて .webm になる
        expect(name).toBe('movie.webm');
    });
});

describe('cancelWebMvExport — 中断', () => {
    it('出力を cancel し、セッションを解消する', async () => {
        await startWebMvExport(320, 180, 30, 3_000_000, 't.mp4');
        expect(await cancelWebMvExport()).toBe(true);
        expect(mb.state.outputCancelCount).toBe(1);
        expect(__getSessionStateForTest()).toBeNull();
        // cancel 後の finish は失敗する
        expect(await finishWebMvExport()).toBe(false);
    });

    it('セッション無しの cancel は false を返す', async () => {
        expect(await cancelWebMvExport()).toBe(false);
    });
});

describe('jpegBase64ToVideoSample — リークガードと所有権移管', () => {
    it('成功時: ImageBitmap は close され、VideoFrame の所有権は VideoSample へ移管される', async () => {
        const sample = await jpegBase64ToVideoSample(
            makeFrameB64(0),
            { width: 64, height: 64 } as HTMLCanvasElement,
            makeFakeCtx(),
            0.5,
            1 / 30,
        );
        expect(sample).toBeDefined();
        expect(mb.state.bitmapClosed).toBe(1);
        // VideoFrame は sample が参照保持するため、この時点では close しない
        // (先行 close するとエンコード時に "The VideoFrame has been closed" で失敗する)
        expect(mb.state.videoFrameClosed).toBe(0);
        expect(mb.state.videoFrames[0]).toMatchObject({
            timestamp: 500_000,       // 0.5s → マイクロ秒
            duration: Math.round((1 / 30) * 1_000_000),
        });
        // VideoSample には秒単位で渡る
        expect(mb.state.videoSamples[0].timestamp).toBe(0.5);
        // sample.close() で基盤 VideoFrame も解放される (実 mediabunny 準拠)
        sample.close();
        expect(mb.state.videoFrameClosed).toBe(1);
    });

    it('VideoSample 構築失敗時は所有権移管前に VideoFrame を close する', async () => {
        mb.state.failVideoSampleCtor = true;
        await expect(
            jpegBase64ToVideoSample(
                makeFrameB64(0),
                { width: 64, height: 64 } as HTMLCanvasElement,
                makeFakeCtx(),
                0,
                1 / 30,
            ),
        ).rejects.toThrow('mock VideoSample ctor failure');
        expect(mb.state.videoFrameClosed).toBe(1);
    });

    it('drawImage 失敗時も ImageBitmap は close される', async () => {
        const ctx = {
            drawImage: () => { throw new Error('draw failed'); },
        } as unknown as CanvasRenderingContext2D;
        await expect(
            jpegBase64ToVideoSample(
                makeFrameB64(0),
                { width: 64, height: 64 } as HTMLCanvasElement,
                ctx,
                0,
                1 / 30,
            ),
        ).rejects.toThrow('draw failed');
        expect(mb.state.bitmapClosed).toBe(1);
        // 描画失敗のため VideoFrame は生成されない
        expect(mb.state.videoFrameClosed).toBe(0);
    });
});

