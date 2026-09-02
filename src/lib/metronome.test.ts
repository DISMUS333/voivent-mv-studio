//==============================================================================
// lib/metronome.ts の単体テスト
// - fake timers でカウントインの tick 順序を同期検証する
// - playClickSound 内部の AudioContext はグローバルをスタブして無音化する
//==============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startCountIn, playClickSound } from './metronome';

// jsdom には AudioContext が存在しないため、最小スタブを注入する。
// （既存の metronome.ts は無変更。DI リファクタリングは将来課題）
class StubAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume() { this.state = 'running'; }
    createOscillator() {
        return {
            frequency: { setValueAtTime: vi.fn() },
            type: 'sine',
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
        };
    }
    createGain() {
        return {
            gain: {
                setValueAtTime: vi.fn(),
                exponentialRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
        };
    }
}

describe('playClickSound（健全性）', () => {
    beforeEach(() => {
        vi.stubGlobal('AudioContext', StubAudioContext);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('AudioContext が存在しなくても例外を握りつぶす', () => {
        vi.stubGlobal('AudioContext', undefined);
        expect(() => playClickSound(true)).not.toThrow();
    });

    it('アクセント / 通常クリックで例外を投げずに生成できる', () => {
        expect(() => playClickSound(true)).not.toThrow();
        expect(() => playClickSound(false)).not.toThrow();
    });
});

describe('startCountIn', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('AudioContext', StubAudioContext);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('MT-01: beats-1 → 1 の順で onTick が発火し、完了時に onComplete が呼ばれる', () => {
        const ticks: number[] = [];
        const onComplete = vi.fn();

        startCountIn({ bpm: 120, beats: 4, onTick: (r) => ticks.push(r), onComplete });

        // 最初の拍は同期的に発火する（beats のまま）
        expect(ticks).toEqual([4]);
        expect(onComplete).not.toHaveBeenCalled();

        // 120 BPM → 500ms 間隔
        vi.advanceTimersByTime(500);
        expect(ticks).toEqual([4, 3]);

        vi.advanceTimersByTime(500);
        expect(ticks).toEqual([4, 3, 2]);

        vi.advanceTimersByTime(500);
        expect(ticks).toEqual([4, 3, 2, 1]);
        expect(onComplete).not.toHaveBeenCalled();

        // 次の tick で完了
        vi.advanceTimersByTime(500);
        expect(onComplete).toHaveBeenCalledTimes(1);
        // 完了後は tick を増やさない
        expect(ticks).toEqual([4, 3, 2, 1]);
    });

    it('MT-02: 返却されたクリーンアップ関数で interval が停止し onComplete は不発', () => {
        const ticks: number[] = [];
        const onComplete = vi.fn();

        const cancel = startCountIn({ bpm: 60, beats: 4, onTick: (r) => ticks.push(r), onComplete });

        cancel(); // 即キャンセル
        vi.advanceTimersByTime(10_000);

        expect(ticks).toEqual([4]); // 最初の同期的 tick のみ
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('MT-03: BPM は interval 計算時に 20–400 へクランプされる', () => {
        const ticks: number[] = [];

        // BPM 0 → 20 BPM 扱い（3 秒間隔）
        startCountIn({ bpm: 0, beats: 2, onTick: (r) => ticks.push(r), onComplete: vi.fn() });
        vi.advanceTimersByTime(2_999);
        expect(ticks).toEqual([2]);
        vi.advanceTimersByTime(1);
        expect(ticks).toEqual([2, 1]);

        // BPM 9999 → 400 BPM 扱い（150ms 間隔）
        ticks.length = 0;
        startCountIn({ bpm: 9999, beats: 2, onTick: (r) => ticks.push(r), onComplete: vi.fn() });
        vi.advanceTimersByTime(149);
        expect(ticks).toEqual([2]);
        vi.advanceTimersByTime(1);
        expect(ticks).toEqual([2, 1]);
    });

    it('beats のデフォルトは 4（1 小節）', () => {
        const ticks: number[] = [];
        const onComplete = vi.fn();
        startCountIn({ bpm: 240, onTick: (r) => ticks.push(r), onComplete });
        // 240 BPM → 250ms 間隔。最初の拍（同期）＋ 3 tick で完了は 1000ms 後
        vi.advanceTimersByTime(999);
        expect(ticks).toEqual([4, 3, 2, 1]);
        expect(onComplete).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });
});