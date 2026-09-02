//==============================================================================
// MV 決定論的オフラインフレームレンダラー。
// 指定時刻 t のシグナル・シーン設定・Phaser 4 WebGL Canvas・全プリセット装飾・歌詞を
// 指定解像度の Canvas 2D コンテキストへ確実にラスタライズする。
// 全プリセット（オシロスコープ・ピクセル・シネマティック・リップシンク・カスタム）に対応。
// foreignObject を排除し Canvas Taint (The operation is insecure) を完全防止。
//==============================================================================
import type {
    AudioSignals,
    LyricDisplayMode,
    LyricGlobalStyle,
    LyricItem,
    MvImageAsset,
    MvScene,
} from './types';
import { computeSceneTransition, findActiveLyric } from './AudioReactiveSandbox';
import { karaokeProgress, evaluateKeyframes } from './mvAnimation';
import { drawPhaserFallback, isPhaserCanvasUsable, resolvePhaserTheme } from './mvPhaserFallback';
import { drawPhaserPixelLyric } from './mvPhaserPixelText';
import { drawShaderFrame } from './mvShaderOffline';
import { drawMv3DFrame, type Mv3DFrameDiagnostics } from './mv3dOffline';

export interface RenderFrameOptions {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
    timeSec: number;
    scenes: MvScene[];
    lyrics: LyricItem[];
    signals: AudioSignals;
    globalCss?: string;
    phaserCanvas?: HTMLCanvasElement | null;
    assets?: MvImageAsset[];
    lyricStyle?: LyricGlobalStyle;
    /**
     * 歌詞表示レイヤーモード (未指定時は preset_box)。
     * ライブ AudioReactiveSandbox と同一の解決規則を書き出し側でも適用し、
     * phaser_pixel 時は粒子文字を描画して内蔵テロップへの置き換えを防ぐ。
     */
    lyricDisplayMode?: LyricDisplayMode;
    /** 3D実フレーム診断を取得するキャプチャ側の任意フック */
    on3DFrameDiagnostics?: (diagnostics: Mv3DFrameDiagnostics) => void;
    /**
     * 決定論的オフライン書き出しかどうか (true: MP4/GIF 動画書き出し)。
     * true の場合はライブ Phaser canvas に依存せず、常に決定論的フォールバック
     * 背景を使用する。false (静止画キャプチャ等) では新鮮なライブ canvas を優先。
     */
    isOfflineRender?: boolean;
}

/** 歌詞描画のデフォルトスタイル */
const DEFAULT_FONT_SIZE = 34;
const DEFAULT_FONT_FAMILY = "'Hiragino Sans', 'Noto Sans JP', sans-serif";

/**
 * 1 フレーム分の映像を Canvas2D に完全描画する（非同期）。
 */
export async function renderFrameToCanvas(options: RenderFrameOptions): Promise<void> {
    const {
        ctx,
        width,
        height,
        timeSec,
        scenes,
        lyrics,
        signals,
        phaserCanvas,
        assets = [],
        lyricStyle,
        lyricDisplayMode,
        isOfflineRender = true,
    } = options;

    // 1. 全面クリア（黒背景）
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // 2. シーン情報の計算
    const transition = computeSceneTransition(scenes, timeSec);
    const scene = transition.current;
    if (!scene) {
        // シーンが存在しない区間は黒画面
        return;
    }

    // 3. 背景描画（各プリセット専用グラデーション/背景画像）
    await drawSceneBackground(ctx, width, height, scene, assets, signals);

    // 4. 背景: 本物の3Dシーン > AI生成シェーダー > ライブ背景 > フォールバック
    const resolvedTheme = resolvePhaserTheme(scene.phaserTheme);
    const threeDResult = await drawMv3DFrame(ctx, width, height, timeSec, scene.threeD, signals, scene.startTime);
    options.on3DFrameDiagnostics?.(threeDResult.diagnostics);
    const threeDDrawn = threeDResult.rendered;
    const shaderDrawn = !threeDDrawn && await drawShaderFrame(ctx, width, height, timeSec, scene.shaderCode, signals);
    const useLiveCanvas = !shaderDrawn && !isOfflineRender && isPhaserCanvasUsable(phaserCanvas);
    if (useLiveCanvas && phaserCanvas) {
        // ライブ Phaser WebGL canvas をそのままコピー（静止画キャプチャは実機描画を優先）
        try {
            ctx.save();
            ctx.drawImage(phaserCanvas, 0, 0, width, height);
            ctx.restore();
        } catch (e) {
            console.warn('[mvFrameRenderer] phaserCanvas drawImage warning:', e);
            drawPhaserFallback(ctx, width, height, timeSec, resolvedTheme, signals);
        }
    } else if (resolvedTheme !== 'none') {
        // ライブ canvas 未接続・未初期化・真っ透明・停止中の凍結フレーム等では
        // 決定論的フォールバック描画に置き換える（黒動画 / 静止固定を防止）。
        drawPhaserFallback(ctx, width, height, timeSec, resolvedTheme, signals);
    }

    // 5. プリセット固有のビジュアル装飾（モノリス、グリッド、スキャンライン、レティクルなど）
    drawSceneDecorations(ctx, width, height, scene, signals);

    // 6. シーン内の純粋 SVG グラフィックス（ピクセルシンボルやキャラクターの顔・幾何学図形）を描画
    // キーフレーム transform / opacity をここでまとめて適用する。
    // ライブ側 DynamicSceneLayer がラッパー div に適用するのと等価 (プレビュー/書き出し整合)。
    await drawSceneSvgPureWithKeyframes(ctx, width, height, scene, signals, timeSec);

    // 7. 歌詞テキスト＆ボックスの描画（プリセットごとの世界観フォント・発光・シャドウを適用）
    // ライブ AudioReactiveSandbox と同一の表示モード解決を行い、
    // phaser_pixel モードでは内蔵テロップではなく粒子文字を描画する。
    const activeLyric = findActiveLyric(lyrics, timeSec);
    const displayMode = lyricDisplayMode ?? scene.lyricDisplayMode
        ?? (scene.lyricEffect && scene.lyricEffect !== 'none' ? 'phaser_pixel' : 'preset_box');
    // ライブ Phaser canvas をそのまま転写した場合、粒子文字も画像に含まれるため
    // 二重描画を回避する（転写できなかった場合は決定論的粒子文字を描く）。
    const effectiveMode = displayMode === 'phaser_pixel' && useLiveCanvas ? 'none' : displayMode;
    const hasEmbeddedLyricLayer = scene.svgCode?.includes('data-lyric-display') ?? false;
    if (lyricStyle?.showBuiltIn !== false && !hasEmbeddedLyricLayer) {
        drawLyricBoxAndText(ctx, width, height, timeSec, activeLyric, scene, lyricStyle, signals, effectiveMode);
    }
}

/**
 * シーンキーフレーム変換を適用しながら SVG を描画する。
 * ライブプレビュー (DynamicSceneLayer) はシーン内相対進行度 (0..1) で
 * evaluateKeyframes を評価し、結果をラッパー div の opacity / transform へ
 * 反映する。書き出しでも同一の補間式を適用しないと「プレビューでは動くのに
 * 書き出しでは静止」するドリフトの原因になるため、ここで等価変換を行う。
 */
async function drawSceneSvgPureWithKeyframes(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: MvScene,
    signals: AudioSignals,
    timeSec: number,
): Promise<void> {
    // キーフレーム補間値の収集 (ライブ DynamicSceneLayer と同一の式)
    const kfValues: Partial<Record<string, number>> = {};
    const sceneDuration = Math.max(0.05, scene.endTime - scene.startTime);
    const sceneProgress = Math.max(0, Math.min(1, (timeSec - scene.startTime) / sceneDuration));
    for (const [prop, frames] of Object.entries(scene.keyframes ?? {})) {
        const v = evaluateKeyframes(frames as never, sceneProgress);
        if (v !== undefined) kfValues[prop] = v;
    }
    if (Object.keys(kfValues).length === 0) {
        // キーフレーム未定義シーンは従来経路のまま (挙動不変)
        await drawSceneSvgPure(ctx, width, height, scene, signals);
        return;
    }

    const kfOpacity = kfValues.opacity;
    const kfScale = kfValues.scale;
    const kfRotate = kfValues.rotateDeg;
    const kfTx = ((kfValues.translateXPct ?? 0) / 100) * width;
    const kfTy = ((kfValues.translateYPct ?? 0) / 100) * height;
    const hasTransform = kfScale !== undefined || kfRotate !== undefined
        || kfValues.translateXPct !== undefined || kfValues.translateYPct !== undefined;

    ctx.save();
    try {
        if (kfOpacity !== undefined) {
            ctx.globalAlpha = Math.max(0, Math.min(1, kfOpacity));
        }
        if (hasTransform) {
            // CSS transform と同等の中心基準 (transform-origin: center) で適用
            ctx.translate(width / 2 + kfTx, height / 2 + kfTy);
            if (kfRotate !== undefined) ctx.rotate((kfRotate * Math.PI) / 180);
            if (kfScale !== undefined) ctx.scale(kfScale, kfScale);
            ctx.translate(-width / 2, -height / 2);
        }
        await drawSceneSvgPure(ctx, width, height, scene, signals);
    } finally {
        ctx.restore();
    }
}

/**
 * デコード済み画像キャッシュ（data URL → HTMLImageElement）。
 * 1 フレームごとに new Image() すると data URL デコードが毎回走り、
 * 初回フレームではロード完了前に drawImage してしまい背景が真っ黒になる。
 * 書き出し前に preloadAssets() で全素材を暖気し、以降はキャッシュヒットで
 * 同期描画できるようにする。
 */
const decodedImageCache = new Map<string, HTMLImageElement>();
/** キャッシュ上限（素材は高々数十個想定。超過時は全クリアで再ロード） */
const IMAGE_CACHE_LIMIT = 64;

/**
 * 画像をデコードしてキャッシュから返す。未キャッシュならロード完了を待つ。
 * ロード失敗時は null を返す（背景なしで続行、既存挙動と同一）。
 */
function loadImage(src: string): Promise<HTMLImageElement | null> {
    const cached = decodedImageCache.get(src);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            if (decodedImageCache.size >= IMAGE_CACHE_LIMIT) decodedImageCache.clear();
            decodedImageCache.set(src, img);
            resolve(img);
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

/**
 * 書き出し開始前の全素材画像デコード待ち。
 * 初回フレームの背景画像抜け（真っ黒 MP4）を防ぐため、フレームループの前に呼ぶ。
 */
export async function preloadAssets(assets: MvImageAsset[]): Promise<void> {
    await Promise.all(
        assets
            .filter((a) => a && a.dataUrl)
            .map((a) => loadImage(a.dataUrl)),
    );
}

/**
 * シーン背景（プリセット別のグラデーション・単色・画像アセット）を描画
 */
async function drawSceneBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: MvScene,
    assets: MvImageAsset[],
    signals: AudioSignals,
): Promise<void> {
    ctx.save();

    const isCine = scene.svgCode?.includes('cine-container') || scene.id?.includes('cine');
    const isLip = scene.svgCode?.includes('lip-container') || scene.id?.includes('lip');
    const isOsc = scene.svgCode?.includes('osc-container') || scene.id?.includes('osc');

    if (isCine) {
        // 🌌 シネマティック: 深淵ラジアルグラデーション
        const grad = ctx.createRadialGradient(width * 0.5, height * 0.4, 0, width * 0.5, height * 0.4, Math.max(width, height) * 0.8);
        grad.addColorStop(0, '#111827');
        grad.addColorStop(1, '#030712');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
    } else if (isLip) {
        // 🎙️ リップシンク: スレートグラデーション
        const grad = ctx.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.45, Math.max(width, height) * 0.8);
        grad.addColorStop(0, '#1e293b');
        grad.addColorStop(1, '#0f172a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
    } else if (isOsc) {
        // 📟 オシロスコープ: マットダーク
        ctx.fillStyle = '#090b10';
        ctx.fillRect(0, 0, width, height);
    } else {
        // 🔲 ピクセル / デフォルト: ピュアブラック
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
    }

    // 背景画像アセットがある場合（デコード完了を待ってから描画するため
    // 初回フレームでも確実に反映される。未キャッシュでもフレーム内で待つ）
    if (scene.backgroundImageId) {
        const asset = assets.find((a) => a.id === scene.backgroundImageId);
        if (asset && asset.dataUrl) {
            const img = await loadImage(asset.dataUrl);
            if (img && typeof ctx.drawImage === 'function') {
                ctx.drawImage(img, 0, 0, width, height);
            }
        }
    }

    // オーディオリアクティブな微妙な明滅・フラッシュ効果（ビート強調）
    if (signals.beat > 0.05) {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.08, signals.beat * 0.08)})`;
        ctx.fillRect(0, 0, width, height);
    }

    ctx.restore();
}

/**
 * プリセット別の固有ビジュアル装飾（グリッド・モノリス・レティクル・スキャンラインなど）
 */
function drawSceneDecorations(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: MvScene,
    signals: AudioSignals,
): void {
    const scale = width / 1280;
    const isOsc = scene.svgCode?.includes('osc-container') || scene.id?.includes('osc');
    const isCine = scene.svgCode?.includes('cine-container') || scene.id?.includes('cine');
    const isGlitch = scene.svgCode?.includes('glitch-container') || scene.id?.includes('pixel');

    ctx.save();

    if (isOsc) {
        // 📟 オシロスコープ: エメラルドグリーン方眼グリッド
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.08)';
        ctx.lineWidth = 1;
        const gridSize = 40 * scale;
        for (let x = 0; x < width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // 中央円形レティクル
        const reticleR = Math.min(width, height) * 0.35;
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, reticleR, 0, Math.PI * 2);
        ctx.stroke();

        // 左上計器テキスト
        ctx.font = `${Math.round(11 * scale)}px 'SF Mono', 'Menlo', monospace`;
        ctx.fillStyle = 'rgba(52, 211, 153, 0.7)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const tx = width * 0.08;
        let ty = height * 0.12;
        const lineH = 16 * scale;
        ctx.fillText('CH1: VECTOR LISSAJOUS [ACTIVE]', tx, ty);
        ty += lineH;
        ctx.fillText('PHOSPHOR: PERSISTENCE ON', tx, ty);
        ty += lineH;
        ctx.fillText('FREQ RES: 20Hz - 20kHz', tx, ty);

    } else if (isCine) {
        // 🌌 シネマティック: Phaser 4 WebGL (fluid_aurora) または SVG レイヤーが全面を担当
    } else if (isGlitch) {
        // 🔲 ピクセルグリッド（白ドット線）
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.03 + (signals.beat || 0) * 0.06})`;
        ctx.lineWidth = 1;
        const gridSize = 24 * scale;
        for (let x = 0; x < width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // スキャンライン（CRT横縞）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        const scanH = Math.max(2, Math.round(4 * scale));
        for (let y = 0; y < height; y += scanH * 2) {
            ctx.fillRect(0, y, width, scanH);
        }
    }

    ctx.restore();
}

/**
 * シーンの svgCode から純粋な <svg>...</svg> を抽出し、Canvas Taint を起こさずに美しく描画
 */
async function drawSceneSvgPure(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: MvScene,
    signals: AudioSignals,
): Promise<void> {
    if (!scene.svgCode || scene.svgCode.trim().length === 0) return;

    // 全ての <svg ...>...</svg> タグを検出
    const svgMatches = scene.svgCode.match(/<svg[\s\S]*?<\/svg>/gi);
    if (!svgMatches || svgMatches.length === 0) return;

    for (const rawSvg of svgMatches) {
        let svgStr = rawSvg;

        // xmlns がなければ付与
        if (!svgStr.includes('xmlns=')) {
            svgStr = svgStr.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        }

        // リップシンク口パク用: アクティブ母音以外の口パスを非表示に置換
        if (svgStr.includes('lip-mouth')) {
            const activeViseme = signals.viseme || 'a';
            const isVoiced = ['a', 'i', 'u', 'e', 'o'].includes(activeViseme);
            svgStr = svgStr.replace(/<path class="lip-mouth" data-lip="([^"]+)"[\s\S]*?\/>/g, (match, vowel) => {
                if (isVoiced && vowel === activeViseme) {
                    return match.replace('class="lip-mouth"', 'class="lip-mouth" opacity="1"');
                }
                return match.replace('class="lip-mouth"', 'class="lip-mouth" opacity="0"');
            });
        }

        // SVG の width / height / viewBox の取得
        const widthMatch = svgStr.match(/width=["'](\d+)(px)?["']/i);
        const heightMatch = svgStr.match(/height=["'](\d+)(px)?["']/i);
        const explicitW = widthMatch ? parseFloat(widthMatch[1]) : 0;
        const explicitH = heightMatch ? parseFloat(heightMatch[1]) : 0;

        const isFullScreenSvg = (explicitW >= 800 || svgStr.includes('width="100%"'));
        const isCenterSymbol = svgStr.includes('pixel-symbol') || svgStr.includes('lip-face') || (!isFullScreenSvg && explicitW > 0 && explicitW <= 400);
        const scaleFactor = isCenterSymbol && svgStr.includes('pixel-symbol') ? 1.0 + (signals.peak || 0) * 0.35 : 1.0;
        const rotationDeg = isCenterSymbol && svgStr.includes('pixel-symbol') ? (signals.beat || 0) * 90 : 0;

        // SVG を Data URL に変換
        const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);

        try {
            const img = new Image();
            img.src = svgDataUrl;
            await new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
            });

            if (img.naturalWidth > 0 && typeof ctx.drawImage === 'function') {
                ctx.save();
                if (isCenterSymbol) {
                    ctx.translate(width / 2, height / 2);
                    if (rotationDeg !== 0) ctx.rotate((rotationDeg * Math.PI) / 180);
                    if (scaleFactor !== 1.0) ctx.scale(scaleFactor, scaleFactor);

                    const iconSize = Math.min(width, height) * (explicitW > 0 ? (explicitW / 450) : 0.36);
                    ctx.drawImage(img, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
                } else {
                    ctx.drawImage(img, 0, 0, width, height);
                }
                ctx.restore();
            }
        } catch {
            // SVG デコード失敗時はスキップ
        }
    }
}

/**
 * 歌詞テキストを各プリセットの世界観（フォント・色・シャドウ・配置）に合わせて美しく Canvas2D 描画
 */
function drawLyricBoxAndText(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeSec: number,
    activeLyric: LyricItem | null,
    scene: MvScene,
    style?: LyricGlobalStyle,
    signals?: AudioSignals,
    displayMode?: LyricDisplayMode,
): void {
    if (!activeLyric || !activeLyric.text) return;

    // 🎯 ライブと同一の表示モードゲート: phaser_pixel（AI 生成シーンのデフォルト）では
    // 粒子文字を描画し、preset_box 用のカラオケテロップに置き換わる回帰を防ぐ
    if (displayMode === 'phaser_pixel') {
        drawPhaserPixelLyric(
            ctx,
            width,
            height,
            timeSec,
            activeLyric,
            scene.lyricEffect ?? 'particle_disintegrate',
            signals ?? { peak: 0, low: 0, mid: 0, high: 0, beat: 0, isPlaying: false, timeSeconds: timeSec, bpm: 0 },
        );
        return;
    }
    if (displayMode === 'none') return;

    const scale = width / 1280;
    const text = activeLyric.text;

    const isGlitch = scene.svgCode?.includes('lyric-box-glitch') || scene.id?.includes('pixel');
    const isOsc = scene.svgCode?.includes('lyric-box-osc') || scene.id?.includes('osc');
    const isCine = scene.svgCode?.includes('lyric-box-cine') || scene.id?.includes('cine');
    const isLip = scene.svgCode?.includes('lip-lyric') || scene.id?.includes('lip');

    ctx.save();

    if (isGlitch) {
        // 🔲 1. ピクセル・グリッチ風（白背景ボックス＋黒文字＋ダブルシャドウ）
        const fontSize = Math.round(20 * scale);
        ctx.font = `900 ${fontSize}px 'Courier New', 'SF Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const metrics = ctx.measureText ? ctx.measureText(text) : { width: text.length * fontSize * 0.6 };
        const textWidth = metrics.width;
        const boxWidth = textWidth + 36 * scale;
        const boxHeight = fontSize + 20 * scale;

        const jitterX = (signals?.low ?? 0) * 4 * scale - 2 * scale;
        const jitterY = (signals?.high ?? 0) * -4 * scale + 2 * scale;
        const centerX = width / 2 + jitterX;
        const centerY = height * 0.76 + jitterY;

        const boxLeft = centerX - boxWidth / 2;
        const boxTop = centerY - boxHeight / 2;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(boxLeft + 8 * scale, boxTop + 8 * scale, boxWidth, boxHeight);
        ctx.fillStyle = '#000000';
        ctx.fillRect(boxLeft + 6 * scale, boxTop + 6 * scale, boxWidth, boxHeight);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight);
        ctx.fillStyle = '#000000';
        ctx.fillText(text, centerX, centerY);

    } else if (isOsc) {
        // 📟 2. アナログ・オシロスコープ（エメラルドグリーン・発光・等幅フォント）
        const fontSize = Math.round(18 * scale);
        ctx.font = `700 ${fontSize}px 'SF Mono', 'Menlo', 'Courier New', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(52, 211, 153, 0.75)';
        ctx.shadowBlur = 10 * scale;
        ctx.fillStyle = '#a7f3d0';
        ctx.fillText(text, width / 2, height * 0.84);

    } else if (isCine) {
        // 🌌 3. シネマティック・ミスト（明朝体・オフホワイト・映画風シャドウ）
        const fontSize = Math.round(22 * scale);
        ctx.font = `500 ${fontSize}px 'Hiragino Mincho ProN', 'Yu Mincho', 'Times New Roman', serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
        ctx.shadowBlur = 12 * scale;
        ctx.shadowOffsetY = 2 * scale;
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(text, width / 2, height * 0.84);

    } else if (isLip) {
        // 🎙️ 4. リップシンクキャラクター（ネオンブルーグロー・ゴシック体）
        const fontSize = Math.round(30 * scale);
        ctx.font = `700 ${fontSize}px 'Hiragino Sans', 'Noto Sans JP', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(56, 189, 248, 0.75)';
        ctx.shadowBlur = 16 * scale;
        ctx.fillStyle = '#e0f2fe';
        ctx.fillText(text, width / 2, height * 0.88);

    } else {
        // 🎨 5. カスタムシーン / 通常テロップ（設定スタイルに準拠）
        const fontSize = style?.fontSizePx ?? DEFAULT_FONT_SIZE;
        const fontFamily = style?.fontFamily ?? DEFAULT_FONT_FAMILY;
        const scaledFontSize = Math.round(fontSize * scale);

        ctx.font = `bold ${scaledFontSize}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const pos = style?.position ?? (scene.lyricDisplayMode === 'top_telop' ? 'top' : 'bottom');
        let y = height * 0.85;
        if (pos === 'top') {
            y = height * 0.15;
        } else if (pos === 'center') {
            y = height * 0.5;
        }
        const x = width / 2;

        const textColor = style?.color ?? '#ffffff';
        const karaokeColor = style?.karaokeColor ?? '#38bdf8';

        // 縁取り
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = Math.max(3, Math.round(6 * scale));
        ctx.lineJoin = 'round';
        if (typeof ctx.strokeText === 'function') {
            ctx.strokeText(text, x, y);
        }

        // カラオケ進行（ライブ BuiltInLyricLayer 同様、karaokeEnabled 時のみ描く）
        const karaokeOn = style?.karaokeEnabled === true;
        const progress = karaokeOn ? karaokeProgress(timeSec, activeLyric) : 0;

        if (karaokeOn && progress > 0 && progress < 1 && typeof ctx.measureText === 'function') {
            const textMetrics = ctx.measureText(text);
            const textWidth = textMetrics?.width || (text.length * scaledFontSize * 0.6);
            const startX = x - textWidth / 2;

            ctx.fillStyle = textColor;
            ctx.fillText(text, x, y);

            if (typeof ctx.save === 'function' && typeof ctx.rect === 'function' && typeof ctx.clip === 'function') {
                ctx.save();
                if (typeof ctx.beginPath === 'function') ctx.beginPath();
                ctx.rect(startX, y - scaledFontSize, textWidth * progress, scaledFontSize * 2);
                ctx.clip();
                ctx.fillStyle = karaokeColor;
                ctx.fillText(text, x, y);
                if (typeof ctx.restore === 'function') ctx.restore();
            }
        } else if (progress >= 1) {
            ctx.fillStyle = karaokeColor;
            ctx.fillText(text, x, y);
        } else {
            ctx.fillStyle = textColor;
            ctx.fillText(text, x, y);
        }
    }

    ctx.restore();
}
