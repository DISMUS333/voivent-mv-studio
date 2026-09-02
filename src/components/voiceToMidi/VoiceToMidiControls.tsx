//==============================================================================
// Voice to MIDI コントロールパネル（インダストリアル機材デザイン）
// 感度、ノイズゲート、最小音長、スケール吸着、プレビュー＆タイムライン送信
//==============================================================================

import React from 'react';
import { IconPiano, IconSliders, IconCheck, IconTrash } from '../Icons';
import type { MusicalScale, VoiceToMidiSettings } from './types';

interface VoiceToMidiControlsProps {
    settings: VoiceToMidiSettings;
    onChangeSettings: (newSettings: VoiceToMidiSettings) => void;
    extractedCount: number;
    isInserting: boolean;
    onInsertToTimeline: () => void;
    onClearNotes: () => void;
    selectedTrackName?: string;
}

const ROOT_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALES: { id: MusicalScale; label: string }[] = [
    { id: 'chromatic', label: '半音階 (Off)' },
    { id: 'major', label: 'Major (長音階)' },
    { id: 'minor', label: 'Minor (短音階)' },
    { id: 'dorian', label: 'Dorian' },
    { id: 'pentatonic_major', label: 'Pentatonic Major' },
    { id: 'pentatonic_minor', label: 'Pentatonic Minor' },
];

export const VoiceToMidiControls: React.FC<VoiceToMidiControlsProps> = ({
    settings,
    onChangeSettings,
    extractedCount,
    isInserting,
    onInsertToTimeline,
    onClearNotes,
    selectedTrackName,
}) => {
    return (
        <div
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                background: 'linear-gradient(180deg, #182232 0%, #0f1622 100%)',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '10px 16px',
                borderRadius: '0 0 6px 6px',
                color: '#e0e6ed',
                fontSize: 12,
            }}
        >
            {/* 左側：パラメータ調整（ノイズゲート・最小音長・スケール） */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
                {/* 🎚️ スケール吸着 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#8fa2b6', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <IconSliders size={13} color="#00d2d3" />
                        <span>スケール吸着:</span>
                    </span>
                    <select
                        value={settings.rootKey}
                        onChange={(e) =>
                            onChangeSettings({ ...settings, rootKey: Number(e.target.value) })
                        }
                        style={{
                            background: '#0d131d',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: 4,
                            color: '#00d2d3',
                            fontWeight: 800,
                            padding: '3px 6px',
                            fontSize: 11,
                            cursor: 'pointer',
                        }}
                    >
                        {ROOT_KEYS.map((k, i) => (
                            <option key={k} value={i}>
                                {k}
                            </option>
                        ))}
                    </select>
                    <select
                        value={settings.scale}
                        onChange={(e) =>
                            onChangeSettings({ ...settings, scale: e.target.value as MusicalScale })
                        }
                        style={{
                            background: '#0d131d',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: 4,
                            color: '#fff',
                            fontWeight: 600,
                            padding: '3px 8px',
                            fontSize: 11,
                            cursor: 'pointer',
                        }}
                    >
                        {SCALES.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* 🎚️ ノイズゲート */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#8fa2b6', fontWeight: 600 }}>ノイズゲート:</span>
                    <input
                        type="range"
                        min="0.01"
                        max="0.15"
                        step="0.01"
                        value={settings.noiseGateThreshold}
                        onChange={(e) =>
                            onChangeSettings({
                                ...settings,
                                noiseGateThreshold: Number(e.target.value),
                            })
                        }
                        style={{ width: 64, cursor: 'pointer', accentColor: '#00d2d3' }}
                        title="息や環境ノイズをカットするしきい値"
                    />
                    <span style={{ color: '#00d2d3', fontFamily: 'monospace', fontWeight: 700, minWidth: 32 }}>
                        {Math.round(settings.noiseGateThreshold * 100)}%
                    </span>
                </div>

                {/* 🎚️ 最小音長 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#8fa2b6', fontWeight: 600 }}>最小音長:</span>
                    <input
                        type="range"
                        min="0.04"
                        max="0.25"
                        step="0.01"
                        value={settings.minNoteDurationSec}
                        onChange={(e) =>
                            onChangeSettings({
                                ...settings,
                                minNoteDurationSec: Number(e.target.value),
                            })
                        }
                        style={{ width: 64, cursor: 'pointer', accentColor: '#00d2d3' }}
                        title="短すぎるカス音符を自動排除する長さ（秒）"
                    />
                    <span style={{ color: '#00d2d3', fontFamily: 'monospace', fontWeight: 700, minWidth: 36 }}>
                        {(settings.minNoteDurationSec * 1000).toFixed(0)}ms
                    </span>
                </div>

                {/* 🎚️ ピッチ平滑化 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#8fa2b6', fontWeight: 600 }}>ピッチ安定化:</span>
                    <input
                        type="range"
                        min="1"
                        max="7"
                        step="2"
                        value={settings.pitchSmoothing}
                        onChange={(e) =>
                            onChangeSettings({
                                ...settings,
                                pitchSmoothing: Number(e.target.value),
                            })
                        }
                        style={{ width: 50, cursor: 'pointer', accentColor: '#00d2d3' }}
                        title="声のしゃくりやビブラートを滑らかに安定化"
                    />
                    <span style={{ color: '#00d2d3', fontFamily: 'monospace', fontWeight: 700 }}>
                        {settings.pitchSmoothing === 1 ? 'OFF' : `Lv.${settings.pitchSmoothing}`}
                    </span>
                </div>
            </div>

            {/* 右側：抽出ステータス ＆ アクションボタン */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* 抽出音符数バッジ */}
                <div
                    style={{
                        background: extractedCount > 0 ? 'rgba(0, 210, 211, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${extractedCount > 0 ? 'rgba(0, 210, 211, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                        borderRadius: 4,
                        padding: '3px 8px',
                        color: extractedCount > 0 ? '#00d2d3' : '#6b7c93',
                        fontWeight: 800,
                        fontSize: 11,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                    }}
                >
                    <IconPiano size={12} color={extractedCount > 0 ? '#00d2d3' : '#6b7c93'} />
                    <span>検出: {extractedCount} 音符</span>
                </div>

                {/* タイムライン配置ボタン */}
                <button
                    onClick={onInsertToTimeline}
                    disabled={extractedCount === 0 || isInserting}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background:
                            extractedCount > 0
                                ? 'linear-gradient(180deg, #00d2d3 0%, #00a8a8 100%)'
                                : 'rgba(255, 255, 255, 0.08)',
                        color: extractedCount > 0 ? '#0a101d' : '#6b7c93',
                        border: 'none',
                        borderRadius: 4,
                        padding: '6px 14px',
                        fontWeight: 900,
                        fontSize: 12,
                        cursor: extractedCount > 0 && !isInserting ? 'pointer' : 'not-allowed',
                        boxShadow:
                            extractedCount > 0 ? '0 2px 8px rgba(0, 210, 211, 0.35)' : 'none',
                        transition: 'all 0.15s ease',
                    }}
                    title={
                        selectedTrackName
                            ? `選択中の [${selectedTrackName}] トラックへ MIDI クリップとして配置`
                            : 'タイムラインへ MIDI クリップとして配置'
                    }
                >
                    <IconCheck size={14} color={extractedCount > 0 ? '#0a101d' : '#6b7c93'} />
                    <span>{isInserting ? '配置中...' : 'タイムラインへ配置'}</span>
                </button>
            </div>
        </div>
    );
};
