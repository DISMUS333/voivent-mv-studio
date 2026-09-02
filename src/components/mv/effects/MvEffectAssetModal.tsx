//==============================================================================
// MvEffectAssetModal.tsx - FX アセットライブラリ＆保存モーダル
//==============================================================================

import React, { useState } from 'react';
import type { MvEffectAsset, MvEffectClip } from './types';
import { BUILT_IN_EFFECT_ASSETS } from './builtInEffectAssets';
import { IconSparkles, IconClose, IconPlus, IconTrash } from '../../Icons';
import { useI18n } from '../../../i18n';

export interface MvEffectAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
    customAssets: MvEffectAsset[];
    onSaveAsset: (asset: MvEffectAsset) => void;
    onDeleteCustomAsset: (id: string) => void;
    onAddEffectToTimeline: (asset: MvEffectAsset, startTimeSec: number, durationSec: number) => void;
    currentPlayheadSec: number;
    selectedClip?: MvEffectClip | null;
}

export const MvEffectAssetModal: React.FC<MvEffectAssetModalProps> = ({
    isOpen,
    onClose,
    customAssets,
    onSaveAsset,
    onDeleteCustomAsset,
    onAddEffectToTimeline,
    currentPlayheadSec,
    selectedClip,
}) => {
    const { t } = useI18n();
    const [tab, setTab] = useState<'all' | 'custom' | 'builtin'>('all');
    const [saveName, setSaveName] = useState<string>('');
    const [saveDesc, setSaveDesc] = useState<string>('');
    const [isSaving, setIsSaving] = useState<boolean>(false);

    if (!isOpen) return null;

    const localizedBuiltInAssets = BUILT_IN_EFFECT_ASSETS.map((asset) => {
        const copies: Record<string, { name: string; description: string }> = {
            preset_fx_rgb_glitch: { name: t.fxRgbGlitchName, description: t.fxRgbGlitchDesc },
            preset_fx_film_grain: { name: t.fxFilmGrainName, description: t.fxFilmGrainDesc },
            preset_fx_vhs_distortion: { name: t.fxVhsName, description: t.fxVhsDesc },
            preset_fx_bloom_glow: { name: t.fxBloomName, description: t.fxBloomDesc },
            preset_fx_camera_zoom_pan: { name: t.fxCameraKickName, description: t.fxCameraKickDesc },
            preset_fx_invert_flash: { name: t.fxInvertName, description: t.fxInvertDesc },
            preset_fx_lens_blur: { name: t.fxLensBlurName, description: t.fxLensBlurDesc },
        };
        const copy = copies[asset.id];
        return copy ? { ...asset, ...copy } : asset;
    });

    const allAssets: MvEffectAsset[] = [
        ...customAssets,
        ...localizedBuiltInAssets,
    ];

    const displayedAssets = allAssets.filter((a) => {
        if (tab === 'custom') return a.isCustom;
        if (tab === 'builtin') return !a.isCustom;
        return true;
    });

    // 選択中クリップをマイアセット保存
    const handleSaveSelectedClip = () => {
        if (!selectedClip || !saveName.trim()) return;
        const newAsset: MvEffectAsset = {
            id: `custom_fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: saveName.trim(),
            kind: selectedClip.kind,
            description: saveDesc.trim() || `${selectedClip.name} から保存したカスタムエフェクト`,
            intensity: selectedClip.intensity ?? 1.0,
            shaderCode: selectedClip.shaderCode,
            cssCode: selectedClip.cssCode,
            params: selectedClip.params,
            savedAt: Date.now(),
            isCustom: true,
            colorTag: '#38bdf8',
        };
        onSaveAsset(newAsset);
        setSaveName('');
        setSaveDesc('');
        setIsSaving(false);
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                style={{
                    width: 580,
                    maxHeight: '85vh',
                    background: '#111827',
                    border: '1px solid #374151',
                    borderRadius: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
                    overflow: 'hidden',
                }}
            >
                {/* ヘッダー */}
                <div
                    style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid #1f2937',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: '#0f172a',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <IconSparkles size={16} color="#38bdf8" />
                        <span style={{ fontSize: 13, fontWeight: 900, color: '#f8fafc', letterSpacing: '0.05em' }}>
                            {t.effectLibraryTitle}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        title={t.close}
                        style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
                    >
                        <IconClose size={14} color="#94a3b8" />
                    </button>
                </div>

                {/* タブ ＆ 保存ボタン */}
                <div
                    style={{
                        padding: '8px 16px',
                        borderBottom: '1px solid #1f2937',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: '#131d2e',
                    }}
                >
                    <div style={{ display: 'flex', gap: 6 }}>
                        {(['all', 'builtin', 'custom'] as const).map((tabId) => (
                            <button
                                key={tabId}
                                onClick={() => setTab(tabId)}
                                style={{
                                    background: tab === tabId ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                                    border: `1px solid ${tab === tabId ? '#38bdf8' : 'rgba(255,255,255,0.1)'}`,
                                    borderRadius: 4,
                                    color: tab === tabId ? '#38bdf8' : '#94a3b8',
                                    fontSize: 10,
                                    fontWeight: 800,
                                    padding: '3px 8px',
                                    cursor: 'pointer',
                                }}
                            >
                            {tabId === 'all' ? t.effectTabAll : tabId === 'builtin' ? t.effectTabBuiltin : t.effectTabCustom(customAssets.length)}
                            </button>
                        ))}
                    </div>

                    {selectedClip && !isSaving && (
                        <button
                            onClick={() => {
                                setSaveName(selectedClip.name);
                                setIsSaving(true);
                            }}
                            style={{
                                background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                                border: '1px solid #38bdf8',
                                borderRadius: 4,
                                color: '#e7edf4',
                                fontSize: 10,
                                fontWeight: 800,
                                padding: '3px 10px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                            }}
                        >
                            <IconPlus size={10} color="#e7edf4" />
                            <span>{t.effectSaveSelected}</span>
                        </button>
                    )}
                </div>

                {/* 保存フォーム（展開時） */}
                {isSaving && (
                    <div style={{ padding: '12px 16px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8' }}>{t.effectSaveTitle}</div>
                        <input
                            type="text"
                            placeholder={t.effectNamePlaceholder}
                            value={saveName}
                            onChange={(e) => setSaveName(e.target.value)}
                            style={{ background: '#0f172a', border: '1px solid #475569', borderRadius: 4, color: '#f8fafc', padding: '6px 8px', fontSize: 11 }}
                        />
                        <input
                            type="text"
                            placeholder={t.effectDescriptionPlaceholder}
                            value={saveDesc}
                            onChange={(e) => setSaveDesc(e.target.value)}
                            style={{ background: '#0f172a', border: '1px solid #475569', borderRadius: 4, color: '#f8fafc', padding: '6px 8px', fontSize: 11 }}
                        />
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setIsSaving(false)}
                                style={{ background: 'transparent', border: '1px solid #64748b', borderRadius: 4, color: '#cbd5e1', fontSize: 10, padding: '4px 10px', cursor: 'pointer' }}
                            >
                                {t.cancel}
                            </button>
                            <button
                                onClick={handleSaveSelectedClip}
                                disabled={!saveName.trim()}
                                style={{ background: '#0284c7', border: 'none', borderRadius: 4, color: '#e7edf4', fontSize: 10, fontWeight: 800, padding: '4px 12px', cursor: saveName.trim() ? 'pointer' : 'not-allowed' }}
                            >
                                {t.save}
                            </button>
                        </div>
                    </div>
                )}

                {/* アセットリスト */}
                <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {displayedAssets.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 11 }}>
                            {t.effectNoSavedAssets}
                        </div>
                    ) : (
                        displayedAssets.map((asset) => (
                            <div
                                key={asset.id}
                                style={{
                                    background: '#1a2234',
                                    border: '1px solid #2d3748',
                                    borderRadius: 6,
                                    padding: '10px 12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 12,
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                        <span style={{ fontSize: 11, fontWeight: 900, color: '#f8fafc' }}>{asset.name}</span>
                                        {asset.isCustom && (
                                            <span style={{ fontSize: 8, fontWeight: 800, background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '1px 4px', borderRadius: 2 }}>
                                                CUSTOM
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.3 }}>{asset.description}</div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <button
                                        onClick={() => {
                                            onAddEffectToTimeline(asset, currentPlayheadSec, 4.0);
                                            onClose();
                                        }}
                                        title={t.effectPlaceTitle(currentPlayheadSec.toFixed(1))}
                                        style={{
                                            background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                                            border: '1px solid #38bdf8',
                                            borderRadius: 4,
                                            color: '#e7edf4',
                                            fontSize: 10,
                                            fontWeight: 800,
                                            padding: '4px 10px',
                                            cursor: 'pointer',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {t.effectPlaceOnTimeline}
                                    </button>

                                    {asset.isCustom && (
                                        <button
                                            onClick={() => onDeleteCustomAsset(asset.id)}
                                            title={t.delete}
                                            style={{ background: 'none', border: 'none', color: '#f43f5e', cursor: 'pointer', padding: 4 }}
                                        >
                                            <IconTrash size={12} color="#f43f5e" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
