//==============================================================================
// MV Studio 履歴管理（Undo / Redo）コアクラス ＆ カスタムフック。
// - 最大 50 件の履歴スタック
// - 差分なし更新の重複除外
// - 外部からの設定ロード時の履歴リセット
//==============================================================================
import { useCallback, useRef, useState } from 'react';

export const DEFAULT_MAX_HISTORY = 50;

export class MvHistoryStack<T> {
    private past: T[] = [];
    private present: T;
    private future: T[] = [];
    private readonly maxHistory: number;

    constructor(initialPresent: T, maxHistory = DEFAULT_MAX_HISTORY) {
        this.present = initialPresent;
        this.maxHistory = maxHistory;
    }

    get state(): T {
        return this.present;
    }

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }

    set(next: T, recordHistory = true): T {
        if (next === this.present) return this.present;

        if (recordHistory) {
            try {
                if (JSON.stringify(next) === JSON.stringify(this.present)) {
                    return this.present;
                }
            } catch { /* noop */ }

            this.past.push(this.present);
            if (this.past.length > this.maxHistory) {
                this.past.shift();
            }
            this.future = [];
        }

        this.present = next;
        return this.present;
    }

    undo(): T | null {
        if (this.past.length === 0) return null;
        const previous = this.past.pop()!;
        this.future.unshift(this.present);
        this.present = previous;
        return this.present;
    }

    redo(): T | null {
        if (this.future.length === 0) return null;
        const next = this.future.shift()!;
        this.past.push(this.present);
        this.present = next;
        return this.present;
    }

    reset(newPresent: T): void {
        this.past = [];
        this.future = [];
        this.present = newPresent;
    }
}

export interface MvHistoryControls<T> {
    state: T;
    set: (newValOrFn: T | ((prev: T) => T), recordHistory?: boolean) => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    resetHistory: (newPresent: T) => void;
}

export function useMvHistory<T>(
    initialPresent: T,
    maxHistory = DEFAULT_MAX_HISTORY,
): MvHistoryControls<T> {
    const stackRef = useRef<MvHistoryStack<T>>(new MvHistoryStack(initialPresent, maxHistory));
    const [state, setState] = useState<T>(initialPresent);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    const updateControls = useCallback(() => {
        setState(stackRef.current.state);
        setCanUndo(stackRef.current.canUndo);
        setCanRedo(stackRef.current.canRedo);
    }, []);

    const set = useCallback(
        (newValOrFn: T | ((prev: T) => T), recordHistory = true) => {
            const current = stackRef.current.state;
            const next = typeof newValOrFn === 'function'
                ? (newValOrFn as (prev: T) => T)(current)
                : newValOrFn;

            stackRef.current.set(next, recordHistory);
            updateControls();
        },
        [updateControls],
    );

    const undo = useCallback(() => {
        const prev = stackRef.current.undo();
        if (prev !== null) {
            updateControls();
        }
    }, [updateControls]);

    const redo = useCallback(() => {
        const next = stackRef.current.redo();
        if (next !== null) {
            updateControls();
        }
    }, [updateControls]);

    const resetHistory = useCallback(
        (newPresent: T) => {
            stackRef.current.reset(newPresent);
            updateControls();
        },
        [updateControls],
    );

    return {
        state,
        set,
        undo,
        redo,
        canUndo,
        canRedo,
        resetHistory,
    };
}
