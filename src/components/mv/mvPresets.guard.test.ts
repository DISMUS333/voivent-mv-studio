//==============================================================================
// MV プリセット定義のガードテスト。
// バグ回帰防止: useMvConfigStore が存在しないプリセットキー
// (geometric_psychedelic) を参照して undefined を既定設定にしていた事故を、
// 二重構造 (定数整合 + ストア動作) で恒久的に検知する。
//==============================================================================
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDefaultMvConfig, getDefaultMvPresets } from './presets/mvPresets';
import { useMvConfigStore } from './useMvConfigStore';
import type { MvProjectConfig } from './types';

// React 19 の act() をテスト環境で有効化
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StoreHookResult = ReturnType<typeof useMvConfigStore>;

/** マウント中のフックプローブ (afterEach で全件アンマウントする) */
const mountedProbes: Array<() => void> = [];

/**
 * useMvConfigStore を最小のプローブコンポーネント経由でマウントし、
 * 最新の戻り値を result.current へ記録する (testing-library 非依存)。
 */
function renderConfigStoreHook(): { result: { current: StoreHookResult | null } } {
    const result: { current: StoreHookResult | null } = { current: null };

    function Probe(): null {
        result.current = useMvConfigStore(null);
        return null;
    }

    const container = document.createElement('div');
    act(() => {
        const root = createRoot(container);
        root.render(React.createElement(Probe));
        mountedProbes.push(() => {
            act(() => {
                root.unmount();
            });
        });
    });

    return { result };
}

afterEach(() => {
    while (mountedProbes.length > 0) {
        mountedProbes.pop()?.();
    }
});

/** MvProjectConfig として最低限満たすべき形状 */
function expectValidMvConfig(config: MvProjectConfig, label: string): void {
    expect(config, label).toBeTruthy();
    expect(typeof config.title, `${label}.title`).toBe('string');
    expect(typeof config.globalCss, `${label}.globalCss`).toBe('string');
    expect(Array.isArray(config.scenes), `${label}.scenes は配列`).toBe(true);
    expect(Array.isArray(config.lyrics), `${label}.lyrics は配列`).toBe(true);
    for (const scene of config.scenes) {
        expect(typeof scene.id, 'scene.id').toBe('string');
        expect(typeof scene.svgCode, 'scene.svgCode').toBe('string');
        expect(typeof scene.startTime, 'scene.startTime').toBe('number');
        expect(typeof scene.endTime, 'scene.endTime').toBe('number');
    }
}

describe('mvPresets — 既定設定とプリセットの整合', () => {
    it('getDefaultMvConfig() が実在プリセットを指し undefined でない', () => {
        // 回帰ガード: かつて getDefaultMvPresets().geometric_psychedelic (未定義キー)
        // を返していたため、真っ新な環境で mvConfig が undefined になり
        // MvWorkspace がクラッシュした。二度と起きないよう実値を検証する。
        expect(getDefaultMvConfig()).toBeDefined();
        expect(getDefaultMvConfig()).not.toBeNull();
    });

    it('getDefaultMvConfig() は全必須フィールドを備えた有効な設定である', () => {
        expectValidMvConfig(getDefaultMvConfig(), 'getDefaultMvConfig()');
        expect(getDefaultMvConfig().scenes.length).toBeGreaterThan(0);
    });

    it('全プリセットが有効な MvProjectConfig 形状を満たす', () => {
        const keys = Object.keys(getDefaultMvPresets());
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) {
            expectValidMvConfig(getDefaultMvPresets()[key], `preset:${key}`);
        }
    });

    it('空白AIキャンバスは背景・歌詞・共通歌詞レイヤーを初期状態で持たない', () => {
        const blank = getDefaultMvPresets().blank_ai_canvas;
        expect(blank).toBeDefined();
        expect(blank.globalCss).toBe('');
        expect(blank.lyrics).toEqual([]);
        expect(blank.lyricStyle?.showBuiltIn).toBe(false);
        expect(blank.scenes).toHaveLength(1);
        expect(blank.scenes[0]?.svgCode).toBe('');
        expect(blank.scenes[0]?.lyricDisplayMode).toBe('none');
    });

    it('人間向け3プリセットは共通歌詞レイヤーを表示しない', () => {
        for (const key of ['pixel_glitch_minimal', 'cinematic_atmosphere', 'lipsync_character']) {
            expect(getDefaultMvPresets()[key].lyricStyle?.showBuiltIn).toBe(false);
        }
    });

    it('getDefaultMvConfig() はプリセットのいずれかと同一内容である', () => {
        // ビルダー化（言語切替対応）により毎回新規オブジェクトを返すため、
        // 参照一致ではなく構造一致（同一キーかつ同一 ID）で検証する
        const values = Object.values(getDefaultMvPresets());
        const config = getDefaultMvConfig();
        const matched = values.some((p) => p === config || (p.activePresetId === config.activePresetId && p.title === config.title));
        expect(matched).toBe(true);
    });
});

describe('useMvConfigStore — 空環境での既定フォールバック', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('localStorage が空でも mvConfig.lyrics / scenes を持つ設定を返す (回帰ガード)', () => {
        const { result } = renderConfigStoreHook();
        // 旧実装はここで undefined を返し MvWorkspace.tsx の
        // `mvConfig.lyrics` 参照が TypeError で落ちていた
        const config = result.current?.mvConfig;
        expect(config).toBeDefined();
        expect(config).not.toBeNull();
        expect(Array.isArray(config?.lyrics)).toBe(true);
        expect(Array.isArray(config?.scenes)).toBe(true);
        expect(typeof config?.title).toBe('string');
    });

    it('破損した保存データ (不正 JSON) があっても既定設定へフォールバックする', () => {
        localStorage.setItem('voivent_mv_config_v2:__unsaved__', '{ not json !!');
        localStorage.setItem('voivent_mv_lyrics_v1:__unsaved__', '[[[broken');
        const { result } = renderConfigStoreHook();
        expect(Array.isArray(result.current?.mvConfig?.lyrics)).toBe(true);
    });

    it('有効な保存データがあればそれを優先して読み込む', () => {
        const saved: MvProjectConfig = {
            ...getDefaultMvConfig(),
            title: '保存済みプロジェクト',
            lyrics: [{ time: 1, duration: 2, text: 'テスト' }],
        };
        localStorage.setItem('voivent_mv_config_v2:__unsaved__', JSON.stringify(saved));
        const { result } = renderConfigStoreHook();
        expect(result.current?.mvConfig?.title).toBe('保存済みプロジェクト');
        expect(result.current?.mvConfig?.lyrics).toHaveLength(1);
    });
});
