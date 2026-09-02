//==============================================================================
// MV 設定の永続化ストアフック。
// プロジェクトパスごとに localStorage を分離し、楽曲単位で MV 設定を保持する。
// （従来は全プロジェクト共通の 1 キーだったため、切り替え時に上書きされていた問題を解消）
//==============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDefaultMvConfig } from './presets/mvPresets';
import { ensureLyricIds, type MvProjectConfig } from './types';
import { native } from '../../native';
import { getDict } from '../../i18n';

export const STORAGE_PREFIX = 'voivent_mv_config_v2:';
const LEGACY_KEY = 'voivent_mv_config';
/**
 * 歌詞だけを独立して保存するキー。main 設定が assets dataUrl 等で容量超過しても
 * 歌詞だけは救出できるよう分離する（バグ修正: localStorage quota 超過時の巻き添え防止）。
 */
const LYRICS_KEY_PREFIX = 'voivent_mv_lyrics_v1:';

/** プロジェクトパスから安全な localStorage キーを生成 */
export function keyForProject(projectPath: string | null | undefined): string {
    if (!projectPath) return `${STORAGE_PREFIX}__unsaved__`;
    return STORAGE_PREFIX + projectPath.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 歌詞用の独立 localStorage キー */
export function keyForLyrics(projectPath: string | null | undefined): string {
    if (!projectPath) return `${LYRICS_KEY_PREFIX}__unsaved__`;
    return LYRICS_KEY_PREFIX + projectPath.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * localStorage から読み込んだ config を有効とみなす最低条件。
 * バグ修正: 旧実装は `scenes.length > 0` を要求していたため、シーンを全削除して
 * 歌詞だけ残したケースで保存したはずの歌詞が再起動時に消える事故が起きていた。
 * ここでは scenes / lyrics のどちらかが存在すれば valid とみなす。
 */
function isValidConfig(parsed: MvProjectConfig | null | undefined): boolean {
    if (!parsed || typeof parsed !== 'object') return false;
    if (!Array.isArray(parsed.scenes)) return false;
    if (parsed.scenes.length > 0) return true;
    // scenes が空でも、歌詞が 1 つでもあれば valid（歌詞だけは保持する）
    if (Array.isArray(parsed.lyrics) && parsed.lyrics.length > 0) return true;
    return false;
}

/** 現在のプロジェクトの MV 設定を JSON 文字列として取得 */
export function getStoredMvConfigJson(projectPath: string | null | undefined): string | null {
    try {
        return localStorage.getItem(keyForProject(projectPath));
    } catch {
        return null;
    }
}

/** プロジェクトの MV 設定を localStorage に直接書き込み */
export function setStoredMvConfigJson(projectPath: string | null | undefined, jsonStr: string): boolean {
    try {
        if (!jsonStr || jsonStr === '{}') return false;
        const parsed = JSON.parse(jsonStr);
        if (parsed && Array.isArray(parsed.scenes)) {
            localStorage.setItem(keyForProject(projectPath), jsonStr);
            return true;
        }
    } catch {
        /* noop */
    }
    return false;
}

/**
 * 未保存プロジェクト用の一時キー（__unsaved__）を削除する。
 * 初回保存後に旧一時キーが残り続けて容量を浪費する問題の防止。
 */
export function clearUnsavedMvConfig(): void {
    try {
        localStorage.removeItem(`${STORAGE_PREFIX}__unsaved__`);
        // 歌詞用一時キーも同時にクリア（独立キー分離の整合性）
        localStorage.removeItem(`${LYRICS_KEY_PREFIX}__unsaved__`);
    } catch { /* noop */ }
}

/**
 * 旧バージョンで endTime: 9999 として保存されたシーンを
 * 300 秒（5 分）に正規化するマイグレーション。
 * 1 シーンだけ存在し endTime が 9999 の場合のみ適用。
 */
function sanitizeConfig(config: MvProjectConfig): MvProjectConfig {
    if (!config || !Array.isArray(config.scenes)) return config;
    const needsFix = config.scenes.some((s) => s.endTime >= 9000);
    if (!needsFix) return config;
    return {
        ...config,
        scenes: config.scenes.map((s) =>
            s.endTime >= 9000 ? { ...s, endTime: 300 } : s,
        ),
    };
}

import { useMvHistory } from './useMvHistory';

type LyricArr = MvProjectConfig['lyrics'];

export function useMvConfigStore(projectPath: string | null | undefined) {
    const projectKey = keyForProject(projectPath);
    const lyricsKey = keyForLyrics(projectPath);

    // 歌詞を独立キーから救済する関数（メイン設定が読み込めなかった時の最後の砦）
    const readLyricsFromIndependent = useCallback((): LyricArr | null => {
        try {
            const saved = localStorage.getItem(lyricsKey);
            if (!saved) return null;
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return parsed as LyricArr;
        } catch { /* noop */ }
        return null;
    }, [lyricsKey]);

    const initialConfig = useMemo<MvProjectConfig>(() => {
        // 初回：レガシーキーのマイグレーション
        try {
            const legacy = localStorage.getItem(LEGACY_KEY);
            if (legacy && !localStorage.getItem(projectKey)) {
                const parsed = JSON.parse(legacy) as MvProjectConfig;
                if (parsed && isValidConfig(parsed)) {
                    return withLyricIds(sanitizeConfig(parsed));
                }
            }
            const saved = localStorage.getItem(projectKey);
            if (saved) {
                const parsed = JSON.parse(saved) as MvProjectConfig;
                if (parsed && isValidConfig(parsed)) {
                    if (!Array.isArray(parsed.lyrics) || parsed.lyrics.length === 0) {
                        const rescued = readLyricsFromIndependent();
                        if (rescued && rescued.length > 0) {
                            return withLyricIds(sanitizeConfig({ ...parsed, lyrics: rescued }));
                        }
                    }
                    return withLyricIds(sanitizeConfig(parsed));
                }
            }
        } catch { /* noop */ }
        const rescued = readLyricsFromIndependent();
        if (rescued && rescued.length > 0) {
            return Object.assign({}, getDefaultMvConfig(), {
                lyrics: rescued as LyricArr,
                scenes: [] as MvProjectConfig['scenes'],
            });
        }
        return getDefaultMvConfig();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectKey]);

    const history = useMvHistory<MvProjectConfig>(initialConfig);
    const mvConfig = history.state;
    const setMvConfig = history.set;
    const undo = history.undo;
    const redo = history.redo;
    const canUndo = history.canUndo;
    const canRedo = history.canRedo;

    const lastLoadedKeyRef = useRef<string>(projectKey);

    // プロジェクト切替時に該当プロジェクトの設定へスワップ（履歴もリセット）
    useEffect(() => {
        if (lastLoadedKeyRef.current === projectKey) return;
        lastLoadedKeyRef.current = projectKey;
        try {
            const saved = localStorage.getItem(projectKey);
            if (saved) {
                const parsed = JSON.parse(saved) as MvProjectConfig;
                if (parsed && isValidConfig(parsed)) {
                    if (!Array.isArray(parsed.lyrics) || parsed.lyrics.length === 0) {
                        const rescued = readLyricsFromIndependent();
                        if (rescued && rescued.length > 0) {
                            history.resetHistory(withLyricIds(sanitizeConfig({ ...parsed, lyrics: rescued })));
                            return;
                        }
                    }
                    history.resetHistory(withLyricIds(sanitizeConfig(parsed)));
                    return;
                }
            }
        } catch { /* noop */ }
        const rescued = readLyricsFromIndependent();
        if (rescued && rescued.length > 0) {
            history.resetHistory(Object.assign({}, getDefaultMvConfig(), {
                lyrics: rescued as LyricArr,
                scenes: [] as MvProjectConfig['scenes'],
            }));
            return;
        }
        history.resetHistory(getDefaultMvConfig());
    }, [projectKey, readLyricsFromIndependent, history]);

    // 変更時の自動保存（デバウンスなし・軽量データのため即時）
    const [storageWarning, setStorageWarning] = useState<string | null>(null);
    useEffect(() => {
        const jsonStr = JSON.stringify(mvConfig);
        let mainOk = false;
        try {
            localStorage.setItem(projectKey, jsonStr);
            mainOk = true;
        } catch {
            // メインキー容量超過
        }
        try {
            if (Array.isArray(mvConfig.lyrics)) {
                localStorage.setItem(lyricsKey, JSON.stringify(mvConfig.lyrics));
            } else {
                localStorage.removeItem(lyricsKey);
            }
        } catch { /* noop */ }
        if (mainOk) {
            setStorageWarning(null);
        } else {
            setStorageWarning(getDict().storageWarningFull);
        }
        void native.setMvConfig(jsonStr);
    }, [mvConfig, projectKey, lyricsKey]);

    const resetToPreset = useCallback(() => {
        setMvConfig(getDefaultMvConfig());
    }, [setMvConfig]);

    return { mvConfig, setMvConfig, undo, redo, canUndo, canRedo, resetToPreset, storageWarning };
}

/**
 * 設定オブジェクト内の歌詞に安定 ID を付与する。古い保存データ（id なし）を
 * 新しい UI（id ベース編集）でも安全に取り扱えるよう正規化する。
 */
function withLyricIds(config: MvProjectConfig): MvProjectConfig {
    if (!Array.isArray(config.lyrics) || config.lyrics.length === 0) return config;
    return { ...config, lyrics: ensureLyricIds(config.lyrics) as MvProjectConfig['lyrics'] };
}
