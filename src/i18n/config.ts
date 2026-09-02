//==============================================================================
// i18n 言語設定ユーティリティ。
// 初期言語は「保存済み設定 → ブラウザ言語 → 日本語」の順で決定し、
// 選択言語は localStorage へ永続化する。描画に依存しない純粋ロジックのみ。
//==============================================================================

/** 対応言語 */
export type Lang = 'ja' | 'en';

export const LANG_STORAGE_KEY = 'voivent_web_lang_v1';

/** 任意文字列が対応言語 ID かどうかを検証する */
export function isLang(value: unknown): value is Lang {
    return value === 'ja' || value === 'en';
}

/** localStorage から保存済み言語を読み出す（不正値・未保存時は null） */
export function readSavedLang(storage: Storage | null | undefined): Lang | null {
    if (!storage) return null;
    try {
        const raw = storage.getItem(LANG_STORAGE_KEY);
        return isLang(raw) ? raw : null;
    } catch {
        return null;
    }
}

/** localStorage へ言語を永続化（失敗時は無視：Private mode 等でも動作を壊さない） */
export function writeSavedLang(storage: Storage | null | undefined, lang: Lang): void {
    if (!storage) return;
    try {
        storage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
        /* noop */
    }
}

/**
 * BCP 47 言語タグから対応言語へ解決する。
 * 先頭の primary subtag のみで判定し、ja-JP → ja、en-US → en のように扱う。
 * 対応外・空・不正値は null（呼び出し側でフォールバック）。
 */
export function resolveBrowserLang(language: string | null | undefined): Lang | null {
    if (!language) return null;
    const primary = language.toLowerCase().split(/[-_]/)[0];
    return isLang(primary) ? primary : null;
}

/**
 * 初期言語を決定する。
 * 優先順位: 保存済み設定 → ブラウザ言語 → 'ja'
 */
export function detectInitialLang(
    storage: Storage | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null,
    browserLanguage: string | null | undefined = typeof navigator !== 'undefined' ? navigator.language : null,
): Lang {
    return readSavedLang(storage) ?? resolveBrowserLang(browserLanguage) ?? 'ja';
}
