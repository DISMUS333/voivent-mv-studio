//==============================================================================
// mvEffectRenderer.ts - タイムラインエフェクトのリアルタイム合成レンダラー
//==============================================================================

import type { MvEffectClip } from './types';

export interface ActiveEffectStyle {
    filter?: string;
    transform?: string;
    mixBlendMode?: string;
    opacity?: number;
    overlaySvg?: string;
    overlayCss?: string;
}

/**
 * 現在の再生時間（timeSeconds）においてアクティブなエフェクトクリップを抽出する
 */
export function getActiveEffectClips(
    effects: MvEffectClip[] | undefined,
    timeSeconds: number
): MvEffectClip[] {
    if (!effects || effects.length === 0) return [];
    return effects.filter(
        (fx) => fx.enabled !== false && timeSeconds >= fx.startTime && timeSeconds < fx.endTime
    );
}

/**
 * アクティブなエフェクトクリップ群とオーディオシグナルから合成スタイルを算出する
 */
export function computeEffectStyle(
    activeClips: MvEffectClip[],
    signals?: { beat?: number; low?: number; high?: number; peak?: number }
): {
    containerFilter: string;
    containerTransform: string;
    flashOpacity: number;
    flashColor: string;
    glitchActive: boolean;
    glitchOffsetPx: number;
    filmGrainOpacity: number;
    vhsActive: boolean;
    invertActive: boolean;
} {
    let brightness = 1.0;
    let contrast = 1.0;
    let blurPx = 0;
    let scale = 1.0;
    let flashOpacity = 0.0;
    let flashColor = '#ffffff';
    let glitchActive = false;
    let glitchOffsetPx = 0;
    let filmGrainOpacity = 0.0;
    let vhsActive = false;
    let invertActive = false;

    const beat = signals?.beat ?? 0;
    const low = signals?.low ?? 0;
    const peak = signals?.peak ?? 0;

    for (const fx of activeClips) {
        const intensity = fx.intensity ?? 1.0;

        switch (fx.kind) {
            // beat_flash は目への負担が大きいため、旧保存データでも無効化する。
            case 'beat_flash':
                break;
            case 'invert_flash': {
                if (beat > 0.6) {
                    invertActive = true;
                }
                break;
            }
            case 'rgb_glitch': {
                glitchActive = true;
                glitchOffsetPx = Math.max(glitchOffsetPx, (4 + beat * 12) * intensity);
                break;
            }
            case 'camera_zoom_pan': {
                // ビートに合わせて瞬間ズーム
                const zoomFactor = 1.0 + (beat * 0.08 + low * 0.04) * intensity;
                scale = Math.max(scale, zoomFactor);
                break;
            }
            case 'film_grain': {
                filmGrainOpacity = Math.max(filmGrainOpacity, 0.25 * intensity);
                contrast *= 1.0 + 0.15 * intensity;
                break;
            }
            case 'vhs_distortion': {
                vhsActive = true;
                break;
            }
            case 'bloom_glow': {
                brightness *= 1.0 + (0.2 + beat * 0.25) * intensity;
                contrast *= 1.0 + 0.1 * intensity;
                break;
            }
            case 'lens_blur': {
                blurPx += 6.0 * intensity * (1.0 - beat * 0.4);
                break;
            }
            case 'chromatic_aberration': {
                glitchActive = true;
                glitchOffsetPx = Math.max(glitchOffsetPx, 6.0 * intensity);
                break;
            }
            default:
                break;
        }
    }

    const filters: string[] = [];
    if (brightness !== 1.0) filters.push(`brightness(${brightness.toFixed(2)})`);
    if (contrast !== 1.0) filters.push(`contrast(${contrast.toFixed(2)})`);
    if (blurPx > 0.1) filters.push(`blur(${blurPx.toFixed(1)}px)`);
    if (invertActive) filters.push(`invert(1)`);

    const transforms: string[] = [];
    if (scale !== 1.0) transforms.push(`scale(${scale.toFixed(3)})`);

    return {
        containerFilter: filters.join(' ') || 'none',
        containerTransform: transforms.join(' ') || 'none',
        flashOpacity,
        flashColor,
        glitchActive,
        glitchOffsetPx,
        filmGrainOpacity,
        vhsActive,
        invertActive,
    };
}
