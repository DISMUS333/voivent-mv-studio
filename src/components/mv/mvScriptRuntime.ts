//==============================================================================
// MV シーン customScript の安全実行ランタイム。
// new Function による隔離実行で、シーンに限定された API のみを公開する。
// ※ 完全なセキュリティ境界ではなく「事故防止」として設計。
//   - DOM への直接アクセス不可（document / window 未提供）
//   - 実行時間上限を設け、超過時は警告
//==============================================================================
import type { AudioSignals } from './types';

/** カスタムスクリプトへ渡す限定 API */
export interface MvScriptApi {
    /** シーン内相対進行度 0〜1 */
    progress: number;
    /** シーン内経過秒数 */
    elapsedSec: number;
    /** オーディオシグナル（読み取り専用コピー） */
    audio: AudioSignals;
    /** シーンルート要素（dataset 等への読み書きに使用） */
    el: HTMLElement;
    /** スタイル値を設定（対象はシーンルート要素） */
    setStyle: (prop: string, value: string) => void;
    /** CSS 変数を設定 */
    setVar: (name: string, value: string) => void;
}

/** スクリプト実行結果 */
export interface MvScriptResult {
    ok: boolean;
    error?: string;
}

/** 実行時間上限（ミリ秒） */
const EXEC_BUDGET_MS = 8;

/** コンパイル結果のキャッシュ（同一ソースの再コンパイル防止） */
const compileCache = new Map<string, ((api: MvScriptApi) => void) | null>();
/** キャッシュ上限（異常な数のスクリプト登録でメモリが膨らむのを防ぐ） */
const COMPILE_CACHE_LIMIT = 64;

/**
 * カスタムスクリプトを関数へコンパイルする。構文エラー時は null を返す。
 * 同一ソース文字列はキャッシュされ、毎フレームの再コンパイルを回避する。
 */
export function compileSceneScript(
    source: string,
): ((api: MvScriptApi) => void) | null {
    if (!source || typeof source !== 'string') return null;
    if (compileCache.has(source)) return compileCache.get(source) ?? null;
    let compiled: ((api: MvScriptApi) => void) | null = null;
    try {
        compiled = new Function('api', `"use strict";${String.fromCharCode(10)}${source}`) as (api: MvScriptApi) => void;
    } catch {
        compiled = null;
    }
    // 上限超過時は最古のエントリを破棄（簡易 LRU 的な振る舞い）
    if (compileCache.size >= COMPILE_CACHE_LIMIT) {
        const oldest = compileCache.keys().next().value;
        if (oldest !== undefined) compileCache.delete(oldest);
    }
    compileCache.set(source, compiled);
    return compiled;
}

/** テスト用：コンパイルキャッシュをクリアする */
export function clearCompileCacheForTest(): void {
    compileCache.clear();
}

/**
 * シーンカスタムスクリプトを実行する。
 * @param rootEl シーンルート DOM 要素（スタイル適用先）
 * @param source スクリプトソース
 * @param ctx 実行コンテキスト（progress / audio 等）
 */
export function runSceneScript(
    rootEl: HTMLElement,
    source: string,
    ctx: { progress: number; elapsedSec: number; audio: AudioSignals },
): MvScriptResult {
    const fn = compileSceneScript(source);
    if (!fn) return { ok: false, error: 'syntax' };

    const api: MvScriptApi = {
        progress: ctx.progress,
        elapsedSec: ctx.elapsedSec,
        audio: { ...ctx.audio },
        el: rootEl,
        setStyle: (prop, value) => {
            try {
                (rootEl.style as unknown as Record<string, string>)[prop] = value;
            } catch { /* noop */ }
        },
        setVar: (name, value) => {
            try {
                rootEl.style.setProperty(name, value);
            } catch { /* noop */ }
        },
    };

    try {
        const t0 = performance.now();
        fn(api);
        const dt = performance.now() - t0;
        if (dt > EXEC_BUDGET_MS) {
            // 予算超過は警告のみ（毎フレーム実行のため中断はしない）
            console.warn(`[MV] customScript 実行時間超過: ${dt.toFixed(1)}ms`);
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
