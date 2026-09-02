//==============================================================================
// useMvImportedAudio の「先頭へ戻る」(stop) 挙動テスト。
//
// 実機バグ（2026-08, Web 版のみ）: stop() が現位置でポーズするだけで再生位置を
// リセットしていなかった。Web 版は importedAudio が常に存在するため
// MvWorkspace.handleStop の DAW 側分岐 (setSessionPosition(0)) が実行されず、
// トランスポートの「先頭へ戻る」ボタンを押しても 0 秒に戻らなかった。
// 修正後の契約「stop は 0 秒へ戻して停止する」を jsdom で検証する。
//==============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// React 19 の act() をテスト環境で有効化
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useMvImportedAudio } from './useMvImportedAudio';

/** AudioContext の最小スタブ（再生位置は currentTime 手動制御） */
class StubAudioContext {
    static lastGain: { gain: { value: number; setValueAtTime: (value: number) => void } } | null = null;
    currentTime = 0;
    state = 'running';
    destination = {};
    resume(): void { this.state = 'running'; }
    createAnalyser(): unknown {
        return { connect: () => { /* noop */ }, frequencyBinCount: 8, getByteFrequencyData: () => { /* noop */ } };
    }
    createGain(): unknown {
        const gain = {
            value: 1,
            setValueAtTime: (value: number) => { gain.value = value; },
        };
        const node = { gain, connect: () => { /* noop */ } };
        StubAudioContext.lastGain = node;
        return node;
    }
    createBufferSource(): unknown {
        return {
            buffer: null, connect: () => { /* noop */ }, start: () => { /* noop */ },
            stop: () => { /* noop */ }, disconnect: () => { /* noop */ }, onended: null,
        };
    }
}

/** jsdom に AudioBuffer は無いため getChannelData 準拠の最小フェイク */
function makeFakeAudioBuffer(durationSec = 10): AudioBuffer {
    const length = Math.floor(48000 * durationSec);
    return {
        duration: durationSec,
        sampleRate: 48000,
        length,
        getChannelData: () => new Float32Array(length),
    } as unknown as AudioBuffer;
}

type HookState = ReturnType<typeof useMvImportedAudio>;

function mountHook(initialBuffer: AudioBuffer | null, masterGain = 1) {
    const probe: { current: HookState | null } = { current: null };
    function Probe({ gain }: { gain: number }): null {
        probe.current = useMvImportedAudio(initialBuffer, { masterGain: gain });
        return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
        root.render(React.createElement(Probe, { gain: masterGain }));
    });
    return {
        probe,
        rerender: (gain: number) => {
            act(() => root.render(React.createElement(Probe, { gain })));
        },
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
}

describe('useMvImportedAudio — stop は 0 秒へ戻して停止する', () => {
    let mounted: Array<{ unmount: () => void }> = [];

    beforeEach(() => {
        vi.stubGlobal('AudioContext', StubAudioContext);
        mounted = [];
    });

    afterEach(() => {
        for (const m of mounted) m.unmount();
        vi.unstubAllGlobals();
    });

    it('シーク位置 7 秒から stop すると 0 秒へ戻る（旧実装は 7 秒のまま残留）', () => {
        const h = mountHook(makeFakeAudioBuffer());
        mounted.push(h);
        expect(h.probe.current).not.toBeNull();
        expect(h.probe.current!.importedAudio).not.toBeNull();

        act(() => { h.probe.current!.seek(7); });
        expect(h.probe.current!.currentSec).toBe(7);

        act(() => { h.probe.current!.stop(); });
        expect(h.probe.current!.currentSec).toBe(0);
        expect(h.probe.current!.isPlaying).toBe(false);
    });

    it('再生中に stop すると再生が止まり位置も 0 秒へ戻る', () => {
        const h = mountHook(makeFakeAudioBuffer());
        mounted.push(h);

        act(() => { h.probe.current!.togglePlay(); });
        expect(h.probe.current!.isPlaying).toBe(true);

        act(() => { h.probe.current!.stop(); });
        expect(h.probe.current!.isPlaying).toBe(false);
        expect(h.probe.current!.currentSec).toBe(0);
    });

    it('stop 後の再生は 0 秒から始まる', () => {
        const h = mountHook(makeFakeAudioBuffer());
        mounted.push(h);

        act(() => { h.probe.current!.seek(6); });
        act(() => { h.probe.current!.stop(); });
        act(() => { h.probe.current!.togglePlay(); });
        expect(h.probe.current!.isPlaying).toBe(true);
        expect(h.probe.current!.currentSec).toBe(0);
    });

    it('stop 以外のシークで位置は保持される（過剰リセット防止）', () => {
        const h = mountHook(makeFakeAudioBuffer());
        mounted.push(h);

        act(() => { h.probe.current!.seek(4.5); });
        expect(h.probe.current!.currentSec).toBe(4.5);
    });

    it('マスターゲインを 0 にすると再生出力も 0 になる', () => {
        const h = mountHook(makeFakeAudioBuffer(), 1);
        mounted.push(h);

        act(() => { h.probe.current!.togglePlay(); });
        h.rerender(0);

        expect(StubAudioContext.lastGain?.gain.value).toBe(0);
    });
});
