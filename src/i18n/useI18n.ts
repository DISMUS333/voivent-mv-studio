//==============================================================================
// 言語ストア（外部ストア + useSyncExternalStore）。
// React Context / Provider を使わずコンポーネント単体で購読できるため、
// デスクトップ版のコードへ一切触れずに Web 版だけ言語切替を導入できる。
// 言語変更は全購読コンポーネントへ即座に通知され、localStorage へ永続化される。
//==============================================================================
import { useSyncExternalStore } from 'react';
import { detectInitialLang, writeSavedLang, type Lang } from './config';
import { DICTS, type Dict } from './dict';

let currentLang: Lang = detectInitialLang();
const listeners = new Set<() => void>();

/** 現在の言語を取得（useSyncExternalStore の getSnapshot 用） */
export function getLang(): Lang {
    return currentLang;
}

/** 言語を変更し、全購読者へ通知 + localStorage へ永続化する */
export function setLang(lang: Lang): void {
    if (lang === currentLang) return;
    currentLang = lang;
    writeSavedLang(typeof localStorage !== 'undefined' ? localStorage : null, lang);
    listeners.forEach((l) => l());
}

/** 言語購読を登録する（useSyncExternalStore の subscribe 用） */
export function subscribeLang(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** 現在の言語辞書を取得する */
export function getDict(): Dict {
    return DICTS[currentLang];
}

/**
 * 現在の言語 + 翻訳辞書を購読するフック。
 * 言語が切り替わると再レンダリングされ、最新の辞書が返る。
 */
export function useI18n(): { lang: Lang; t: Dict } {
    const lang = useSyncExternalStore(subscribeLang, getLang, getLang);
    return { lang, t: DICTS[lang] };
}

/** テスト用: 言語を強制リセット（初期値再検出）する */
export function resetLangForTest(storage: Storage | null = null, browserLanguage: string | null = null): void {
    currentLang = detectInitialLang(storage, browserLanguage);
    listeners.forEach((l) => l());
}
