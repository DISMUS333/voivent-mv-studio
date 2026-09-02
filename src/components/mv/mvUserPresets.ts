//==============================================================================
// MV ユーザープリセットの保存・読み込み・共有（JSON 入出力）ロジック。
// localStorage への永続化と、ファイル経由でのインポート／エクスポートを提供。
//==============================================================================
import type { MvProjectConfig } from './types';
import { getDict } from '../../i18n';

/** ユーザープリセット 1 件分 */
export interface MvUserPreset {
    id: string;
    name: string;
    savedAt: number;
    config: MvProjectConfig;
}

const PRESET_KEY = 'voivent_mv_user_presets_v1';
const PRESET_FORMAT_VERSION = 1;

/** 共有ファイル形式（エクスポート／インポート共通） */
export interface MvPresetShareFile {
    format: 'voivent-mv-preset';
    version: number;
    name: string;
    savedAt: number;
    config: MvProjectConfig;
}

/** 全ユーザープリセットを読み込む */
export function loadUserPresets(): MvUserPreset[] {
    try {
        const raw = localStorage.getItem(PRESET_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as MvUserPreset[];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((p) => p && typeof p.id === 'string' && p.config);
    } catch {
        return [];
    }
}

/** プリセット配列を localStorage へ保存する */
function saveAll(presets: MvUserPreset[]): void {
    try {
        localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    } catch {
        // 容量超過時は無視（呼び出し元で通知）
    }
}

/** 現在の設定を新規プリセットとして保存する */
export function saveUserPreset(name: string, config: MvProjectConfig): MvUserPreset[] {
    const presets = loadUserPresets();
    const preset: MvUserPreset = {
        id: `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || getDict().untitledPreset,
        savedAt: Date.now(),
        config: JSON.parse(JSON.stringify(config)) as MvProjectConfig,
    };
    const next = [...presets, preset];
    saveAll(next);
    return next;
}

/** 指定プリセットを削除する */
export function deleteUserPreset(id: string): MvUserPreset[] {
    const next = loadUserPresets().filter((p) => p.id !== id);
    saveAll(next);
    return next;
}

/** プリセット名を変更する */
export function renameUserPreset(id: string, newName: string): MvUserPreset[] {
    const next = loadUserPresets().map((p) =>
        p.id === id ? { ...p, name: newName.trim() || p.name } : p,
    );
    saveAll(next);
    return next;
}

/** 既存プリセットを現在の設定で上書き保存する */
export function overwriteUserPreset(id: string, config: MvProjectConfig): MvUserPreset[] {
    const next = loadUserPresets().map((p) =>
        p.id === id
            ? { ...p, savedAt: Date.now(), config: JSON.parse(JSON.stringify(config)) as MvProjectConfig }
            : p,
    );
    saveAll(next);
    return next;
}

/** プリセットを共有ファイル形式へシリアライズする */
export function exportPresetToJson(preset: MvUserPreset): string {
    const file: MvPresetShareFile = {
        format: 'voivent-mv-preset',
        version: PRESET_FORMAT_VERSION,
        name: preset.name,
        savedAt: preset.savedAt,
        config: preset.config,
    };
    return JSON.stringify(file, null, 2);
}

/**
 * 共有ファイル形式の JSON をパースしてプリセットへ変換する。
 * 形式不正時は null を返す。
 *
 * 自動救済 (2026-08): format ヘッダーが無くても config 形状 (scenes 配列を含む
 * オブジェクト、または scenes 直配列) なら生プロジェクトとみなしてラップする。
 * エージェント / 外部ツールが生成した JSON の取り込み事故を防ぐ。
 */
export function importPresetFromJson(text: string): MvUserPreset | null {
    try {
        const parsed = JSON.parse(text) as Partial<MvPresetShareFile> | MvProjectConfig | MvProjectConfig[];
        // 正規形式: format ヘッダー付き
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as Partial<MvPresetShareFile>).format === 'voivent-mv-preset') {
            const file = parsed as Partial<MvPresetShareFile>;
            if (!file.config || !Array.isArray(file.config.scenes)) return null;
            return {
                id: `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
                name: (file.name || getDict().importedPreset).trim(),
                savedAt: typeof file.savedAt === 'number' ? file.savedAt : Date.now(),
                config: file.config as MvProjectConfig,
            };
        }
        // 救済 1: 生の MvProjectConfig (scenes 配列を持つオブジェクト)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as MvProjectConfig).scenes)) {
            return {
                id: `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
                name: getDict().importedPreset,
                savedAt: Date.now(),
                config: parsed as MvProjectConfig,
            };
        }
        // 救済 2: scenes 配列そのものがルート (簡易出力)
        if (Array.isArray(parsed)) {
            const looksLikeScenes = parsed.every((s) => s && typeof s === 'object' && typeof (s as { startTime?: unknown }).startTime === 'number');
            if (looksLikeScenes && parsed.length > 0) {
                return {
                    id: `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
                    name: getDict().importedPreset,
                    savedAt: Date.now(),
                    config: { scenes: parsed } as unknown as MvProjectConfig,
                };
            }
        }
        return null;
    } catch {
        return null;
    }
}