//==============================================================================
// Voice to MIDI ピアノロール風ノートオーバーレイ描画
// 録音音声の波形・ピッチ曲線の上に、抽出された音符バーを直感的に重ねて描画する
//==============================================================================

import React from 'react';
import type { ExtractedMidiNote } from './types';

interface VoiceToMidiOverlayProps {
    notes: ExtractedMidiNote[];
    totalDurationSec: number;
    width: number;
    height: number;
    minMidi?: number;
    maxMidi?: number;
}

export const VoiceToMidiOverlay: React.FC<VoiceToMidiOverlayProps> = ({
    notes,
    totalDurationSec,
    width,
    height,
    minMidi = 36, // C2
    maxMidi = 84, // C6
}) => {
    if (notes.length === 0 || totalDurationSec <= 0 || width <= 0 || height <= 0) {
        return null;
    }

    const midiRange = Math.max(12, maxMidi - minMidi);

    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                overflow: 'hidden',
            }}
        >
            {notes.map((note) => {
                const left = (note.startSeconds / totalDurationSec) * width;
                const noteWidth = Math.max(
                    6,
                    ((note.endSeconds - note.startSeconds) / totalDurationSec) * width
                );

                // Y座標（ピッチが高いほど上）
                const normPitch = Math.max(0, Math.min(1, (note.midi - minMidi) / midiRange));
                const top = (1.0 - normPitch) * (height - 30) + 10;

                return (
                    <div
                        key={note.id}
                        style={{
                            position: 'absolute',
                            left,
                            top,
                            width: noteWidth,
                            height: 18,
                            background: 'linear-gradient(180deg, #00d2d3 0%, #00a8a8 100%)',
                            border: '1px solid #70e0ff',
                            borderRadius: 3,
                            boxShadow: '0 2px 8px rgba(0, 210, 211, 0.45)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0 4px',
                            color: '#06101e',
                            fontWeight: 900,
                            fontSize: 9.5,
                            fontFamily: 'monospace',
                            letterSpacing: '-0.3px',
                            zIndex: 10,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                        }}
                        title={`${note.noteName} (MIDI ${note.midi}) | ${note.startSeconds.toFixed(2)}s - ${note.endSeconds.toFixed(2)}s (${(note.duration * 1000).toFixed(0)}ms)`}
                    >
                        {note.noteName}
                    </div>
                );
            })}
        </div>
    );
};
