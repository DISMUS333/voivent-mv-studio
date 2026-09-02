//==============================================================================
// i18n 言語設定ユーティリティの単体テスト。
//==============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    LANG_STORAGE_KEY,
    detectInitialLang,
    isLang,
    readSavedLang,
    resolveBrowserLang,
    writeSavedLang,
} from './config';

describe('i18n/config — isLang', () => {
    it('ja / en のみ有効', () => {
        expect(isLang('ja')).toBe(true);
        expect(isLang('en')).toBe(true);
        expect(isLang('fr')).toBe(false);
        expect(isLang('')).toBe(false);
        expect(isLang(null)).toBe(false);
        expect(isLang(undefined)).toBe(false);
        expect(isLang(42)).toBe(false);
    });
});

describe('i18n/config — resolveBrowserLang', () => {
    it('BCP 47 タグの primary subtag で判定する', () => {
        expect(resolveBrowserLang('ja-JP')).toBe('ja');
        expect(resolveBrowserLang('en-US')).toBe('en');
        expect(resolveBrowserLang('en_GB')).toBe('en');
        expect(resolveBrowserLang('JA')).toBe('ja');
    });

    it('対応外・空・null は null を返す', () => {
        expect(resolveBrowserLang('fr-CA')).toBeNull();
        expect(resolveBrowserLang('zh-CN')).toBeNull();
        expect(resolveBrowserLang('')).toBeNull();
        expect(resolveBrowserLang(null)).toBeNull();
        expect(resolveBrowserLang(undefined)).toBeNull();
    });
});

describe('i18n/config — localStorage 読み書き', () => {
    it('保存した言語を読み戻せる', () => {
        writeSavedLang(localStorage, 'en');
        expect(readSavedLang(localStorage)).toBe('en');
        expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
    });

    it('不正値・未保存は null', () => {
        localStorage.setItem(LANG_STORAGE_KEY, 'xx');
        expect(readSavedLang(localStorage)).toBeNull();
        localStorage.removeItem(LANG_STORAGE_KEY);
        expect(readSavedLang(localStorage)).toBeNull();
    });

    it('Storage 例外時もクラッシュしない', () => {
        const throwing = {
            getItem: () => { throw new Error('quota'); },
            setItem: () => { throw new Error('quota'); },
        } as unknown as Storage;
        expect(readSavedLang(throwing)).toBeNull();
        expect(() => writeSavedLang(throwing, 'ja')).not.toThrow();
        expect(readSavedLang(null)).toBeNull();
        expect(() => writeSavedLang(null, 'ja')).not.toThrow();
    });
});

describe('i18n/config — detectInitialLang', () => {
    beforeEach(() => {
        localStorage.removeItem(LANG_STORAGE_KEY);
        vi.unstubAllGlobals();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('優先順位: 保存済み → ブラウザ → ja', () => {
        vi.stubGlobal('navigator', { language: 'en-US' });
        expect(detectInitialLang(localStorage, 'en-US')).toBe('en');

        localStorage.setItem(LANG_STORAGE_KEY, 'ja');
        expect(detectInitialLang(localStorage, 'en-US')).toBe('ja');

        expect(detectInitialLang(null, 'fr')).toBe('ja');
        expect(detectInitialLang(null, null)).toBe('ja');
    });
});
