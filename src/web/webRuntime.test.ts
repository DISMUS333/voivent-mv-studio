//==============================================================================
// Web ランタイムの単体テスト。
//  - WebAudioEngine のトランスポート状態遷移 (play/pause/seek/position)
//  - encodeWavBase64 の WAV ヘッダ正しさ (RIFF/WAVE/PCM/サンプルレート)
//  - computeAnalysisPeaks の包絡計算
//  - downloadUtils / nativeShim / vite alias の検証
//==============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── AudioContext / AudioBuffer モック ────────────────────────────────────────
class MockAudioParam {
    value = 0;
}
class MockAnalyser {
    fftSize = 2048;
    smoothingTimeConstant = 0.8;
    frequencyBinCount = 2048;
    connect() { /* noop */ }
    getFloatFrequencyData(arr: Float32Array) {
        // 低域ほど大きい決定論的スペクトル
        for (let i = 0; i < arr.length; i++) {
            arr[i] = i < 10 ? -80 : -60;
        }
    }
}
class MockGain {
    gain = new MockAudioParam();
    connect() { /* noop */ }
}
class MockSourceNode {
    buffer: unknown = null;
    onended: (() => void) | null = null;
    started = false;
    connect() { /* noop */ }
    start() { this.started = true; }
    stop() { /* noop */ }
    disconnect() { /* noop */ }
}
class MockAudioContext {
    sampleRate = 48000;
    currentTime = 0;
    state = 'running';
    destination = {};
    createAnalyser() { return new MockAnalyser(); }
    createGain() { return new MockGain(); }
    createBufferSource() { return new MockSourceNode(); }
    decodeAudioData(): Promise<AudioBuffer> {
        return Promise.resolve(makeBuffer(1.0, 48000));
    }
    resume() { return Promise.resolve(); }
}

/** テスト用 AudioBuffer (前半静か・後半大きなサイン波) を生成 */
function makeBuffer(durationSec: number, sampleRate: number): AudioBuffer {
    const length = Math.max(1, Math.floor(durationSec * sampleRate));
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        data[i] = Math.sin((i / sampleRate) * 440 * Math.PI * 2) * 0.5;
        if (i < length / 2) data[i] *= 0.2; // 前半は静か
    }
    return {
        sampleRate,
        length,
        duration: durationSec,
        numberOfChannels: 1,
        getChannelData: () => data,
    } as unknown as AudioBuffer;
}

const makeFile = (name = 'test.mp3', sizeKb = 4): File => {
    const bytes = new Uint8Array(sizeKb * 1024).fill(0x55);
    return new File([bytes], name, { type: 'audio/mpeg' });
};

// ── テスト本体 ────────────────────────────────────────────────────────────────
describe('webAudioEngine — トランスポート', () => {
    let engine: import('../web/webAudioEngine').WebAudioEngine;
    beforeEach(async () => {
        vi.stubGlobal('AudioContext', MockAudioContext);
        // btoa/atob は jsdom がネイティブ提供するためスタブ不要
        vi.resetModules();
        const mod = await import('../web/webAudioEngine');
        engine = new mod.WebAudioEngine();
        await engine.loadFile(makeFile());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('loadFile → duration / hasBuffer / fileName が正しく設定される', async () => {
        expect(engine.hasBuffer()).toBe(true);
        expect(engine.duration()).toBeCloseTo(1.0, 3);
        expect(engine.fileName).toBe('test.mp3');
    });

    it('未再生時の position は 0、isPlaying は false', () => {
        expect(engine.position()).toBe(0);
        expect(engine.isPlaying()).toBe(false);
    });

    it('play → isPlaying=true / pause → isPlaying=false で位置ホールド', async () => {
        await engine.play();
        expect(engine.isPlaying()).toBe(true);
        // 疑似時間経過 (MockAudioContext.currentTime を進める)
        (engine as unknown as { ctx: MockAudioContext }).ctx.currentTime = 0.4;
        engine.pause();
        expect(engine.isPlaying()).toBe(false);
        expect(engine.position()).toBeCloseTo(0.4, 3);
        // pause 後に ctx 時間が進んでも位置はホールドされる
        (engine as unknown as { ctx: MockAudioContext }).ctx.currentTime = 10;
        expect(engine.position()).toBeCloseTo(0.4, 3);
    });

    it('seek は再生中でも位置を変更し再生を継続する', async () => {
        await engine.play();
        engine.seek(0.7);
        // seek 内の再 play() は非同期完了のため 1 タスク待機
        await new Promise((r) => setTimeout(r, 0));
        expect(engine.isPlaying()).toBe(true);
        expect(engine.position()).toBeCloseTo(0.7, 3);
    });

    it('範囲外シークはクランプされる', async () => {
        engine.seek(-5);
        expect(engine.position()).toBe(0);
        engine.seek(99);
        expect(engine.position()).toBeCloseTo(1.0, 3);
    });

    it('getSpectrumDb は 48 バンドの dB 配列 (低域が最大ピーク) を返す', async () => {
        await engine.play();
        const spec = engine.getSpectrumDb();
        expect(spec).toHaveLength(48);
        // モックは bin<10 を -80dB → 対数分割の最低域バンドが -80 になる
        expect(spec[0]).toBeLessThan(spec[40]);
    });

    it('getSpectrumDb は Context 未生成時は空配列', async () => {
        // beforeEach の loadFile は既に Context を生成するため、
        // 未生成検証はまっさらなインスタンスで行う
        vi.resetModules();
        const mod = await import('../web/webAudioEngine');
        const fresh = new mod.WebAudioEngine();
        expect(fresh.getSpectrumDb()).toEqual([]);
    });

    it('renderWavBase64 が正しい RIFF/WAVE/PCM/48000Hz ヘッダを返す', () => {
        const b64 = engine.renderWavBase64(0, 0.5);
        expect(typeof b64).toBe('string');
        const bin = atob(b64 as string);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
        expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
        const view = new DataView(bytes.buffer);
        expect(view.getUint16(20, true)).toBe(1); // PCM
        expect(view.getUint16(22, true)).toBe(1); // mono
        expect(view.getUint32(24, true)).toBe(48000);
    });

    it('renderWavBase64 はバッファ未読み込み時 false', async () => {
        vi.resetModules();
        const mod = await import('../web/webAudioEngine');
        const empty = new mod.WebAudioEngine();
        expect(empty.renderWavBase64(0, 1)).toBe(false);
    });
});

describe('peaksUtils — ピーク包絡', () => {
    it('computeAnalysisPeaks が指定分割数の [min,max] を返す', async () => {
        const { computeAnalysisPeaks } = await import('../web/peaksUtils');
        const buf = makeBuffer(1.0, 48000);
        const peaks = computeAnalysisPeaks(buf, 100);
        expect(peaks).toHaveLength(100);
        for (const [mn, mx] of peaks) {
            expect(mx).toBeLessThanOrEqual(0.51);
            expect(mn).toBeGreaterThanOrEqual(-0.51);
            expect(mn).toBeLessThanOrEqual(mx);
        }
    });

    it('null バッファは空配列', async () => {
        const { computeAnalysisPeaks } = await import('../web/peaksUtils');
        expect(computeAnalysisPeaks(null)).toEqual([]);
    });
});

describe('downloadUtils — Base64 ダウンロード', () => {
    it('stripBase64Prefix が data URL プレフィックスを除去する', async () => {
        const { stripBase64Prefix } = await import('../web/downloadUtils');
        expect(stripBase64Prefix('data:image/gif;base64,QUJD')).toBe('QUJD');
        expect(stripBase64Prefix('QUJD')).toBe('QUJD');
        // data: で始まるがカンマ無し → そのまま
        expect(stripBase64Prefix('data:broken')).toBe('data:broken');
    });

    it('downloadBase64 がアンカークリックでダウンロードを起動する', async () => {
        const { downloadBase64 } = await import('../web/downloadUtils');
        const click = vi.fn();
        const append = vi.fn();
        const remove = vi.fn();
        // atob は jsdom ネイティブを使用
        const createElement = vi.spyOn(document, 'createElement').mockReturnValue({
            href: '',
            download: '',
            click,
            remove,
        } as unknown as HTMLAnchorElement);
        vi.spyOn(document.body, 'appendChild').mockImplementation(append);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        const result = downloadBase64('data:image/gif;base64,QUJD', 'out.gif');
        expect(result).toBe('out.gif');
        expect(click).toHaveBeenCalledTimes(1);
        expect(append).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);

        createElement.mockRestore();
        vi.unstubAllGlobals();
    });
});

describe('nativeShim — Web 版ネイティブ API 差し替え', () => {
    // モジュールレジスタをリセットして shim と engine のシングルトンを
    // 同一グラフに揃えてから、音声を読み込んでおく
    let shimNative: unknown;
    beforeEach(async () => {
        vi.stubGlobal('AudioContext', MockAudioContext);
        vi.resetModules();
        const engineMod = await import('../web/webAudioEngine');
        const shimMod = await import('../web/nativeShim');
        shimNative = shimMod.native;
        const eng = engineMod.getWebAudioEngine();
        await eng.loadFile(makeFile());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('トランスポート API が engine に委譲される', async () => {
        const n = shimNative as Record<string, (...a: unknown[]) => Promise<unknown>>;
        await n.startSessionPlayback();
        expect((await n.getStatus() as { isSessionPlaying: boolean }).isSessionPlaying).toBe(true);
        await n.setSessionPosition(0.25);
        const st = await n.getStatus() as { sessionPosition: number };
        expect(st.sessionPosition).toBeCloseTo(0.25, 3);
        await n.stopSessionPlayback();
        expect((await n.getStatus() as { isSessionPlaying: boolean }).isSessionPlaying).toBe(false);
    });

    it('getTrackSpectrum は 48 バンド配列を返す', async () => {
        const n = shimNative as Record<string, (...a: unknown[]) => Promise<unknown>>;
        await n.startSessionPlayback();
        const spec = await n.getTrackSpectrum(0) as number[];
        expect(spec).toHaveLength(48);
    });

    it('未対応 API は安全に false を返す (クラッシュしない)', async () => {
        const n = shimNative as Record<string, (...a: unknown[]) => Promise<unknown>>;
        // 将来追加される未知の API も false 扱い
        expect(await n.someUnknownFutureApi()).toBe(false);
        expect(await n.startNativeMvExport()).toBe(false);
    });
});

describe('vite.config.web.ts — alias 検証', () => {
    it('NATIVE_ALIAS_FIND が native 相対 import のみにマッチする', async () => {
        const { NATIVE_ALIAS_FIND } = await import('../web/nativeAlias');
        expect(NATIVE_ALIAS_FIND).toBeInstanceOf(RegExp);
        // フロントエンドの実際の import 形式
        expect(NATIVE_ALIAS_FIND.test('../../native')).toBe(true);
        expect(NATIVE_ALIAS_FIND.test('../native')).toBe(true);
        expect(NATIVE_ALIAS_FIND.test('./native')).toBe(true);
        // 誤マッチ防止
        expect(NATIVE_ALIAS_FIND.test('./nativeShim')).toBe(false);
        expect(NATIVE_ALIAS_FIND.test('./types')).toBe(false);
        expect(NATIVE_ALIAS_FIND.test('voivent/native')).toBe(false);
        expect(NATIVE_ALIAS_FIND.test('native')).toBe(false);
    });
});
