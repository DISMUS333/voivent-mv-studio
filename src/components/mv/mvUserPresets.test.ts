//==============================================================================
// mvUserPresets.ts の単体テスト。
// プリセット JSON の入出力と、形式ヘッダー無しファイルの自動救済を検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { importPresetFromJson, exportPresetToJson, type MvUserPreset } from './mvUserPresets';
import type { MvProjectConfig } from './types';

const mkConfig = (): MvProjectConfig => ({
    title: 'Test',
    scenes: [{ id: 's1', name: 'A', startTime: 0, endTime: 10, phaserTheme: 'none', lyricEffect: 'none' }],
    lyrics: [],
} as unknown as MvProjectConfig);

describe('importPresetFromJson', () => {
    it('正規形式 (format ヘッダー付き) を読み込む', () => {
        const text = JSON.stringify({
            format: 'voivent-mv-preset',
            version: 1,
            name: '正規',
            savedAt: 123,
            config: mkConfig(),
        });
        const p = importPresetFromJson(text);
        expect(p).not.toBeNull();
        expect(p!.name).toBe('正規');
        expect(p!.config.scenes).toHaveLength(1);
    });

    it('救済: ヘッダー無しの生 config (get_mv_project 出力相当) も読み込む', () => {
        // エージェントが get_mv_project の中身をそのまま保存したケース
        const text = JSON.stringify(mkConfig());
        const p = importPresetFromJson(text);
        expect(p).not.toBeNull();
        expect(p!.config.scenes).toHaveLength(1);
        expect(p!.config.scenes[0].name).toBe('A');
    });

    it('救済: scenes 配列がルートの簡易 JSON も読み込む', () => {
        const text = JSON.stringify([{ id: 's1', name: 'A', startTime: 0, endTime: 10 }]);
        const p = importPresetFromJson(text);
        expect(p).not.toBeNull();
        expect(p!.config.scenes).toHaveLength(1);
    });

    it('全く無関係な JSON は null を返す', () => {
        expect(importPresetFromJson('{"foo": 1}')).toBeNull();
        expect(importPresetFromJson('[1, 2, 3]')).toBeNull();
        expect(importPresetFromJson('not json !!')).toBeNull();
        expect(importPresetFromJson('')).toBeNull();
    });
});

describe('exportPresetToJson ↔ importPresetFromJson の往復', () => {
    it('書き出したファイルは必ず読み込める', () => {
        const preset: MvUserPreset = {
            id: 'p1',
            name: '往復テスト',
            savedAt: 456,
            config: mkConfig(),
        };
        const text = exportPresetToJson(preset);
        const p = importPresetFromJson(text);
        expect(p).not.toBeNull();
        expect(p!.name).toBe('往復テスト');
        expect(p!.config.scenes[0].id).toBe('s1');
    });
});

describe('preset CRUD operations & overwriteUserPreset', () => {
    it('プリセットの保存・上書き・名前変更・削除が正常に動作する', async () => {
        const { saveUserPreset, overwriteUserPreset, renameUserPreset, deleteUserPreset, loadUserPresets } = await import('./mvUserPresets');
        localStorage.clear();

        // 1. 保存
        const cfg1 = mkConfig();
        const presets1 = saveUserPreset('ミク', cfg1);
        expect(presets1).toHaveLength(1);
        expect(presets1[0].name).toBe('ミク');

        // 2. 上書き
        const cfg2 = { ...cfg1, title: 'Updated Title' };
        const presets2 = overwriteUserPreset(presets1[0].id, cfg2);
        expect(presets2).toHaveLength(1);
        expect(presets2[0].name).toBe('ミク');
        expect(presets2[0].config.title).toBe('Updated Title');

        // 3. 名前変更
        const presets3 = renameUserPreset(presets1[0].id, 'ミク改');
        expect(presets3[0].name).toBe('ミク改');

        // 4. 削除
        const presets4 = deleteUserPreset(presets1[0].id);
        expect(presets4).toHaveLength(0);
        expect(loadUserPresets()).toHaveLength(0);
    });
});