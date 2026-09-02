//==============================================================================
// MvHistoryStack（Undo/Redo ロジック）の単体テスト
//==============================================================================
import { describe, it, expect } from 'vitest';
import { MvHistoryStack } from './useMvHistory';

describe('MvHistoryStack', () => {
    it('初期状態と canUndo/canRedo フラグ', () => {
        const stack = new MvHistoryStack({ count: 1 });
        expect(stack.state).toEqual({ count: 1 });
        expect(stack.canUndo).toBe(false);
        expect(stack.canRedo).toBe(false);
    });

    it('set で状態更新と Undo / Redo が動作する', () => {
        const stack = new MvHistoryStack({ count: 1 });

        stack.set({ count: 2 });
        expect(stack.state).toEqual({ count: 2 });
        expect(stack.canUndo).toBe(true);
        expect(stack.canRedo).toBe(false);

        stack.undo();
        expect(stack.state).toEqual({ count: 1 });
        expect(stack.canUndo).toBe(false);
        expect(stack.canRedo).toBe(true);

        stack.redo();
        expect(stack.state).toEqual({ count: 2 });
        expect(stack.canUndo).toBe(true);
        expect(stack.canRedo).toBe(false);
    });

    it('差分のない更新は履歴に積まれない', () => {
        const stack = new MvHistoryStack({ count: 1 });

        stack.set({ count: 1 });
        expect(stack.canUndo).toBe(false);
    });

    it('最大履歴数を超えると古い履歴が押し出される', () => {
        const stack = new MvHistoryStack({ count: 0 }, 3);

        stack.set({ count: 1 });
        stack.set({ count: 2 });
        stack.set({ count: 3 });
        stack.set({ count: 4 });

        // 3回までしか戻れない（count: 0 は押し出されて 1 まで）
        expect(stack.undo()).toEqual({ count: 3 });
        expect(stack.undo()).toEqual({ count: 2 });
        expect(stack.undo()).toEqual({ count: 1 });
        expect(stack.undo()).toBeNull();
        expect(stack.state).toEqual({ count: 1 });
        expect(stack.canUndo).toBe(false);
    });

    it('reset で履歴がクリアされる', () => {
        const stack = new MvHistoryStack({ count: 1 });

        stack.set({ count: 2 });
        stack.reset({ count: 10 });

        expect(stack.state).toEqual({ count: 10 });
        expect(stack.canUndo).toBe(false);
        expect(stack.canRedo).toBe(false);
    });
});
