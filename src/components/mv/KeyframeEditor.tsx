//==============================================================================
// MV シーン キーフレーム編集 UI。
// プロパティごとのキーフレーム列をリスト形式で追加・編集・削除する。
// 編集ロジックは mvKeyframeEditor.ts の純粋関数へ委譲し、このファイルは
// 描画と入力ハンドリングのみを担う（単一責務・肥大化防止）。
//==============================================================================
import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { IconPlus, IconTrash } from '../Icons';
import type { KeyframeProperty, MvKeyframe, SceneKeyframes } from './types';
import {
    getEasingOptions,
    getKeyframePropertyDefs,
    addKeyframe,
    clearKeyframeProperty,
    removeKeyframe,
    updateKeyframe,
} from './mvKeyframeEditor';

interface KeyframeEditorProps {
    keyframes: SceneKeyframes | undefined;
    onChange: (next: SceneKeyframes | undefined) => void;
}

const inputStyle: React.CSSProperties = {
    background: '#0a0d14',
    border: '1px solid #334155',
    color: '#e2e8f0',
    borderRadius: 4,
    padding: '2px 5px',
    fontSize: 10.5,
    outline: 'none',
};

export const KeyframeEditor: React.FC<KeyframeEditorProps> = ({ keyframes, onChange }) => {
    const { t } = useI18n();
    const propDefs = getKeyframePropertyDefs();
    const easingOptions = getEasingOptions();
    // 新規追加用の選択プロパティ
    const [newProp, setNewProp] = useState<KeyframeProperty>('opacity');

    const propDefOf = (id: KeyframeProperty) =>
        propDefs.find((d) => d.id === id) ?? propDefs[0];

    const handleAddProperty = () => {
        const def = propDefOf(newProp);
        if (keyframes?.[newProp]?.length) return; // 既存プロパティは再追加しない
        const next = addKeyframe(keyframes ?? {}, newProp, {
            t: 0,
            value: def.defaultValue,
            easing: 'linear',
        });
        // 終点フレームも併せて追加（t=1）
        const withEnd = addKeyframe(next, newProp, {
            t: 1,
            value: def.defaultValue,
            easing: 'linear',
        });
        onChange(withEnd);
    };

    const handleAddFrame = (prop: KeyframeProperty) => {
        const def = propDefOf(prop);
        const list = keyframes?.[prop] ?? [];
        // 既存フレームの中間時刻に挿入
        let t = 0.5;
        for (let i = 0; i < list.length - 1; i++) {
            const gap = (list[i + 1].t - list[i].t) / 2;
            if (gap > 0.05) {
                t = list[i].t + gap;
                break;
            }
        }
        onChange(addKeyframe(keyframes ?? {}, prop, { t, value: def.defaultValue, easing: list[list.length - 1]?.easing ?? 'linear' }));
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* プロパティ追加 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8' }}>{t.kfPropertyLabel}</span>
                <select
                    value={newProp}
                    onChange={(e) => setNewProp(e.target.value as KeyframeProperty)}
                    style={{ ...inputStyle, flex: 1 }}
                >
                    {propDefs.map((d) => (
                        <option key={d.id} value={d.id}>
                            {d.label}
                        </option>
                    ))}
                </select>
                <button
                    onClick={handleAddProperty}
                    disabled={Boolean(keyframes?.[newProp]?.length)}
                    title={t.kfRecordTitle}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: '#2563eb', color: '#e7edf4', border: 'none',
                        borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 800,
                        cursor: keyframes?.[newProp]?.length ? 'not-allowed' : 'pointer',
                        opacity: keyframes?.[newProp]?.length ? 0.5 : 1,
                    }}
                >
                    <IconPlus size={11} color="#e7edf4" />
                    <span>{t.kfAdd}</span>
                </button>
            </div>

            {/* 登録済みプロパティごとのエディタ */}
            {!keyframes || Object.keys(keyframes).length === 0 ? (
                <div style={{ fontSize: 9.5, color: '#64748b', lineHeight: 1.5 }}>
                    {t.kfEmptyHint}
                    <br />
                    {t.kfProgressNote}
                </div>
            ) : (
                Object.entries(keyframes).map(([rawProp, list]) => {
                    const prop = rawProp as KeyframeProperty;
                    const def = propDefOf(prop);
                    return (
                        <div
                            key={prop}
                            style={{
                                border: '1px solid #283548',
                                borderRadius: 6,
                                padding: '7px 9px',
                                background: 'rgba(15, 20, 30, 0.55)',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                                <span style={{ fontSize: 10.5, fontWeight: 900, color: '#7dd3fc' }}>{def.label}</span>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    <button
                                        onClick={() => handleAddFrame(prop)}
                                        title={t.kfAddMid}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 3,
                                            background: '#161c28', color: '#94a3b8',
                                            border: '1px solid #283548', borderRadius: 4,
                                            padding: '2px 7px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer',
                                        }}
                                    >
                                        <IconPlus size={10} color="#94a3b8" />
                                        <span>{t.kfFrame}</span>
                                    </button>
                                    <button
                                        onClick={() => onChange(clearKeyframeProperty(keyframes ?? {}, prop))}
                                        title={t.kfClearAllTitle}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 3,
                                            background: '#161c28', color: '#ef4444',
                                            border: '1px solid #283548', borderRadius: 4,
                                            padding: '2px 7px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer',
                                        }}
                                    >
                                        <IconTrash size={10} color="#ef4444" />
                                        <span>{t.kfClearAll}</span>
                                    </button>
                                </div>
                            </div>

                            {/* フレーム行 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {(list ?? []).map((kf, idx) => (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace', width: 34 }}>
                                            #{idx + 1}
                                        </span>
                                        <label style={{ fontSize: 9, color: '#94a3b8' }}>{t.kfPosLabel}</label>
                                        <input
                                            type="number" min={0} max={1} step={0.01}
                                            value={Number(kf.t.toFixed(3))}
                                            onChange={(e) =>
                                                onChange(updateKeyframe(keyframes ?? {}, prop, idx, {
                                                    t: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)),
                                                }))
                                            }
                                            style={{ ...inputStyle, width: 58 }}
                                        />
                                        <label style={{ fontSize: 9, color: '#94a3b8' }}>{t.kfValueLabel}</label>
                                        <input
                                            type="number" min={def.min} max={def.max} step={def.step}
                                            value={Number(kf.value.toFixed(3))}
                                            onChange={(e) =>
                                                onChange(updateKeyframe(keyframes ?? {}, prop, idx, {
                                                    value: Math.max(def.min, Math.min(def.max, parseFloat(e.target.value) || 0)),
                                                }))
                                            }
                                            style={{ ...inputStyle, width: 62 }}
                                        />
                                        <select
                                            value={kf.easing ?? 'linear'}
                                            onChange={(e) =>
                                                onChange(updateKeyframe(keyframes ?? {}, prop, idx, {
                                                    easing: e.target.value as NonNullable<MvKeyframe['easing']>,
                                                }))
                                            }
                                            title={t.kfEasingTitle}
                                            style={{ ...inputStyle, flex: 1 }}
                                        >
                                            {easingOptions.map((o: { id: NonNullable<MvKeyframe['easing']>; label: string }) => (
                                                <option key={o.id} value={o.id}>{o.label}</option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={() => onChange(removeKeyframe(keyframes ?? {}, prop, idx))}
                                            title={t.kfDeleteTitle}
                                            style={{
                                                background: 'transparent', border: 'none',
                                                cursor: 'pointer', padding: 2, display: 'flex',
                                            }}
                                        >
                                            <IconTrash size={12} color="#ef4444" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
};
