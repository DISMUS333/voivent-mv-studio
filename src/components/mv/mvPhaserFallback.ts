//==============================================================================
// MV Phaser 背景の決定論的フォールバック描画ユーティリティ。
//
// オフライン書き出し (MvExportModal / WebMCP render_mv_video / get_mv_preview)
// はライブ表示用の Phaser 4 WebGL canvas を drawImage して背景を構成するが、
// canvas が未初期化・真っ透明・破棄済みの場合、書き出し映像の背景が欠落して
// いた（黒動画 / 停止カーソル位置の取り残し静止画になる）。
//
// 本モジュールはその救済として以下を提供する:
//  1. resolvePhaserTheme(): 未知テーマ名 / 旧称テーマ名を実装済みテーマへ正規化
//  2. drawPhaserFallback(): 各テーマのライブ描画を Canvas 2D で決定論的に再現
//  3. isPhaserCanvasUsable(): ライブ canvas が描画コピーに耐える状態かを判定
//
// drawPhaserFallback は時間パラメータ (timeSec) とオーディオシグナルのみに依存し
// 同じ入力は常に同じピクセルを返すため、動画書き出しの決定論性を損なわない。
//==============================================================================
import type { AudioSignals, PhaserThemeKind } from './types';

/** 実装済みテーマ（Phaser4Canvas ライブエンジンと mvFrameRenderer が対応） */
const VALID_THEMES: ReadonlySet<string> = new Set([
    'none',
    'oscilloscope',
    'fluid_aurora',
    'ambient_bokeh',
    'spectrum_bars',
]);

/**
 * 未知テーマ名の救済マップ。
 * AI 生成シーン等で実装未対応のテーマ名が指定された場合、世界観が最も近い
 * 実装済みテーマへ寄せて描画する（未指定扱いの黒背景より遥かに良い）。
 */
const THEME_ALIASES: Record<string, PhaserThemeKind> = {
    // ネオン系グリッド / イコライザー系 → スタジオ・スペクトラム
    cyber_grid: 'spectrum_bars',
    neon_grid: 'spectrum_bars',
    equalizer: 'spectrum_bars',
    // 星空 / ワープ系 → 流体オーロラ（多層光帯が最も近い）
    starfield_warp: 'fluid_aurora',
    starfield: 'fluid_aurora',
    warp: 'fluid_aurora',
    // 霧 / モノリス / ダスト系 → 大気光彩ダスト
    monolith_fog: 'ambient_bokeh',
    fog: 'ambient_bokeh',
    nebula_dust: 'ambient_bokeh',
    bokeh: 'ambient_bokeh',
};

/** 未指定時の既定テーマ（ライブエンジンの既定と一致） */
export const DEFAULT_PHASER_THEME: PhaserThemeKind = 'oscilloscope';

/** 未知テーマ名を救済する際の既定テーマ */
export const FALLBACK_PHASER_THEME: PhaserThemeKind = 'fluid_aurora';

/**
 * テーマ名を実装済みテーマへ正規化する。
 * - 未指定 → DEFAULT_PHASER_THEME
 * - 実装済み → そのまま
 * - 旧称 / 類似名 → 救済マップ適用
 * - 完全な未知語 → FALLBACK_PHASER_THEME（黒背景化の回避）
 */
export function resolvePhaserTheme(theme: string | null | undefined): PhaserThemeKind {
    if (!theme || typeof theme !== 'string') return DEFAULT_PHASER_THEME;
    if (VALID_THEMES.has(theme)) return theme as PhaserThemeKind;
    const alias = THEME_ALIASES[theme];
    if (alias) return alias;
    return FALLBACK_PHASER_THEME;
}

//==============================================================================
// ライブ canvas 利用可否判定
//==============================================================================

/** ライブエンジンの update() が最後に描いた時刻 (performance.now) の記録 */
const canvasFreshnessMap = new WeakMap<HTMLCanvasElement, number>();

/** 最後のライブ描画からこの時間以内なら「新鮮」とみなす (ミリ秒) */
const CANVAS_FRESHNESS_TTL_MS = 700;

/**
 * ライブ Phaser エンジンの update() 冒頭から呼び出し、
 * この瞬間に canvas が実際の描画内容を持ったことを記録する。
 */
export function markPhaserCanvasFresh(canvas: HTMLCanvasElement | null | undefined): void {
    if (!canvas) return;
    try {
        canvasFreshnessMap.set(canvas, performance.now());
    } catch {
        // 記録失敗時は無視（判定はピクセル検査へフォールバック）
    }
}

/** 記録時刻から見てライブ描画が新鮮 (TTL 内) かを返す */
export function isPhaserCanvasFresh(canvas: HTMLCanvasElement | null | undefined): boolean {
    if (!canvas) return false;
    const markedAt = canvasFreshnessMap.get(canvas);
    if (typeof markedAt !== 'number') return false;
    try {
        return performance.now() - markedAt <= CANVAS_FRESHNESS_TTL_MS;
    } catch {
        return true;
    }
}

/**
 * canvas に「完全透明ではない」ピクセルが 1 つでもあるかを縮小プローブで検査する。
 * 判定不能（taint 等）の場合は楽観的に true を返し既存動作（drawImage 試行）を維持。
 */
function hasMeaningfulPixels(canvas: HTMLCanvasElement): boolean {
    try {
        const probe = document.createElement('canvas');
        const pw = Math.max(1, Math.min(32, canvas.width));
        const ph = Math.max(1, Math.min(32, canvas.height));
        probe.width = pw;
        probe.height = ph;
        const pctx = probe.getContext('2d');
        if (!pctx) return true;
        pctx.drawImage(canvas, 0, 0, pw, ph);
        const data = pctx.getImageData(0, 0, pw, ph).data;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 0) return true;
        }
        return false;
    } catch {
        return true;
    }
}

/**
 * オフライン書き出しで drawImage に耐えるライブ canvas かを判定する。
 * - 未アタッチ / サイズ 0 / DOM 非接続 → false（フォールバックへ）
 * - 新鮮な記録あり → true
 * - 記録なし → ピクセル検査で完全透明なら false（フォールバックへ）
 */
export function isPhaserCanvasUsable(canvas: HTMLCanvasElement | null | undefined): boolean {
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false;
    if (!canvas.isConnected) return false;
    if (isPhaserCanvasFresh(canvas)) return true;
    return hasMeaningfulPixels(canvas);
}

//==============================================================================
// テーマ別 決定論的フォールバック描画
//==============================================================================

/** シード付き乱数（決定論的パーティクル配置用） */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * オシロスコープ: リサジュー曲線 ＋ フォスファー残光 ＋ 計器軸線。
 * ライブエンジン (Phaser4Canvas.tsx) の lissajous 履歴トレイルを、
 * 位相オフセットによる残像として決定論的に再現する。
 */
function drawOscilloscopeFallback(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    t: number,
    sig: AudioSignals,
): void {
    const centerX = width / 2;
    const centerY = height * 0.39; // ライブの centerY * 0.78 に相当
    const freq1 = 2.0 + sig.mid * 2.5;
    const freq2 = 3.0 + sig.high * 3.5;
    const radiusX = Math.min(width, height) * (0.26 + sig.low * 0.10);
    const radiusY = Math.min(width, height) * (0.26 + sig.mid * 0.10);

    const traceCurve = (phase: number): Array<{ x: number; y: number }> => {
        const points: Array<{ x: number; y: number }> = [];
        const pointsCount = 200;
        for (let i = 0; i <= pointsCount; i++) {
            const theta = (i / pointsCount) * Math.PI * 2;
            points.push({
                x: centerX + Math.sin(theta * freq1 + phase) * radiusX,
                y: centerY + Math.sin(theta * freq2) * radiusY,
            });
        }
        return points;
    };

    const strokeTrail = (pts: Array<{ x: number; y: number }>, lineWidth: number, color: string): void => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p].x, pts[p].y);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        ctx.stroke();
    };

    // 残光トレイル（位相を遡った残像 ＝ フォスファー持続の再現）
    for (let k = 3; k >= 1; k--) {
        const alpha = 0.36 - k * 0.09;
        strokeTrail(traceCurve(t * 2.0 - k * 0.13), 1.0 + (1 - k * 0.2), `rgba(5, 150, 105, ${alpha.toFixed(3)})`);
    }

    // 最新トレース（グロー付き）
    ctx.save();
    ctx.shadowColor = 'rgba(52, 211, 153, 0.55)';
    ctx.shadowBlur = 14;
    strokeTrail(traceCurve(t * 2.0), 2.2 + sig.peak * 1.8, 'rgba(167, 243, 208, 0.95)');
    ctx.restore();

    // 計器軸線
    ctx.beginPath();
    ctx.moveTo(centerX - radiusX * 1.15, centerY);
    ctx.lineTo(centerX + radiusX * 1.15, centerY);
    ctx.moveTo(centerX, centerY - radiusY * 1.15);
    ctx.lineTo(centerX, centerY + radiusY * 1.15);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(6, 78, 59, 0.5)';
    ctx.stroke();
}

/**
 * シネマティック流体オーロラ: 4 層の光帯（塗り ＋ 輝線）。
 * ライブエンジンの auroraPhases の 1 秒あたり進行速度を数式化して再現。
 */
function drawFluidAuroraFallback(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    t: number,
    sig: AudioSignals,
): void {
    const layers = 4;
    const colors = ['67, 56, 202', '2, 132, 199', '5, 150, 105', '124, 58, 237'];
    for (let l = 0; l < layers; l++) {
        const phase = t * (0.36 + l * 0.18) * (1.0 + sig.low * 1.8);
        const baseAmp = 30 + l * 16 + sig.low * 50 + sig.mid * 35;
        const yOffset = height * (0.35 + l * 0.08);
        const alpha = Math.min(0.6, (0.12 + sig.peak * 0.3) * (1.0 - l * 0.15));
        const col = colors[l % colors.length];

        // 光帯の塗り
        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(0, yOffset);
        for (let x = 0; x <= width; x += 20) {
            const normX = x / width;
            const wave1 = Math.sin(normX * 3.0 + phase) * baseAmp;
            const wave2 = Math.cos(normX * 6.0 - phase * 0.7) * (baseAmp * 0.35);
            ctx.lineTo(x, yOffset + wave1 + wave2);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fillStyle = `rgba(${col}, ${(alpha * 0.35).toFixed(3)})`;
        ctx.fill();

        // 輝線
        ctx.beginPath();
        for (let x = 0; x <= width; x += 15) {
            const normX = x / width;
            const wave1 = Math.sin(normX * 3.0 + phase) * baseAmp;
            const wave2 = Math.cos(normX * 6.0 - phase * 0.7) * (baseAmp * 0.35);
            const y = yOffset + wave1 + wave2;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 1.5 + sig.high * 1.5;
        ctx.strokeStyle = `rgba(${col}, ${(alpha * 0.8).toFixed(3)})`;
        ctx.stroke();
    }
}

/**
 * 大気光彩ダスト: 中央グロー ＋ シード決定の浮遊粒子。
 * ライブのパーティクルエミッタを、シード付き乱数 ＋ 時間関数で決定論的に再現。
 */
function drawAmbientBokehFallback(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    t: number,
    sig: AudioSignals,
): void {
    const centerX = width / 2;
    const centerY = height * 0.39; // ライブの centerY * 0.78 に相当

    // 中央グロー
    const glowRadius = Math.min(width, height) * (0.2 + sig.low * 0.15);
    try {
        const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(1, glowRadius));
        grad.addColorStop(0, `rgba(56, 189, 248, ${(0.04 + sig.peak * 0.08).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = grad;
    } catch {
        ctx.fillStyle = `rgba(56, 189, 248, ${(0.04 + sig.peak * 0.08).toFixed(3)})`;
    }
    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(1, glowRadius), 0, Math.PI * 2);
    ctx.fill();

    // 浮遊ダスト（シード固定 → 同じ t で常に同じ配置）
    const rand = mulberry32(0x5eed1234);
    const particleCount = 46;
    for (let i = 0; i < particleCount; i++) {
        const baseX = rand();
        const baseY = rand();
        const speed = 0.03 + rand() * 0.06;
        const swayAmp = (10 + rand() * 20) * (width / 1280);
        const size = (4 + rand() * 14) * (width / 1280);
        const phase = rand() * Math.PI * 2;

        const effSpeed = speed * (0.6 + sig.low * 0.9 + sig.beat * 0.5);
        const ny = (((baseY - t * effSpeed) % 1) + 1) % 1;
        const x = baseX * width + Math.sin(t * 0.5 + phase) * swayAmp;
        const y = ny * height;
        const twinkle = 0.5 + 0.5 * Math.sin(t * 0.7 + phase * 3.1);
        const alpha = 0.05 + 0.28 * twinkle * (0.4 + sig.low * 0.6);

        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, size), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(224, 231, 255, ${alpha.toFixed(3)})`;
        ctx.fill();
    }
}

/**
 * スタジオ・スペクトラム: 32 バンド精密イコライザー。
 * ライブエンジンのバー計算式（重み付け ＋ 振動項）をそのまま再現。
 */
function drawSpectrumBarsFallback(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    t: number,
    sig: AudioSignals,
): void {
    const barCount = 32;
    const barWidth = width / (barCount * 1.4);
    const gap = barWidth * 0.4;
    const startX = (width - (barCount * (barWidth + gap))) / 2;

    for (let i = 0; i < barCount; i++) {
        const normI = i / barCount;
        const weight = normI < 0.3 ? (1 - normI / 0.3) * sig.low
            : normI < 0.7 ? (1 - Math.abs(normI - 0.5) / 0.2) * sig.mid
                : (normI - 0.7) / 0.3 * sig.high;
        const dynamicAmp = Math.sin(i * 0.3 + t * 5) * 0.15;
        const finalAmp = Math.max(0.04, Math.min(1.0, weight * 0.85 + dynamicAmp + sig.peak * 0.1));
        const barH = finalAmp * height * 0.35;
        const x = startX + i * (barWidth + gap);
        const y = height * 0.62 - barH;

        const barColor = finalAmp > 0.7 ? '245, 158, 11' : '16, 185, 129';
        ctx.fillStyle = `rgba(${barColor}, 0.85)`;
        ctx.fillRect(x, y, barWidth, barH);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(x, y - 4, barWidth, 2);
    }
}

/**
 * 指定テーマの Phaser 背景を Canvas 2D へ決定論的に描画する。
 * ライブ canvas が使用不能なときのオフライン書き出し用フォールバック。
 */
export function drawPhaserFallback(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeSec: number,
    theme: PhaserThemeKind,
    signals: AudioSignals,
): void {
    if (!ctx || theme === 'none') return;
    const t = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
    const sig = signals ?? {
        peak: 0, low: 0, mid: 0, high: 0, beat: 0,
        isPlaying: true, timeSeconds: t, bpm: 120,
    };

    try {
        switch (theme) {
            case 'oscilloscope':
                drawOscilloscopeFallback(ctx, width, height, t, sig);
                break;
            case 'fluid_aurora':
                drawFluidAuroraFallback(ctx, width, height, t, sig);
                break;
            case 'ambient_bokeh':
                drawAmbientBokehFallback(ctx, width, height, t, sig);
                break;
            case 'spectrum_bars':
                drawSpectrumBarsFallback(ctx, width, height, t, sig);
                break;
            default:
                break;
        }
    } catch (e) {
        // フォールバック描画失敗時も書き出し自体は継続（黒背景で先行）
        console.warn('[mvPhaserFallback] drawPhaserFallback warning:', e);
    }
}
