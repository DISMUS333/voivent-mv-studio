//==============================================================================
// mvEffects.test.ts - MV エフェクトレーン＆アセットライブラリの単体テスト
//==============================================================================

import { describe, it, expect } from 'vitest';
import { ensureEffectClipIds, type MvEffectClip } from './types';
import { BUILT_IN_EFFECT_ASSETS } from './builtInEffectAssets';
import { getActiveEffectClips, computeEffectStyle } from './mvEffectRenderer';

describe('MV Effects System', () => {
    describe('ensureEffectClipIds', () => {
        it('should assign IDs to clips missing them', () => {
            const raw = [
                { name: 'Glitch 1', kind: 'rgb_glitch', startTime: 0, endTime: 4 },
                { id: 'custom_id', name: 'Flash', kind: 'beat_flash', startTime: 4, endTime: 8 },
            ] as unknown as MvEffectClip[];

            const result = ensureEffectClipIds(raw);
            expect(result).toHaveLength(2);
            expect(result[0].id).toMatch(/^fx_/);
            expect(result[1].id).toBe('custom_id');
        });

        it('should handle undefined input safely', () => {
            expect(ensureEffectClipIds(undefined)).toEqual([]);
        });
    });

    describe('builtInEffectAssets', () => {
        it('should contain default presets with unique IDs', () => {
            expect(BUILT_IN_EFFECT_ASSETS.length).toBeGreaterThan(4);
            const ids = BUILT_IN_EFFECT_ASSETS.map((a) => a.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
        });
    });

    describe('mvEffectRenderer', () => {
        const clips: MvEffectClip[] = [
            { id: 'fx1', name: 'Intro Grain', kind: 'film_grain', startTime: 0, endTime: 10, intensity: 0.8 },
            { id: 'fx2', name: 'Chorus Glitch', kind: 'rgb_glitch', startTime: 15, endTime: 30, intensity: 1.0 },
            { id: 'fx3', name: 'Drop Flash', kind: 'beat_flash', startTime: 20, endTime: 25, intensity: 0.9 },
        ];

        it('should extract active clips accurately by time', () => {
            expect(getActiveEffectClips(clips, 5)).toHaveLength(1);
            expect(getActiveEffectClips(clips, 5)[0].id).toBe('fx1');

            expect(getActiveEffectClips(clips, 12)).toHaveLength(0);

            const chorusClips = getActiveEffectClips(clips, 22);
            expect(chorusClips).toHaveLength(2);
            expect(chorusClips.map((c) => c.id)).toEqual(['fx2', 'fx3']);
        });

        it('should compute combined effect style and filter string', () => {
            const active = getActiveEffectClips(clips, 22);
            const style = computeEffectStyle(active, { beat: 0.8, low: 0.9, peak: 0.85 });

            expect(style.glitchActive).toBe(true);
            expect(style.glitchOffsetPx).toBeGreaterThan(0);
            expect(style.flashOpacity).toBe(0);
        });
    });
});
