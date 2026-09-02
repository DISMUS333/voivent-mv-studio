import React, { useEffect, useMemo, useRef } from 'react';
import { useI18n } from '../../i18n';
import { AudioSignals, LyricGlobalStyle, LyricItem, MvImageAsset, MvScene, MvEffectClip } from './types';
import { sanitizeSceneHtml } from './mvSanitize';
import { scopeMvCss, MV_STAGE_CLASS } from './mvCssScope';
import { evaluateKeyframes, karaokeProgress, keyframeTransformCss } from './mvAnimation';
import { runSceneScript } from './mvScriptRuntime';
import { Phaser4Canvas } from './Phaser4Canvas';
import { MvShaderCanvas } from './MvShaderCanvas';
import { Mv3DSceneCanvas } from './Mv3DSceneCanvas';
import { getActiveEffectClips, computeEffectStyle } from './effects/mvEffectRenderer';

interface AudioReactiveSandboxProps {
    scenes: MvScene[];
    lyrics: LyricItem[];
    globalCss?: string;
    signals: AudioSignals;
    /** タイムラインエフェクトクリップ */
    effects?: MvEffectClip[];
    /** 素材ライブラリ（シーン背景画像の解決に使用） */
    assets?: MvImageAsset[];
    /** 全歌詞共通スタイル（未指定時はデフォルト） */
    lyricStyle?: LyricGlobalStyle;
    /**
     * Phaser 4 canvas ノードを親へ forward するための ref。
     * MV 動画エクスポートで WebGL canvas を drawImage キャプチャするのに使用。
     * 省略時は Phaser 内部 canvas は取得されない。
     */
    phaserCanvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
}

/** 遷移エフェクトの既定持続秒数 */
const DEFAULT_TRANSITION_SEC = 0.6;

/** 歌詞スタイルのデフォルト値 */
const DEFAULT_LYRIC_STYLE: Required<Pick<LyricGlobalStyle,
    'fontFamily' | 'fontSizePx' | 'color' | 'position' | 'animation' | 'karaokeColor'
>> = {
    fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif",
    fontSizePx: 34,
    color: '#ffffff',
    position: 'bottom',
    animation: 'fadeUp',
    karaokeColor: '#38bdf8',
};

/**
 * シーン切替時の遷移エフェクトを計算する純粋関数。
 * 遷移区間（シーン開始から transitionDurationSec まで）では
 * 前シーンと現シーンを重ね、進行度 0→1 のアニメーションを返す。
 * シーン間ギャップでは current = null（黒画面）を返す。
 */
export function computeSceneTransition(
    scenes: MvScene[],
    timeSec: number,
): {
    current: MvScene | null;
    previous: MvScene | null;
    /** 遷移進行度 0〜1（1 = 完了）。遷移なし時は常に 1 */
    progress: number;
    kind: string;
} {
    if (!scenes || scenes.length === 0) {
        return { current: null, previous: null, progress: 1, kind: 'none' };
    }
    const sorted = [...scenes].sort((a, b) => a.startTime - b.startTime);
    const idx = sorted.findIndex((s) => timeSec >= s.startTime && timeSec < s.endTime);
    // シーン間ギャップ（どのシーンにも属さない時刻）は黒画面を返す
    if (idx === -1) {
        return { current: null, previous: null, progress: 1, kind: 'none' };
    }
    const current = sorted[idx];
    const prev = idx > 0 ? sorted[idx - 1] : null;

    const dur = Math.max(0.05, current.transitionDurationSec ?? DEFAULT_TRANSITION_SEC);
    const elapsed = timeSec - current.startTime;
    const kind = current.transition ?? 'none';

    if (kind === 'none' || elapsed >= dur) {
        return { current, previous: null, progress: 1, kind };
    }
    // 遷移中：前シーンが存在すれば重ね合わせ対象にする
    return {
        current,
        previous: prev,
        progress: Math.max(0, Math.min(1, elapsed / dur)),
        kind,
    };
}

/** 現在時刻でアクティブな歌詞を取得 */
export function findActiveLyric(lyrics: LyricItem[], timeSec: number): LyricItem | null {
    for (const l of lyrics) {
        const dur = l.duration ?? 4.0;
        if (timeSec >= l.time && timeSec < l.time + dur) return l;
    }
    return null;
}

/** フレーズ開始からの経過秒 */
function lyricElapsed(timeSec: number, lyric: LyricItem): number {
    return Math.max(0, timeSec - lyric.time);
}

/**
 * 適用すべきシーン専用 CSS のリストを返す。
 * 遷移中は前シーンの CSS も併用し、前シーンのアニメーションが
 * 固まって見える問題を防ぐ。
 */
function inTransitionSafeCss(
    scenes: MvScene[],
    transition: { current: MvScene | null; previous: MvScene | null },
): string[] {
    const list: string[] = [];
    if (transition.previous) {
        const prev = scenes.find((s) => s.id === transition.previous?.id);
        if (prev?.cssCode) list.push(prev.cssCode);
    }
    if (transition.current?.cssCode) list.push(transition.current.cssCode);
    return list;
}

/**
 * svgCode 内に書かれた <style> ブロックを抽出して除去する。
 * 抽出された CSS はステージへスコープ化して別途適用するため、
 * セレクタがそのままグローバルへ漏れる（アプリ UI を汚染する）ことを防ぐ。
 * <style> 自体はサニタイザで除去されないため、ここで明示的に扱う。
 */
function extractStyleBlocksFromSvg(svgCode: string | undefined): { html: string; css: string } {
    if (!svgCode || !svgCode.includes('<style')) return { html: svgCode ?? '', css: '' };
    const collected: string[] = [];
    const html = svgCode.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, inner: string) => {
        collected.push(inner);
        return '';
    });
    return { html, css: collected.join('\n') };
}

//==============================================================================
// シーン 1 レイヤーの描画（背景画像 ＋ サニタイズ済み HTML ＋ キーフレーム変換）
//==============================================================================
const SceneLayer: React.FC<{
    scene: MvScene;
    assets: MvImageAsset[];
}> = ({ scene, assets }) => {
    const rootRef = useRef<HTMLDivElement | null>(null);

    // キーフレームは親で計算した値を CSS 変数経由ではなく直接 style へ反映するため、
    // ここでは静的な土台のみ描画する（動的変形は DynamicSceneLayer が担当）。
    const bgAsset = scene.backgroundImageId
        ? assets.find((a) => a.id === scene.backgroundImageId)
        : undefined;

    const { html: htmlWithoutStyle } = useMemo(
        () => extractStyleBlocksFromSvg(scene.svgCode ?? ''),
        [scene.svgCode],
    );
    // <style> は親レイヤーでスコープ化して適用するため、ここでは除去してから
    // サニタイズする（無スコープのスタイルがグローバルへ漏れるのを防ぐ）
    const safeHtml = useMemo(() => sanitizeSceneHtml(htmlWithoutStyle), [htmlWithoutStyle]);

    return (
        <div ref={rootRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
            {bgAsset && (
                <img
                    src={bgAsset.dataUrl}
                    alt=""
                    draggable={false}
                    style={{
                        position: 'absolute', inset: 0,
                        width: '100%', height: '100%',
                        objectFit: 'cover', pointerEvents: 'none',
                    }}
                />
            )}
            <div style={{ width: '100%', height: '100%', position: 'relative' }} dangerouslySetInnerHTML={{ __html: safeHtml }} />
        </div>
    );
};

//==============================================================================
// キーフレーム ＋ カスタムスクリプトを毎フレーム適用するラッパー
//==============================================================================
const DynamicSceneLayer: React.FC<{
    scene: MvScene;
    assets: MvImageAsset[];
    signals: AudioSignals;
    timeSec: number;
}> = ({ scene, assets, signals, timeSec }) => {
    const wrapRef = useRef<HTMLDivElement | null>(null);

    // シーン内相対進行度
    const duration = Math.max(0.05, scene.endTime - scene.startTime);
    const elapsed = Math.max(0, timeSec - scene.startTime);
    const progress = Math.min(1, elapsed / duration);

    // キーフレーム補間値 → transform/filter 文字列
    const kfValues = useMemo(() => {
        const out: Partial<Record<string, number>> = {};
        for (const [prop, frames] of Object.entries(scene.keyframes ?? {})) {
            const v = evaluateKeyframes(frames as never, progress);
            if (v !== undefined) out[prop] = v;
        }
        return out;
    }, [scene.keyframes, progress]);

    const opacityKf = kfValues.opacity;
    const transformCss = keyframeTransformCss(kfValues as never);

    // カスタムスクリプト実行（限定 API・毎フレーム）。
    // コンパイル結果は mvScriptRuntime 内でキャッシュされるため、ここでの
    // 毎フレーム呼び出しでも new Function の再コンパイルは発生しない。
    useEffect(() => {
        const el = wrapRef.current;
        if (!el || !scene.customScript) return;
        runSceneScript(el, scene.customScript, { progress, elapsedSec: elapsed, audio: signals });
    }, [scene.customScript, progress, elapsed, signals]);

    return (
        <div
            ref={wrapRef}
            style={{
                width: '100%',
                height: '100%',
                ...(opacityKf !== undefined ? { opacity: Math.max(0, Math.min(1, opacityKf)) } : {}),
                ...(transformCss ? { transform: transformCss } : {}),
            }}
        >
            <SceneLayer scene={scene} assets={assets} />
        </div>
    );
};

//==============================================================================
// 内蔵歌詞レイヤー（スタイル ＋ アニメーション ＋ カラオケ塗りつぶし）
//==============================================================================
const BuiltInLyricLayer: React.FC<{
    lyrics: LyricItem[];
    timeSec: number;
    styleCfg: LyricGlobalStyle;
}> = ({ lyrics, timeSec, styleCfg }) => {
    const active = findActiveLyric(lyrics, timeSec);
    if (!active) return null;

    const merged = { ...DEFAULT_LYRIC_STYLE, ...styleCfg };
    const el = lyricElapsed(timeSec, active);
    const phraseDur = Math.max(0.05, active.duration ?? 4.0);

    // ---- 入場アニメーション（開始 0.5 秒で完了）----
    const animDur = 0.5;
    const animP = Math.min(1, el / animDur);
    let animStyle: React.CSSProperties = {};
    switch (merged.animation) {
        case 'fadeUp':
            animStyle = { opacity: animP, transform: `translateY(${(1 - animP) * 18}px)` };
            break;
        case 'pop': {
            const s = 0.8 + animP * 0.2 + Math.sin(Math.min(1, animP) * Math.PI) * 0.08;
            animStyle = { opacity: animP, transform: `scale(${s})` };
            break;
        }
        case 'slideIn':
            animStyle = { opacity: animP, transform: `translateX(${(1 - animP) * -40}px)` };
            break;
        case 'typewriter': {
            // 文字数 × フレーズ進行度で部分表示
            const chars = Math.ceil(active.text.length * Math.min(1, el / (phraseDur * 0.7)));
            animStyle = {};
            return (
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 40 }}>
                    {renderLyricText(active.text.slice(0, chars), merged, animStyle, null, 0)}
                </div>
            );
        }
        default:
            break;
    }

    // ---- カラオケ塗りつぶし ----
    const karaokeP = merged.karaokeEnabled ? karaokeProgress(timeSec, active) : null;
    return renderLyricText(active.text, merged, animStyle, karaokeP, animP);
};

/** 歌詞テキスト本体の描画（縁取り・影・カラオケ 2 層合成） */
function renderLyricText(
    text: string,
    merged: LyricGlobalStyle & typeof DEFAULT_LYRIC_STYLE,
    animStyle: React.CSSProperties,
    karaokeP: number | null,
    _animP: number,
): React.ReactElement {
    const posStyle: React.CSSProperties =
        merged.position === 'center'
            ? { top: '50%', transform: 'translateY(-50%)' }
            : merged.position === 'top'
                ? { top: 24 }
                : { bottom: 28 };

    const strokeProps: React.CSSProperties = merged.strokeEnabled
        ? {
            WebkitTextStrokeWidth: `${merged.strokeWidthPx ?? 3}px`,
            WebkitTextStrokeColor: merged.strokeColor ?? '#000000',
            paintOrder: 'stroke fill',
        }
        : {};

    const shadowProp: React.CSSProperties = merged.shadow
        ? { filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.85))' }
        : {};

    const baseTextStyle: React.CSSProperties = {
        fontFamily: merged.fontFamily,
        fontSize: merged.fontSizePx,
        fontWeight: 900,
        color: merged.color,
        letterSpacing: '0.02em',
        whiteSpace: 'pre-wrap',
        ...strokeProps,
        ...shadowProp,
    };

    return (
        <div
            style={{
                position: 'absolute',
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent: 'center',
                padding: '0 32px',
                pointerEvents: 'none',
                ...posStyle,
                ...animStyle,
            }}
        >
            {karaokeP == null ? (
                <span style={baseTextStyle}>{text}</span>
            ) : (
                // カラオケ: ベース文字の上に塗り文字を clip-path で左から被せる
                <span style={{ position: 'relative', display: 'inline-block' }}>
                    <span style={{ ...baseTextStyle, visibility: 'hidden' }}>{text}</span>
                    <span
                        aria-hidden
                        style={{
                            ...baseTextStyle,
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            width: '100%',
                            color: merged.karaokeColor ?? '#38bdf8',
                            clipPath: `inset(0 ${(1 - karaokeP) * 100}% 0 0)`,
                        }}
                    >
                        {text}
                    </span>
                </span>
            )}
        </div>
    );
}

/** シーン未設定時のプレースホルダー（i18n 対応） */
const NoScenePlaceholder: React.FC = () => {
    const { t } = useI18n();
    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                background: '#090b10',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b',
                fontSize: 13,
                fontWeight: 700,
            }}
        >
            {t.mvSceneNotSet}
        </div>
    );
};

export const AudioReactiveSandbox: React.FC<AudioReactiveSandboxProps> = ({
    scenes,
    lyrics,
    globalCss = '',
    signals,
    effects = [],
    assets = [],
    lyricStyle = {},
    phaserCanvasRef,
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    // ✨ 現在の再生秒数に応じたアクティブエフェクトと合成スタイルを計算
    const activeFx = useMemo(
        () => getActiveEffectClips(effects, signals.timeSeconds),
        [effects, signals.timeSeconds]
    );
    const fxStyle = useMemo(
        () => computeEffectStyle(activeFx, signals),
        [activeFx, signals]
    );

    // 🎯 現在の再生秒数に応じたアクティブシーンと遷移状態を計算
    const transition = useMemo(
        () => computeSceneTransition(scenes, signals.timeSeconds),
        [scenes, signals.timeSeconds],
    );
    const currentScene = transition.current;

    // 📜 現在の再生秒数に応じたアクティブ歌詞（data-lyric-display 用）
    const currentLyric = useMemo(() => {
        const l = findActiveLyric(lyrics, signals.timeSeconds);
        return l ? l.text : '';
    }, [lyrics, signals.timeSeconds]);

    // ⚡️ 60fps オーディオシグナルを CSS 変数として DOM へリアルタイム注入。
    // useEffect ではなく rAF ループで毎フレーム強制更新することで、
    // React の再レンダリングサイクルに依存せず確実に反映させる。
    const signalsRef = useRef(signals);
    signalsRef.current = signals;
    const currentLyricRef = useRef(currentLyric);
    currentLyricRef.current = currentLyric;

    const currentSceneRef = useRef(currentScene);
    useEffect(() => {
        currentSceneRef.current = currentScene;
    }, [currentScene]);

    useEffect(() => {
        let rafId = 0;
        let active = true;

        const updateCssVars = () => {
            if (!active) return;
            const el = containerRef.current;
            if (el) {
                const sig = signalsRef.current;
                const sc = currentSceneRef.current;
                const isAutoBpm = sc?.audioSyncMode === 'bpm_auto';

                let peakVal = sig.peak;
                let beatVal = sig.beat;
                let lowVal = sig.low;

                if (isAutoBpm) {
                    const bpm = sig.bpm > 0 ? sig.bpm : 120;
                    const beatPeriod = 60 / bpm;
                    const phase = beatPeriod > 0 ? (sig.timeSeconds % beatPeriod) / beatPeriod : 0;
                    beatVal = Math.exp(-phase * 6);
                    const wobble = 0.5 + 0.5 * Math.sin(sig.timeSeconds * 2.4);
                    peakVal = 0.35 + beatVal * 0.45 + wobble * 0.1;
                    lowVal = 0.3 + beatVal * 0.5;
                }

                el.style.setProperty('--audio-peak', peakVal.toFixed(4));
                el.style.setProperty('--audio-low', lowVal.toFixed(4));
                el.style.setProperty('--audio-mid', sig.mid.toFixed(4));
                el.style.setProperty('--audio-high', sig.high.toFixed(4));
                el.style.setProperty('--audio-beat', beatVal.toFixed(4));
                el.style.setProperty('--audio-time', sig.timeSeconds.toFixed(3));

                // 歌詞表示要素（[data-lyric-display]）の内容をリアルタイム更新
                const lyricDisplays = el.querySelectorAll('[data-lyric-display]');
                const lyricText = currentLyricRef.current;
                const activeMode = sc?.lyricDisplayMode ?? (sc?.lyricEffect && sc.lyricEffect !== 'none' ? 'phaser_pixel' : 'preset_box');
                lyricDisplays.forEach((node) => {
                    const htmlNode = node as HTMLElement;
                    if (activeMode !== 'preset_box') {
                        htmlNode.style.display = 'none';
                    } else {
                        htmlNode.style.display = '';
                        if (htmlNode.textContent !== lyricText) {
                            htmlNode.textContent = lyricText;
                        }
                    }
                });
            }
            rafId = requestAnimationFrame(updateCssVars);
        };

        rafId = requestAnimationFrame(updateCssVars);
        return () => {
            active = false;
            cancelAnimationFrame(rafId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // マウント時に1回だけ rAF ループを起動し、ref 経由でシグナルを参照する


    // 🎬 遷移エフェクト用スタイル算出
    const p = transition.progress;
    const inTransition = transition.previous != null && p < 1;
    const activeCssList = inTransitionSafeCss(scenes, transition);
    // svgCode 内 <style> を抽出（グローバル漏れ防止のためスコープ化して適用する）
    const svgStyleCss = useMemo(
        () => extractStyleBlocksFromSvg(currentScene?.svgCode).css,
        [currentScene?.svgCode],
    );
    // すべての CSS を MV ステージ内へスコープ化（アプリ UI への波及を構造的に遮断）
    const scopedCss = useMemo(
        () => scopeMvCss([...activeCssList, svgStyleCss, globalCss].join('\n'), `.${MV_STAGE_CLASS}`),
        [activeCssList, svgStyleCss, globalCss],
    );
    const layerStyleFor = (kind: string, isPrev: boolean): React.CSSProperties => {
        const base: React.CSSProperties = {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
        };
        switch (kind) {
            case 'fade':
                return { ...base, opacity: isPrev ? 1 - p : p };
            case 'slideLeft':
                return { ...base, transform: `translateX(${isPrev ? -p * 100 : (1 - p) * 100}%)` };
            case 'slideRight':
                return { ...base, transform: `translateX(${isPrev ? p * 100 : -(1 - p) * 100}%)` };
            case 'wipe':
                return {
                    ...base,
                    clipPath: isPrev ? undefined : `inset(0 ${(1 - p) * 100}% 0 0)`,
                    zIndex: isPrev ? 0 : 1,
                };
            case 'zoom':
                return {
                    ...base,
                    opacity: isPrev ? 1 - p : p,
                    transform: `scale(${isPrev ? 1 + p * 0.15 : 0.85 + p * 0.15})`,
                };
            default:
                return base;
        }
    };
    const displayMode = currentScene
        ? (currentScene.lyricDisplayMode ?? (currentScene.lyricEffect && currentScene.lyricEffect !== 'none' ? 'phaser_pixel' : 'preset_box'))
        : 'preset_box';
    // テンプレート自身が歌詞表示要素を持つ場合は、保存済み旧設定も含めて
    // 共通歌詞レイヤーを重ねない。歌詞の描画元を必ず1つにする。
    const hasEmbeddedLyricLayer = currentScene?.svgCode?.includes('data-lyric-display') ?? false;

    return (
        <div
            ref={containerRef}
            className={MV_STAGE_CLASS}
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden',
                userSelect: 'none',
                background: '#000000',
                filter: fxStyle.containerFilter,
                transform: fxStyle.containerTransform,
                transition: 'transform 0.05s ease-out',
            }}
        >
            {/* スタイル定義（グローバル CSS ＋ アクティブシーン専用 CSS ＋ 遷移中は前シーン CSS も併用）。
                すべて MV ステージへスコープ化済みのため、AI 生成 CSS がアプリ UI へ漏れない */}
            <style>{scopedCss}</style>

            {/* AI 生成シェーダー背景（shaderCode 持ちシーンのみ。最背面・Phaser の手前） */}
            <MvShaderCanvas
                shaderCode={transition.current?.threeD ? undefined : transition.current?.shaderCode}
                signals={signals}
            />

            <Mv3DSceneCanvas
                sceneConfig={transition.current?.threeD}
                signals={signals}
                sceneStartTime={transition.current?.startTime}
            />

            {/* 最背面: Phaser 4 WebGL パーティクル＆エフェクト＆ピクセル物理文字エンジン */}
            <Phaser4Canvas
                signals={signals}
                theme={transition.current?.phaserTheme ?? 'none'}
                lyricEffect={displayMode === 'phaser_pixel' ? (transition.current?.lyricEffect ?? 'particle_disintegrate') : 'none'}
                lyrics={lyrics}
                canvasRef={phaserCanvasRef}
            />

            {/* 遷移中は前シーンを下層に残してクロス演出 */}
            {inTransition && transition.previous && (
                <div style={layerStyleFor(transition.kind, true)}>
                    <DynamicSceneLayer
                        scene={transition.previous}
                        assets={assets}
                        signals={signals}
                        timeSec={signals.timeSeconds}
                    />
                </div>
            )}

            {/* AI が生成した完全自由な SVG / HTML サンドボックス */}
            {currentScene ? (
                <div
                    style={{
                        ...(inTransition ? layerStyleFor(transition.kind, false) : { width: '100%', height: '100%' }),
                        position: inTransition ? 'absolute' : 'relative',
                    }}
                >
                    <DynamicSceneLayer
                        scene={currentScene}
                        assets={assets}
                        signals={signals}
                        timeSec={signals.timeSeconds}
                    />
                </div>
            ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <NoScenePlaceholder />
                </div>
            )}

            {/* 内蔵歌詞レイヤー（縦位置・アニメーション・カラオケ塗りつぶし対応） */}
            {lyricStyle.showBuiltIn !== false && !hasEmbeddedLyricLayer && displayMode !== 'phaser_pixel' && (
                <BuiltInLyricLayer
                    lyrics={lyrics}
                    timeSec={signals.timeSeconds}
                    styleCfg={lyricStyle}
                />
            )}

            {/* ✨ タイムラインエフェクト・オーバーレイ（フラッシュ＆グレイン） */}
            {fxStyle.flashOpacity > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: fxStyle.flashColor,
                        opacity: fxStyle.flashOpacity,
                        pointerEvents: 'none',
                        zIndex: 80,
                        mixBlendMode: 'screen',
                    }}
                />
            )}
            {fxStyle.filmGrainOpacity > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        background: `radial-gradient(circle, transparent 40%, rgba(0,0,0,${(fxStyle.filmGrainOpacity * 2.2).toFixed(2)}) 100%)`,
                        pointerEvents: 'none',
                        zIndex: 81,
                    }}
                />
            )}
        </div>
    );
};
