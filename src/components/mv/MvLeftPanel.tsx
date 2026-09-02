//==============================================================================
// MV ワークスペース左ペイン。
// シーン一覧（追加・複製・削除・選択）、世界観プリセット適用、
// 素材ライブラリ管理を担う。幅 240px 固定。
//==============================================================================
import React, { useState, useMemo, useCallback } from 'react';
import {
    IconCopy,
    IconDownload,
    IconFolder,
    IconPlus,
    IconSave,
    IconTrash,
} from '../Icons';
import type { MvImageAsset, MvProjectConfig } from './types';
import { getDefaultMvPresets } from './presets/mvPresets';
import {
    deleteUserPreset,
    exportPresetToJson,
    importPresetFromJson,
    loadUserPresets,
    overwriteUserPreset,
    renameUserPreset,
    saveUserPreset,
} from './mvUserPresets';
import type { MvUserPreset } from './mvUserPresets';
import { sortScenes } from './mvSceneUtils';
import { useTheme } from '../../hooks/useTheme';
import { withAlpha } from '../../theme';
import { useI18n } from '../../i18n';

interface MvLeftPanelProps {
    config: MvProjectConfig;
    onUpdateConfig: (c: MvProjectConfig) => void;
    selectedSceneId: string | null;
    onSelectScene: (id: string) => void;
}

export const MvLeftPanel: React.FC<MvLeftPanelProps> = ({
    config,
    onUpdateConfig,
    selectedSceneId,
    onSelectScene,
}) => {
    const { theme } = useTheme();
    const { t } = useI18n();
    const [userPresets, setUserPresets] = useState<MvUserPreset[]>(() => loadUserPresets());
    const [newPresetName, setNewPresetName] = useState('');

    const handleSelectPreset = (presetKey: string) => {
        if (presetKey === config.activePresetId) return;
        const preset = getDefaultMvPresets()[presetKey];
        if (!preset) return;

        // ⚠️ プリセット適用確認ダイアログ
        if (!window.confirm(t.confirmApplyPreset(preset.title || presetKey))) {
            return;
        }

        // ⭐️ プリセット切り替え時もユーザーの素材ライブラリ (assets) と歌詞 (lyrics) は確実に保護・維持
        onUpdateConfig({
            ...preset,
            assets: config.assets ?? [],
            lyrics: config.lyrics,
            activePresetId: presetKey,
        });
    };

    const handleSaveUserPreset = () => {
        const name = newPresetName.trim() || `${t.myPresets} ${userPresets.length + 1}`;
        const updatedPresets = saveUserPreset(name, config);
        setUserPresets(updatedPresets);
        const savedOne = updatedPresets[updatedPresets.length - 1];
        if (savedOne) {
            onUpdateConfig({ ...config, activePresetId: savedOne.id });
        }
        setNewPresetName('');
    };

    const handleOverwriteUserPreset = (p: MvUserPreset) => {
        if (window.confirm(t.confirmOverwritePreset(p.name))) {
            const updated = overwriteUserPreset(p.id, config);
            setUserPresets(updated);
            onUpdateConfig({ ...config, activePresetId: p.id });
        }
    };

    const handleApplyUserPreset = (p: MvUserPreset) => {
        if (p.id === config.activePresetId) return;

        // ⚠️ マイプリセット適用確認ダイアログ
        if (!window.confirm(t.confirmApplyPreset(p.name))) {
            return;
        }

        // マイプリセットは保存された設定・歌詞を復元し、素材ライブラリはマージ
        const restored = JSON.parse(JSON.stringify(p.config)) as MvProjectConfig;
        const mergedAssets = [...(config.assets ?? [])];
        if (Array.isArray(restored.assets)) {
            for (const a of restored.assets) {
                if (!mergedAssets.some((existing) => existing.id === a.id)) {
                    mergedAssets.push(a);
                }
            }
        }
        // ⭐️ マイプリセットに保存されていた歌詞を復元（プリセット側に歌詞が無い場合のみ現行歌詞を維持）
        const restoredLyrics = (Array.isArray(restored.lyrics) && restored.lyrics.length > 0)
            ? restored.lyrics
            : config.lyrics;

        onUpdateConfig({
            ...restored,
            activePresetId: p.id,
            lyrics: restoredLyrics,
            assets: mergedAssets,
        });
    };

    const handleDeleteUserPreset = (id: string) => {
        setUserPresets(deleteUserPreset(id));
    };

    const handleRenameUserPreset = (id: string) => {
        const name = window.prompt(t.renamePresetPrompt);
        if (name != null && name.trim()) {
            setUserPresets(renameUserPreset(id, name));
        }
    };

    const handleExportUserPreset = (p: MvUserPreset) => {
        const blob = new Blob([exportPresetToJson(p)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${p.name.replace(/[\\/:*?"<>|]+/g, '_')}.voivent-mv.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportUserPresetFile = async (file: File) => {
        try {
            const text = await file.text();
            const imported = importPresetFromJson(text);
            if (!imported) {
                window.alert(t.invalidPresetFile);
                return;
            }

            if (!window.confirm(t.confirmApplyPreset(imported.name))) {
                return;
            }

            const updated = saveUserPreset(imported.name, imported.config);
            setUserPresets(updated);
            const savedOne = updated[updated.length - 1];
            if (savedOne) {
                const mergedAssets = [...(config.assets ?? [])];
                if (Array.isArray(imported.config.assets)) {
                    for (const a of imported.config.assets) {
                        if (!mergedAssets.some((existing) => existing.id === a.id)) {
                            mergedAssets.push(a);
                        }
                    }
                }
                const importedLyrics = (Array.isArray(imported.config.lyrics) && imported.config.lyrics.length > 0)
                    ? imported.config.lyrics
                    : config.lyrics;

                onUpdateConfig({
                    ...imported.config,
                    activePresetId: savedOne.id,
                    lyrics: importedLyrics,
                    assets: mergedAssets,
                });
            }
        } catch {
            window.alert(t.invalidPresetFile);
        }
    };

    // ── 素材ライブラリ操作（複数ファイル・ドラッグ＆ドロップ対応） ------------
    const [isAssetDragOver, setIsAssetDragOver] = useState(false);

    const handleAddAssetFiles = useCallback((files: FileList | File[]) => {
        const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
        if (imageFiles.length === 0) {
            window.alert(t.selectImageFile);
            return;
        }

        const readPromises = imageFiles.map((file) => {
            return new Promise<MvImageAsset | null>((resolve) => {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    const dataUrl = evt.target?.result as string;
                    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
                        resolve(null);
                        return;
                    }
                    resolve({
                        id: `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
                        name: file.name,
                        dataUrl,
                        addedAt: Date.now(),
                    });
                };
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(file);
            });
        });

        Promise.all(readPromises).then((newAssets) => {
            const valid = newAssets.filter((a): a is MvImageAsset => Boolean(a));
            if (valid.length > 0) {
                onUpdateConfig({ ...config, assets: [...(config.assets ?? []), ...valid] });
            }
        });
    }, [config, onUpdateConfig, t.selectImageFile]);

    const handleDeleteAsset = (id: string) => {
        // 背景として使用中のシーンからも参照を外す
        onUpdateConfig({
            ...config,
            assets: (config.assets ?? []).filter((a) => a.id !== id),
            scenes: config.scenes.map((s) =>
                s.backgroundImageId === id ? { ...s, backgroundImageId: undefined } : s,
            ),
        });
    };

    const sorted = sortScenes(config.scenes);

    return (
        <div style={{ width: 240, flexShrink: 0, borderRight: `1px solid ${theme.borderSubtle}`, background: theme.bgDeep, display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden' }}>
            {/* シーン一覧 */}
            <div style={{ padding: '10px 10px 6px', borderBottom: `1px solid ${theme.borderSubtle}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 900, color: theme.accentInfo, letterSpacing: '0.04em' }}>
                        {t.sceneList(config.scenes.length)}
                    </span>
                    <button
                        onClick={() => onSelectScene('__add__')}
                        title={t.addSceneHint}
                        style={{ background: theme.accentSecondary, color: theme.bgApp, border: 'none', borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
                    >
                        <IconPlus size={10} color={theme.bgApp} />
                        <span>{t.add}</span>
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {sorted.map((s, i) => {
                        const isSel = s.id === selectedSceneId;
                        return (
                            <button
                                key={s.id}
                                onClick={() => onSelectScene(s.id)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    background: isSel ? withAlpha(theme.accentInfo, 0.14) : theme.bgControl,
                                    border: `1px solid ${isSel ? theme.accentInfo : theme.border}`,
                                    borderRadius: 6,
                                    padding: '6px 9px',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    transition: 'all 0.12s ease',
                                }}
                            >
                                <span
                                    style={{
                                        flexShrink: 0,
                                        width: 26, height: 15,
                                        borderRadius: 3,
                                        background: isSel ? theme.accentInfo : theme.borderLight,
                                        border: '1px solid rgba(255,255,255,0.08)',
                                    }}
                                />
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: isSel ? theme.textMain : theme.textSubtle, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {i + 1}. {s.name}
                                    </span>
                                    <span style={{ display: 'block', fontSize: 9, color: theme.textMuted, fontFamily: 'monospace' }}>
                                        {s.startTime.toFixed(1)}s - {s.endTime.toFixed(1)}s
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 世界観プリセット */}
            <div style={{ padding: '10px 10px 6px', borderBottom: `1px solid ${theme.borderSubtle}` }}>
                <span style={{ fontSize: 10.5, fontWeight: 900, color: theme.accentSecondary, letterSpacing: '0.04em', display: 'block', marginBottom: 8 }}>
                    {t.worldPreset}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {Object.keys(getDefaultMvPresets()).map((key) => {
                        const preset = getDefaultMvPresets()[key];
                        if (!preset) return null;
                        const isSel = config.activePresetId === key;
                        return (
                            <button
                                key={key}
                                onClick={() => handleSelectPreset(key)}
                                title={t.presetApplyHint}
                                style={{
                                    padding: '7px 9px',
                                    background: isSel ? withAlpha(theme.accentSecondary, 0.18) : theme.bgControl,
                                    border: `1px solid ${isSel ? theme.accentSecondary : theme.border}`,
                                    borderRadius: 6,
                                    color: theme.textMain,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    transition: 'all 0.12s ease',
                                }}
                            >
                                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 900, color: isSel ? theme.accentSecondary : theme.textSubtle }}>
                                    {preset.title}
                                </span>
                                <span style={{ display: 'block', fontSize: 8.5, color: theme.textMuted, lineHeight: 1.35, marginTop: 2 }}>
                                    {key === 'pixel_glitch_minimal' && t.presetPixelGlitch}
                                    {key === 'cinematic_atmosphere' && t.presetCinematic}
                                    {key === 'lipsync_character' && t.presetLipsync}
                                    {key === 'blank_ai_canvas' && t.presetBlankAi}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* ── マイプリセット（自作保存・復元） ── */}
                <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${theme.border}` }}>
                    <div style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 900, color: theme.accentSecondary, letterSpacing: '0.04em', display: 'block' }}>
                            {t.myPresets}
                        </span>
                    </div>

                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                        <input
                            type="text"
                            value={newPresetName}
                            onChange={(e) => setNewPresetName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveUserPreset();
                            }}
                            placeholder={t.presetNamePlaceholder}
                            style={{
                                flex: 1,
                                minWidth: 0,
                                background: theme.bgInset,
                                border: `1px solid ${theme.borderLight}`,
                                color: theme.textMain,
                                padding: '5px 8px',
                                fontSize: 10.5,
                                borderRadius: 4,
                                outline: 'none',
                            }}
                        />
                        <button
                            onClick={handleSaveUserPreset}
                            title={t.savePresetHint}
                            style={{
                                background: theme.accentSecondary,
                                color: theme.bgApp,
                                border: 'none',
                                borderRadius: 4,
                                padding: '5px 10px',
                                fontSize: 10.5,
                                fontWeight: 900,
                                cursor: 'pointer',
                                flexShrink: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                            }}
                        >
                            <IconSave size={11} color={theme.bgApp} />
                            <span>{t.save}</span>
                        </button>
                    </div>

                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                        <label
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: theme.bgControl,
                                color: theme.accentSecondary,
                                border: `1px solid ${theme.borderLight}`,
                                borderRadius: 4,
                                padding: '4px 8px',
                                fontSize: 9.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                                width: '100%',
                                justifyContent: 'center',
                            }}
                            title={t.importPresetJsonHint}
                        >
                            <IconFolder size={11} color={theme.accentSecondary} />
                            <span>{t.importPresetJson}</span>
                            <input
                                type="file"
                                accept=".json,.txt"
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleImportUserPresetFile(f);
                                    e.target.value = '';
                                }}
                            />
                        </label>
                    </div>

                    {userPresets.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {userPresets.map((p) => {
                                const isUserSel = config.activePresetId === p.id;
                                return (
                                    <div
                                        key={p.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            background: isUserSel ? withAlpha(theme.accentSecondary, 0.18) : theme.bgControl,
                                            border: `1px solid ${isUserSel ? theme.accentSecondary : theme.border}`,
                                            borderRadius: 5,
                                            padding: '4px 6px',
                                            transition: 'all 0.12s ease',
                                        }}
                                    >
                                        <button
                                            onClick={() => handleApplyUserPreset(p)}
                                            title={t.applyPresetHint}
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                textAlign: 'left',
                                                background: 'transparent',
                                                border: 'none',
                                                color: isUserSel ? theme.accentSecondary : theme.textSubtle,
                                                fontSize: 9.5,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                padding: 0,
                                            }}
                                        >
                                            {p.name}
                                        </button>
                                        <button onClick={() => handleOverwriteUserPreset(p)} title={t.overwritePresetHint} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, fontSize: 9, fontWeight: 700, color: theme.warning }}>{t.overwrite}</button>
                                        <button onClick={() => handleRenameUserPreset(p.id)} title={t.rename} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, fontSize: 9, color: theme.textMuted }}>{t.rename}</button>
                                        <button onClick={() => handleExportUserPreset(p)} title={t.exportPresetHint} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                                            <IconDownload size={10} color={theme.accentInfo} />
                                        </button>
                                        <button onClick={() => handleDeleteUserPreset(p.id)} title={t.delete} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2 }}>
                                            <IconTrash size={10} color={theme.danger} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{ fontSize: 8.5, color: theme.textMuted, lineHeight: 1.4 }}>
                            {t.userPresetsEmpty}
                        </div>
                    )}
                </div>

                {/* ── シェーダー描画バックエンド（マシン単位のグローバル設定） ── */}
            </div>

            {/* 素材ライブラリ（ドラッグ＆ドロップゾーン対応） */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsAssetDragOver(true);
                }}
                onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setIsAssetDragOver(false);
                    }
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsAssetDragOver(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleAddAssetFiles(e.dataTransfer.files);
                    }
                }}
                style={{
                    flex: 1,
                    minHeight: 140,
                    padding: '10px 10px 14px',
                    position: 'relative',
                    background: isAssetDragOver ? withAlpha(theme.success, 0.15) : 'rgba(255, 255, 255, 0.02)',
                    border: isAssetDragOver ? `2px dashed ${theme.success}` : `1px dashed ${theme.borderLight}`,
                    borderRadius: 8,
                    margin: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'all 0.15s ease',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 900, color: theme.success, letterSpacing: '0.04em' }}>
                        {t.assets((config.assets ?? []).length)}
                    </span>
                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 3, background: theme.success, color: theme.bgApp, borderRadius: 4, padding: '2px 7px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}
                        title={t.addAssetHint}
                    >
                        <IconPlus size={10} color={theme.bgApp} />
                        <span>{t.add}</span>
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            style={{ display: 'none' }}
                            onChange={(e) => {
                                if (e.target.files && e.target.files.length > 0) {
                                    handleAddAssetFiles(e.target.files);
                                }
                                e.target.value = '';
                            }}
                        />
                    </label>
                </div>

                {/* ドラッグオーバー中のオーバーレイ */}
                {isAssetDragOver && (
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: withAlpha(theme.bgApp, 0.85),
                            borderRadius: 7,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            color: theme.success,
                            fontSize: 11,
                            fontWeight: 900,
                            zIndex: 10,
                            pointerEvents: 'none',
                        }}
                    >
                        <IconPlus size={20} color={theme.success} />
                        <span>{t.lpDropHere}</span>
                    </div>
                )}

                {(config.assets ?? []).length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 6 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                            {(config.assets ?? []).map((a) => (
                                <div
                                    key={a.id}
                                    draggable={true}
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('application/json', JSON.stringify({ type: 'mv-asset', asset: a }));
                                        e.dataTransfer.setData('text/plain', a.id);
                                        e.dataTransfer.effectAllowed = 'copy';
                                        // 素材画像の標準ドラッグゴーストがドロップ位置ガイドを隠すため、透明画像に置き換える。
                                        const blank = document.createElement('canvas');
                                        blank.width = 1;
                                        blank.height = 1;
                                        e.dataTransfer.setDragImage(blank, 0, 0);
                                    }}
                                    style={{
                                        position: 'relative',
                                        border: `1px solid ${theme.border}`,
                                        borderRadius: 5,
                                        overflow: 'hidden',
                                        background: theme.bgInset,
                                        cursor: 'grab',
                                        userSelect: 'none',
                                        WebkitUserSelect: 'none',
                                    }}
                                    title={t.lpAssetDropHint(a.name)}
                                >
                                    <img
                                        src={a.dataUrl}
                                        alt={a.name}
                                        style={{ width: '100%', height: 44, objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
                                    />
                                    <div style={{ fontSize: 8, color: theme.textMuted, padding: '2px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {a.name}
                                    </div>
                                    <button
                                        onClick={() => handleDeleteAsset(a.id)}
                                        title={t.deleteAssetHint}
                                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: 3, cursor: 'pointer', padding: 2 }}
                                    >
                                        <IconTrash size={9} color="#ef4444" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        {/* 枠いっぱいに広がるドロップ余白エリア */}
                        <div
                            style={{
                                flex: 1,
                                minHeight: 35,
                                border: `1px dashed rgba(255, 255, 255, 0.08)`,
                                borderRadius: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 8.5,
                                color: theme.textMuted,
                                textAlign: 'center',
                                padding: 4,
                            }}
                        >
                            {t.lpDropToAdd}
                        </div>
                    </div>
                ) : (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', fontSize: 8.5, color: theme.textMuted, lineHeight: 1.45, textAlign: 'center', padding: '16px 8px' }}>
                        <div>{t.assetsEmptyHint}</div>
                        <div style={{ marginTop: 8, fontSize: 8, color: theme.textMuted, border: `1px dashed ${theme.borderLight}`, borderRadius: 4, padding: '8px 12px', width: '100%' }}>
                            {t.lpDropHere}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
