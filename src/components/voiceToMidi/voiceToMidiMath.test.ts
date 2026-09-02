import { describe, expect, it } from 'vitest';
import { hzToMidiNote, snapToScale, extractMidiNotesFromVoice } from './voiceToMidiMath';
import type { VoiceToMidiSettings } from './types';

describe('voiceToMidiMath', () => {
    describe('hzToMidiNote', () => {
        it('440Hz は A4 (MIDI 69) になる', () => {
            expect(hzToMidiNote(440.0)).toBe(69);
        });

        it('261.63Hz は C4 (MIDI 60) になる', () => {
            expect(hzToMidiNote(261.63)).toBe(60);
        });

        it('無音 (0Hz) や負値は -1 を返す', () => {
            expect(hzToMidiNote(0)).toBe(-1);
            expect(hzToMidiNote(-100)).toBe(-1);
        });
    });

    describe('snapToScale', () => {
        it('Chromatic スケールではそのまま通過する', () => {
            expect(snapToScale(61, 'chromatic', 0)).toBe(61);
        });

        it('C Major スケール時、C#(61) は C(60) または D(62) に吸着する', () => {
            const snapped = snapToScale(61, 'major', 0); // Root: C (0)
            expect([60, 62]).toContain(snapped);
        });

        it('C Major スケール時、白鍵の音 (60, 62, 64, 65, 67, 69, 71) は維持される', () => {
            expect(snapToScale(60, 'major', 0)).toBe(60); // C4
            expect(snapToScale(64, 'major', 0)).toBe(64); // E4
            expect(snapToScale(67, 'major', 0)).toBe(67); // G4
        });
    });

    describe('extractMidiNotesFromVoice', () => {
        const defaultSettings: VoiceToMidiSettings = {
            noiseGateThreshold: 0.05,
            minNoteDurationSec: 0.08,
            pitchSmoothing: 1,
            scale: 'chromatic',
            rootKey: 0,
            velocitySensitivity: 1.0,
        };

        it('安定した440Hzの声からA4ノートが1本抽出される', () => {
            // 0.0s - 0.5s に 440Hz (A4) の声
            const times = Array.from({ length: 25 }, (_, i) => i * 0.02);
            const pitch = times.map(() => 440.0);
            const rms = times.map(() => 0.4);

            const notes = extractMidiNotesFromVoice(pitch, times, rms, defaultSettings);
            expect(notes.length).toBe(1);
            expect(notes[0].midi).toBe(69);
            expect(notes[0].noteName).toBe('A4');
            expect(notes[0].duration).toBeGreaterThanOrEqual(0.4);
        });

        it('ノイズゲート閾値未満の音は無視される', () => {
            const times = [0.0, 0.02, 0.04, 0.06, 0.08, 0.10];
            const pitch = [440, 440, 440, 440, 440, 440];
            const rms = [0.01, 0.01, 0.01, 0.01, 0.01, 0.01]; // 閾値 0.05 未満

            const notes = extractMidiNotesFromVoice(pitch, times, rms, defaultSettings);
            expect(notes.length).toBe(0);
        });

        it('短すぎるノイズ音符 (minNoteDurationSec未満) は除去される', () => {
            const times = [0.0, 0.02]; // 0.02秒のみ
            const pitch = [440, 440];
            const rms = [0.5, 0.5];

            const notes = extractMidiNotesFromVoice(pitch, times, rms, defaultSettings);
            expect(notes.length).toBe(0);
        });
    });
});
