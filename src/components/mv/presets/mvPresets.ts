import { MvProjectConfig } from '../types';
import { getDict } from '../../../i18n';

/**
 * 世界観プリセット定義（言語非依存の中身）。
 * title / activePresetId / シーン名は buildPresets() で現在言語辞書から解決する。
 * (2026-08: oscilloscope_analog プリセットを削除。既定は pixel_glitch_minimal)
 */
const PRESET_BODIES: Record<string, Omit<MvProjectConfig, 'title'>> = {
    // 1. 2値ピクセル & ミニマルグリッチ（2値モノトーン・ピクセル記号）

    // 2. ミニマルピクセルグリッチワールド（2値ピクセル・グリッド＆グリッチ）※完全維持
    pixel_glitch_minimal: {
        activePresetId: 'pixel_glitch_minimal',
        // 人間向けテンプレートは、テンプレート内の歌詞デザインだけを使用する。
        lyricStyle: { showBuiltIn: false },
        globalCss: `
            .glitch-container {
                width: 100%;
                height: 100%;
                background: #000000;
                color: #ffffff;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: hidden;
                font-family: 'Courier New', monospace;
                image-rendering: pixelated;
            }
            .grid-bg {
                position: absolute;
                inset: 0;
                background-size: 24px 24px;
                background-image: 
                    linear-gradient(to right, rgba(255, 255, 255, 0.07) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(255, 255, 255, 0.07) 1px, transparent 1px);
                opacity: calc(0.4 + var(--audio-beat) * 0.6);
            }
            .pixel-symbol {
                transform: scale(calc(1.0 + var(--audio-peak) * 0.5)) rotate(calc(var(--audio-beat) * 90deg));
                filter: contrast(200%);
                transition: transform 0.04s cubic-bezier(0.1, 1, 0.1, 1);
            }
            .lyric-box-glitch {
                position: absolute;
                bottom: 14%;
                background: #ffffff;
                color: #000000;
                padding: 4px 16px;
                font-size: 20px;
                font-weight: 900;
                letter-spacing: 0.15em;
                box-shadow: 6px 6px 0px #000000, 8px 8px 0px #ffffff;
                transform: translate(calc(var(--audio-low) * 4px - 2px), calc(var(--audio-high) * -4px + 2px));
            }
            .scanline {
                position: absolute;
                inset: 0;
                background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%);
                background-size: 100% 4px;
                pointer-events: none;
                z-index: 30;
            }
        `,
        scenes: [
            {
                id: 'scene_pixel_minimal',
                name: 'Pixel',
                startTime: 0,
                endTime: 300,
                phaserTheme: 'spectrum_bars',
                svgCode: `
                    <div class="glitch-container">
                        <div class="grid-bg"></div>
                        <div class="scanline"></div>

                        <!-- ピクセルアート風 幾何記号 -->
                        <svg class="pixel-symbol" width="160" height="160" viewBox="0 0 16 16" fill="#ffffff">
                            <!-- 外枠フレーム -->
                            <rect x="0" y="0" width="16" height="2" />
                            <rect x="0" y="14" width="16" height="2" />
                            <rect x="0" y="0" width="2" height="16" />
                            <rect x="14" y="0" width="2" height="16" />
                            
                            <!-- 内部アイコン（不穏なピクセル目・記号） -->
                            <rect x="4" y="4" width="8" height="8" fill="#ffffff" />
                            <rect x="6" y="6" width="4" height="4" fill="#000000" />
                            <rect x="7" y="7" width="2" height="2" fill="#ffffff" />
                            
                            <!-- 4隅の装飾ドット -->
                            <rect x="3" y="3" width="1" height="1" fill="#ffffff" />
                            <rect x="12" y="3" width="1" height="1" fill="#ffffff" />
                            <rect x="3" y="12" width="1" height="1" fill="#ffffff" />
                            <rect x="12" y="12" width="1" height="1" fill="#ffffff" />
                        </svg>

                        <!-- リアルタイム歌詞 -->
                        <div class="lyric-box-glitch" data-lyric-display="true"></div>
                    </div>
                `,
            },
        ],
        lyrics: [
            { time: 0.0, duration: 3.5, text: '■ 点滅する回路の信号' },
            { time: 4.0, duration: 4.0, text: '▲ 狂ったバイナリの夢を見る' },
            { time: 8.5, duration: 5.0, text: '● 0と1の狭間で消えた' },
        ],
    },

    // 3. シネマティック・ミスト & モノリス（映画的・大気光・深淵アート）
    cinematic_atmosphere: {
        activePresetId: 'cinematic_atmosphere',
        lyricStyle: { showBuiltIn: false },
        globalCss: `
            .cine-container {
                width: 100%;
                height: 100%;
                background: radial-gradient(circle at 50% 40%, #111827 0%, #030712 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: hidden;
            }
            .monolith {
                position: absolute;
                width: 18vmin;
                height: 48vmin;
                background: linear-gradient(180deg, #1f2937 0%, #0f172a 100%);
                border: 1px solid rgba(148, 163, 184, 0.25);
                box-shadow: 0 0 calc(20px + var(--audio-low) * 40px) rgba(99, 102, 241, 0.35);
                transform: scaleY(calc(0.95 + var(--audio-peak) * 0.15));
                transition: transform 0.06s ease;
            }
            .halo-ring {
                position: absolute;
                width: 55vmin;
                height: 55vmin;
                border-radius: 50%;
                border: 1px solid rgba(226, 232, 240, 0.15);
                transform: scale(calc(0.9 + var(--audio-low) * 0.25));
                transition: transform 0.08s ease;
            }
            .lyric-box-cine {
                position: absolute;
                bottom: 12%;
                left: 50%;
                transform: translateX(-50%);
                font-family: 'Hiragino Mincho ProN', 'Yu Mincho', serif;
                font-size: 19px;
                font-weight: 500;
                color: #f8fafc;
                letter-spacing: 0.3em;
                text-shadow: 0 2px 10px rgba(0, 0, 0, 0.9);
                text-align: center;
                white-space: nowrap;
                z-index: 20;
            }
        `,
        scenes: [
            {
                id: 'scene_cine_monolith',
                name: 'Cinematic',
                startTime: 0,
                endTime: 300,
                phaserTheme: 'fluid_aurora',
                svgCode: `
                    <div class="cine-container">
                        <!-- リアルタイム歌詞 -->
                        <div class="lyric-box-cine" data-lyric-display="true"></div>
                    </div>
                `,
            },
        ],
        lyrics: [
            { time: 0.0, duration: 4.0, text: '静寂の中に 佇む意志' },
            { time: 4.5, duration: 4.0, text: '深淵の光が 大気を満たす' },
            { time: 9.0, duration: 5.0, text: '遠く微かに 息づく鼓動' },
        ],
    },

    // 4. リップシンク対応キャラクター
    lipsync_character: {
        activePresetId: 'lipsync_character',
        lyricStyle: { showBuiltIn: false },
        globalCss: `
            .lip-container {
                width: 100%;
                height: 100%;
                background: radial-gradient(circle at 50% 45%, #1e293b 0%, #0f172a 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                overflow: hidden;
            }
            .lip-face {
                width: 60vmin;
                height: 60vmin;
                filter: drop-shadow(0 8px 24px rgba(56, 189, 248, 0.25));
            }
            .lip-mouth {
                /* 通常時は非表示。--lip-active-* と一致する [data-lip] だけ表示。
                   バグ修正: 旧版は sil 用 path の opacity を 1-strength で制御していたが、
                   弧の口と重なり「棒線が常に見える」事故が起きていた。
                   新版は sil を完全廃止し、5 母音 + transform: scaleY() で開閉する。
                   消える時: 即座に (0.04s)。「残影」を残さない
                   出てくる時: ふわっと (0.12s)。自然な口パクの入り */
                opacity: 0;
                transition: opacity 0.04s linear, transform 0.12s ease-out;
                transform-box: fill-box;
                transform-origin: center;
                /* visemeStrength=0 のとき scaleY(0.2) で「閉じた口」、
                   visemeStrength=1 のとき scaleY(1) で「開いた口」。 */
                transform: scaleY(calc(0.2 + var(--lip-strength, 0) * 0.8));
            }
            .lip-mouth[data-lip="a"]   { opacity: var(--lip-active-a, 0); }
            .lip-mouth[data-lip="i"]   { opacity: var(--lip-active-i, 0); }
            .lip-mouth[data-lip="u"]   { opacity: var(--lip-active-u, 0); }
            .lip-mouth[data-lip="e"]   { opacity: var(--lip-active-e, 0); }
            .lip-mouth[data-lip="o"]   { opacity: var(--lip-active-o, 0); }
            /* 無音 (vis='sil') 時は 5 母音すべて opacity=0 にすると customScript 側で
               設定する。口を閉じた印象にしたいときは a の口を scaleY(0.05) で縮める。 */
            .lip-lyric {
                position: absolute;
                bottom: 8%;
                left: 50%;
                transform: translateX(-50%);
                font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif;
                font-size: 28px;
                font-weight: 700;
                color: #e0f2fe;
                text-shadow: 0 0 16px rgba(56, 189, 248, 0.7);
                letter-spacing: 0.18em;
                text-align: center;
                z-index: 20;
            }
            @keyframes lipBob {
                0%   { transform: translateY(0); }
                50%  { transform: translateY(calc(var(--audio-beat) * -10px)); }
                100% { transform: translateY(0); }
            }
            .lip-face-wrap {
                animation: lipBob 0.6s ease-in-out infinite;
            }
        `,
        scenes: [
            {
                id: 'scene_lipsync',
                name: 'Lipsync',
                startTime: 0,
                endTime: 300,
                svgCode: `
                    <div class="lip-container">
                        <div class="lip-face-wrap">
                            <!-- シンプルな顔: 顔輪郭・目・鼻・口（5 母音 + 無音） -->
                            <svg class="lip-face" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                                <!-- 顔 -->
                                <circle cx="100" cy="100" r="80" fill="#fcd9b6" stroke="#0c1220" stroke-width="3"/>
                                <!-- 目 -->
                                <ellipse cx="68" cy="80" rx="8" ry="10" fill="#0c1220"/>
                                <ellipse cx="132" cy="80" rx="8" ry="10" fill="#0c1220"/>
                                <!-- 鼻 -->
                                <path d="M 100,95 L 95,115 L 105,115 Z" fill="none" stroke="#0c1220" stroke-width="2"/>
                                <!-- 口（5 母音のみ）。customScript が --lip-active-* を切替。
                                     バグ修正: 旧版は sil 用の水平直線 path が口の弧の上に乗ってしまい
                                     「口の上に棒線が常に見える」事故が起きていた。口を閉じる手段は
                                     transform: scaleY(0) に統一し、sil 用 path は完全削除。
                                     喋る⇔黙るの切り替わりは CSS transition (0.15s) でふわっとなめらかに。 -->
                                <path class="lip-mouth" data-lip="a"   d="M 65,138 Q 100,165 135,138" fill="none" stroke="#0c1220" stroke-width="3" stroke-linecap="round"/>
                                <path class="lip-mouth" data-lip="i"   d="M 60,140 Q 100,148 140,140" fill="none" stroke="#0c1220" stroke-width="3" stroke-linecap="round"/>
                                <path class="lip-mouth" data-lip="u"   d="M 78,140 Q 100,152 122,140" fill="none" stroke="#0c1220" stroke-width="3" stroke-linecap="round"/>
                                <path class="lip-mouth" data-lip="e"   d="M 66,139 Q 100,156 134,139" fill="none" stroke="#0c1220" stroke-width="3" stroke-linecap="round"/>
                                <path class="lip-mouth" data-lip="o"   d="M 73,134 Q 100,166 127,134" fill="none" stroke="#0c1220" stroke-width="3" stroke-linecap="round"/>
                            </svg>
                        </div>
                        <div class="lip-lyric" data-lyric-display="true"></div>
                    </div>
                `,
                // customScript: audio.viseme / visemeStrength を
                // CSS 変数として毎フレーム配信。SVG パス自体は CSS で切替。
                customScript: `
                    const vis = (api.audio.viseme || 'sil');
                    let strength = Math.max(0, Math.min(1, api.audio.visemeStrength || 0));
                    const keys = ['a', 'i', 'u', 'e', 'o'];
                    const isVoiced = (vis === 'a' || vis === 'i' || vis === 'u' || vis === 'e' || vis === 'o');
                    // バグ修正: 旧版は sil 用に水平直線 path を常駐表示していた。
                    // → 「口の上に棒線が常に見える」事故が起きていた。
                    // 新方式: 5 母音のみ、黙ってる時 (= sil / x / 歌詞外) は
                    // 全 5 母音を opacity=0 にして口そのものを消す。
                    // 有音→無音の切替は CSS transition (0.15s ease-out) で
                    // ふわっと自然になくなる。
                    if (!isVoiced) {
                        // 無音: 口を完全に消す
                        strength = 0;
                    }
                    api.setVar('--lip-strength', String(strength));
                    // 5 母音のうち該当するものだけ 1.0、無音時は 5 母音すべて 0
                    for (const k of keys) {
                        api.setVar('--lip-active-' + k, (isVoiced && vis === k) ? '1' : '0');
                    }
                `,
            },
        ],
        lyrics: [
            { time: 0.0, duration: 4.0, text: 'ハロー ボイス' },
            { time: 4.5, duration: 4.0, text: 'リップシンク テスト' },
            { time: 9.0, duration: 5.0, text: 'SVG と viseme で歌わせる' },
        ],
    },

    // 4. AI制作向けの空白キャンバス
    blank_ai_canvas: {
        activePresetId: 'blank_ai_canvas',
        globalCss: '',
        scenes: [
            {
                id: 'scene_blank_ai_canvas',
                name: 'Blank',
                startTime: 0,
                endTime: 300,
                phaserTheme: 'none',
                lyricDisplayMode: 'none',
                lyricEffect: 'none',
                svgCode: '',
            },
        ],
        lyrics: [],
        // AI が set_mv_lyric_style を呼ぶまで、歌詞レイヤーも表示しない。
        lyricStyle: { showBuiltIn: false },
    },
};

/** タイトル・プリセット ID・シーン名を現在言語で解決して返す */
function buildPresets(): Record<string, MvProjectConfig> {
    const t = getDict();
    const out: Record<string, MvProjectConfig> = {};
    const titles: Record<string, { title: string; id: string; scene: string }> = {
        pixel_glitch_minimal: { title: t.presetTitlePixel, id: 'pixel_glitch_minimal', scene: t.presetScenePixel },
        cinematic_atmosphere: { title: t.presetTitleCinematic, id: 'cinematic_atmosphere', scene: t.presetSceneCinematic },
        lipsync_character: { title: t.presetTitleLipsync, id: 'lipsync_character', scene: t.presetSceneLipsync },
        blank_ai_canvas: { title: t.presetTitleBlankAi, id: 'blank_ai_canvas', scene: t.presetSceneBlankAi },
    };
    for (const [key, body] of Object.entries(PRESET_BODIES)) {
        const meta = titles[key];
        out[key] = {
            ...body,
            title: meta.title,
            activePresetId: meta.id,
            scenes: body.scenes.map((s) => ({ ...s, name: meta.scene })),
        };
    }
    return out;
}

/** 現在言語で解決された世界観プリセット一覧（毎回新規オブジェクト） */
export function getDefaultMvPresets(): Record<string, MvProjectConfig> {
    return buildPresets();
}

/**
 * MV 設定の既定値。バグ修正: 旧実装は存在しないプリセットキー
 * (geometric_psychedelic) を参照しており、保存済み設定が無い環境
 * (Web 版初回起動・新規プロジェクト初回 MV 表示) で mvConfig が
 * undefined になりワークスペースがクラッシュしていた。
 * 実在する最初のプリセットを正とし、型レベルでもキー参照ミスを防ぐ。
 * (2026-08: oscilloscope_analog プリセット削除に伴い、2値ピクセルを既定に)
 */
export function getDefaultMvConfig(): MvProjectConfig {
    return getDefaultMvPresets().pixel_glitch_minimal;
}
