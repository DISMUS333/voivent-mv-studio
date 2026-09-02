//==============================================================================
// Phaser 粒子歌詞（phaser_pixel）の決定論的 Canvas2D 再現。
//
// ライブプレビューでは Phaser4Canvas のピクセル物理文字エンジンが
// lyricEffect に応じた粒子文字（字形サンプリング → fillRect 粒子群）を描く。
// オフライン書き出しは Phaser ランタイム / ライブ canvas 状態に依存できないため、
// 本モジュールが同一のサンプリング仕様・エフェクト式を Canvas2D で再現する。
// これがないと、AI シーンの書き出し時に粒子文字が消え、内蔵カラオケ
// テロップ（既定の水色塗り）へすり替わる回帰が発生する。
//
// 決定論性: 描画は timeSec・AudioSignals・lyricEffect・歌詞テキストのみに依存し、
// Math.random を一切使わない（ハッシュベース擬似乱数でライブの散布を再現）。
//==============================================================================
import type { AudioSignals, LyricEffectKind, LyricItem } from './types';

/** ライブ sampleLyricPixels と同一の字形サンプリング仕様 */
const PX_FONT_SIZE = 42;
const PX_FONT_STACK = '"Helvetica Neue", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const PX_STEP = 3;
const PX_PARTICLE_SIZE = PX_STEP * 0.95;
/** 粒子文字の中心Y比（ライブ: height * 0.75） */
const LYRIC_Y_RATIO = 0.75;
/** フェードアウト開始しきい値（ライブの phraseProgress > 0.88 準拠） */
const TAIL_RATIO = 0.88;
/** ワープ星の数（ライブ: 120） */
const WARP_STAR_COUNT = 120;

/** 32bit FNV-1a ハッシュによる決定論的 0..1 乱数（Math.random 不使用） */
function hash01(text: string, salt: number): number {
    let h = (2166136261 ^ salt) >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return (h % 100000) / 100000;
}

interface PixelParticle {
    targetX: number;
    targetY: number;
    /** 幾何学合体の初期飛来オフセット */
    initOffsetX: number;
    initOffsetY: number;
    /** 粒子崩壊の初速 */
    vx: number;
    vy: number;
    /** 崩壊開始のばらつき（0..0.15 秒） */
    randomDelay: number;
}

/** フレーズ内進行度 (0..1) */
function phraseProgressOf(timeSec: number, lyric: LyricItem): number {
    const dur = Math.max(0.05, lyric.duration ?? 4.0);
    return Math.min(1, Math.max(0, (timeSec - lyric.time) / dur));
}

/** フレーズ終端のフェードアウト係数（ライブ同一式） */
function outroAlpha(progress: number): number {
    return progress > TAIL_RATIO ? Math.max(0, (1 - progress) / (1 - TAIL_RATIO)) : 1;
}

/**
 * ライブ sampleLyricPixels と同一仕様（42px/900 フォント・3px グリッド・
 * alpha>128 のセルのみ採用）で字形をサンプリングし、
 * 決定論的オフセット付き粒子を生成する。
 */
function sampleLyricParticles(text: string, centerX: number, centerY: number): PixelParticle[] {
    if (!text || text.trim() === '') return [];
    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return [];

    offCtx.font = `900 ${PX_FONT_SIZE}px ${PX_FONT_STACK}`;
    const metrics = offCtx.measureText(text);
    const textWidth = Math.ceil(metrics.width) + 40;
    const textHeight = Math.ceil(PX_FONT_SIZE * 1.5) + 30;
    offCanvas.width = textWidth;
    offCanvas.height = textHeight;

    // canvas リサイズで状態が初期化されるためフォントを再設定（ライブ同一）
    offCtx.font = `900 ${PX_FONT_SIZE}px ${PX_FONT_STACK}`;
    offCtx.fillStyle = '#ffffff';
    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'middle';
    offCtx.fillText(text, textWidth / 2, textHeight / 2);

    const data = offCtx.getImageData(0, 0, textWidth, textHeight).data;
    const particles: PixelParticle[] = [];
    for (let y = 0; y < textHeight; y += PX_STEP) {
        for (let x = 0; x < textWidth; x += PX_STEP) {
            const alpha = data[(y * textWidth + x) * 4 + 3];
            if (alpha > 128) {
                particles.push({
                    targetX: centerX - textWidth / 2 + x,
                    targetY: centerY - textHeight / 2 + y,
                    initOffsetX: (hash01(text, x * 7919 + y) - 0.5) * 750,
                    initOffsetY: (hash01(text, x * 104729 + y + 17) - 0.5) * 750,
                    vx: (hash01(text, x * 65537 + y + 53) - 0.5) * 60,
                    vy: -80 - hash01(text, x * 15485863 + y + 97) * 180,
                    randomDelay: hash01(text, x * 32452843 + y + 131) * 0.15,
                });
            }
        }
    }
    return particles;
}

/** ワープ星（ライブ warpStars 同型。座標は歌詞テキストをシードに決定論生成） */
interface WarpStar { x: number; y: number; z: number; }

function createWarpStars(text: string, width: number, height: number): WarpStar[] {
    const stars: WarpStar[] = [];
    for (let i = 0; i < WARP_STAR_COUNT; i++) {
        stars.push({
            x: (hash01(text, i * 3 + 1) - 0.5) * width * 2,
            y: (hash01(text, i * 3 + 2) - 0.5) * height * 2,
            z: hash01(text, i * 3 + 3) * width,
        });
    }
    return stars;
}

/** 粒子群を一括 fillRect 描画（ライブ pixelGraphics の一括描画相当） */
function drawParticleField(
    ctx: CanvasRenderingContext2D,
    particles: PixelParticle[],
    fx: (p: PixelParticle) => { x: number; y: number; a: number },
    rgb: [number, number, number],
): void {
    const [r, g, b] = rgb;
    let lastStyle = '';
    for (let i = 0; i < particles.length; i++) {
        const pos = fx(particles[i]);
        const a = Math.max(0, Math.min(1, pos.a));
        if (a <= 0.01) continue;
        const style = `rgba(${r},${g},${b},${a.toFixed(3)})`;
        if (style !== lastStyle) {
            ctx.fillStyle = style;
            lastStyle = style;
        }
        ctx.fillRect(pos.x, pos.y, PX_PARTICLE_SIZE, PX_PARTICLE_SIZE);
    }
}

/**
 * 粒子歌詞 1 フレームを決定論的に描画する。
 * lyricEffect === 'none'・歌詞なし・フレーズ区間外では何も描かない
 * （ライブ Phaser エンジンと同一の分岐）。
 */
export function drawPhaserPixelLyric(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeSec: number,
    lyric: LyricItem | null,
    effect: LyricEffectKind,
    signals: AudioSignals,
): void {
    if (!lyric || !lyric.text || effect === 'none') return;
    const dur = Math.max(0.05, lyric.duration ?? 4.0);
    if (timeSec < lyric.time || timeSec >= lyric.time + dur) return;

    const centerX = width / 2;
    const centerY = height / 2;
    const lyricY = height * LYRIC_Y_RATIO;
    const progress = phraseProgressOf(timeSec, lyric);
    const elapsedInPhrase = timeSec - lyric.time;
    const particles = sampleLyricParticles(lyric.text, centerX, lyricY);
    if (particles.length === 0) return;

    const beat = signals.beat ?? 0;
    const low = signals.low ?? 0;
    const mid = signals.mid ?? 0;
    const white: [number, number, number] = [255, 255, 255];

    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    switch (effect) {
        // 1. 💥 粒子崩壊: 歌唱中は字形を保持して呼吸し、終盤 28% で砂塵化
        case 'particle_disintegrate': {
            const disintegrateThreshold = 0.72;
            if (progress < disintegrateThreshold) {
                const inProgress = Math.min(1.0, elapsedInPhrase / 0.2);
                drawParticleField(ctx, particles, (p) => ({
                    x: p.targetX,
                    y: p.targetY + Math.sin(timeSec * 8 + p.targetX * 0.05) * (low * 4),
                    a: inProgress,
                }), white);
            } else {
                const disProgress = (progress - disintegrateThreshold) / (1.0 - disintegrateThreshold);
                drawParticleField(ctx, particles, (p) => {
                    if (disProgress <= p.randomDelay) {
                        return { x: p.targetX, y: p.targetY, a: 1.0 };
                    }
                    const t = disProgress - p.randomDelay;
                    return {
                        x: p.targetX + p.vx * t * 3.5 + Math.sin(t * 12 + p.targetY) * 20,
                        y: p.targetY + p.vy * t * 3.5 + Math.pow(t, 2) * 50,
                        a: Math.max(0, 1.0 - t * 1.8),
                    };
                }, white);
            }
            break;
        }

        // 2. 🧩 幾何学合体: 四方から飛来して Back.easeOut でスナップ合体
        case 'kinetic_assembly': {
            const assembleDuration = 0.28;
            if (elapsedInPhrase < assembleDuration) {
                const pNorm = elapsedInPhrase / assembleDuration;
                const s = 1.70158;
                const ease = 1 + (s + 1) * Math.pow(pNorm - 1, 3) + s * Math.pow(pNorm - 1, 2);
                drawParticleField(ctx, particles, (p) => ({
                    x: p.targetX + p.initOffsetX * (1 - ease),
                    y: p.targetY + p.initOffsetY * (1 - ease),
                    a: Math.min(1.0, pNorm * 1.5),
                }), white);
            } else {
                drawParticleField(ctx, particles, (p) => ({
                    x: p.targetX,
                    y: p.targetY,
                    a: outroAlpha(progress),
                }), white);
            }
            break;
        }

        // 3. 💧 液体モーフィング: 字形が流体サイン波でうねる
        case 'liquid_morph': {
            const waveSpeed = timeSec * 8.0;
            const amp = 12 + low * 28 + mid * 16;
            drawParticleField(ctx, particles, (p) => ({
                x: p.targetX + Math.sin(p.targetY * 0.06 + waveSpeed) * amp,
                y: p.targetY + Math.cos(p.targetX * 0.04 + waveSpeed * 0.7) * (amp * 0.4),
                a: outroAlpha(progress),
            }), white);
            break;
        }

        // 4. 🎛️ 衝撃波バウンド: キックで外側へ爆散しスプリングで戻る
        case 'impact_reactive': {
            const kickForce = beat * 45;
            drawParticleField(ctx, particles, (p) => {
                const dx = p.targetX - centerX;
                const dy = p.targetY - lyricY;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                return {
                    x: p.targetX + (dx / dist) * kickForce,
                    y: p.targetY + (dy / dist) * kickForce,
                    a: outroAlpha(progress),
                };
            }, white);
            break;
        }

        // 5. ⚡️ RGB色収差グリッチ: 白本体＋赤青ゴースト（偶数・奇数交互はライブ同一）
        case 'glitch_neon': {
            const peak = signals.peak ?? 0;
            const splitShift = (peak > 0.6 || beat > 0.7) ? peak * 18 : Math.sin(timeSec * 25) * 4;
            const a = outroAlpha(progress);
            drawParticleField(ctx, particles, (p) => ({ x: p.targetX, y: p.targetY, a }), white);
            ctx.fillStyle = 'rgba(244, 63, 94, 0.75)';
            for (let i = 0; i < particles.length; i += 2) {
                const p = particles[i];
                ctx.fillRect(p.targetX - splitShift, p.targetY, PX_PARTICLE_SIZE, PX_PARTICLE_SIZE);
            }
            ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
            for (let i = 1; i < particles.length; i += 2) {
                const p = particles[i];
                ctx.fillRect(p.targetX + splitShift, p.targetY, PX_PARTICLE_SIZE, PX_PARTICLE_SIZE);
            }
            break;
        }

        // 6. 🚀 3D空間ハイパーワープ: 星行列のワープ軌跡＋文字の Z 突入スケール
        case 'camera_warp': {
            const warpInTime = 0.28;
            const warpSpeed = elapsedInPhrase < warpInTime
                ? 45
                : (progress > 0.85 ? 60 : 15 + beat * 25);
            const stars = createWarpStars(lyric.text, width, height);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (const star of stars) {
                // 経過時間に比例して z が減算されるライブの積分を、
                // width で折り返す周期関数で決定論的に近似する
                let z = star.z - ((timeSec * warpSpeed) % width);
                if (z <= 0) z += width;
                const k = 250 / z;
                const px = centerX + star.x * k;
                const py = centerY + star.y * k;
                const pk = 250 / (z + warpSpeed * 0.016);
                const prevX = centerX + star.x * pk;
                const prevY = centerY + star.y * pk;
                if (px >= 0 && px <= width && py >= 0 && py <= height) {
                    ctx.moveTo(prevX, prevY);
                    ctx.lineTo(px, py);
                }
            }
            ctx.stroke();

            const scale = elapsedInPhrase < warpInTime
                ? 0.2 + (elapsedInPhrase / warpInTime) * 0.8
                : (progress > 0.85 ? 1.0 + ((progress - 0.85) / 0.15) * 1.5 : 1.0);
            drawParticleField(ctx, particles, (p) => ({
                x: centerX + (p.targetX - centerX) * scale,
                y: lyricY + (p.targetY - lyricY) * scale,
                a: progress > 0.85
                    ? Math.max(0, 1.0 - (progress - 0.85) / 0.15)
                    : Math.min(1.0, elapsedInPhrase / warpInTime),
            }), white);
            break;
        }
    }

    ctx.restore();
}

