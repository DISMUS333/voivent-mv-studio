//==============================================================================
// 言語ストア (useI18n) の単体テスト。
//==============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// React 19 の act() をテスト環境で有効化
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LANG_STORAGE_KEY } from './config';
import { getLang, resetLangForTest, setLang, subscribeLang, useI18n } from './useI18n';
import { DICTS } from './dict';

/** フック戻り値を記録するプローブ（testing-library 非依存） */
function mountHook(): { current: { lang: string; t: unknown } } {
    const probe = { current: { lang: '', t: {} as unknown } };
    function Probe(): null {
        probe.current = useI18n();
        return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
        root.render(React.createElement(Probe));
    });
    (probe as { __unmount?: () => void }).__unmount = () => {
        act(() => root.unmount());
        container.remove();
    };
    mountedProbes.push(probe as never);
    return probe;
}

const mountedProbes: Array<{ __unmount?: () => void }> = [];

describe('i18n/useI18n — 言語ストア', () => {
    beforeEach(() => {
        localStorage.removeItem(LANG_STORAGE_KEY);
        mountedProbes.length = 0;
        vi.unstubAllGlobals();
        vi.stubGlobal('navigator', { language: 'ja-JP' });
        resetLangForTest(localStorage, 'ja-JP');
    });

    afterEach(() => {
        for (const p of mountedProbes) p.__unmount?.();
        vi.unstubAllGlobals();
        localStorage.removeItem(LANG_STORAGE_KEY);
    });

    it('初期値は detectInitialLang の結果（デフォルト ja）', () => {
        expect(getLang()).toBe('ja');
    });

    it('setLang で辞書が切り替わり、localStorage へ永続化される', () => {
        act(() => {
            setLang('en');
        });
        expect(getLang()).toBe('en');
        expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');

        act(() => {
            setLang('ja');
        });
        expect(getLang()).toBe('ja');
    });

    it('同一言語への再設定は通知しない', () => {
        const listener = vi.fn();
        subscribeLang(listener);
        act(() => {
            setLang(getLang());
        });
        expect(listener).not.toHaveBeenCalled();
    });

    it('useI18n は言語切替時に辞書を再供給する（useSyncExternalStore 経由）', () => {
        const probe = mountHook();
        expect(probe.current.lang).toBe('ja');
        expect((probe.current.t as typeof DICTS.ja).selectAudioFile).toBe(DICTS.ja.selectAudioFile);

        act(() => {
            setLang('en');
        });
        expect(probe.current.lang).toBe('en');
        expect((probe.current.t as typeof DICTS.en).selectAudioFile).toBe(DICTS.en.selectAudioFile);
    });

    it('ja / en 辞書が同じキー集合を持つ', () => {
        const jaKeys = Object.keys(DICTS.ja).sort();
        const enKeys = Object.keys(DICTS.en).sort();
        expect(enKeys).toEqual(jaKeys);
    });
});
