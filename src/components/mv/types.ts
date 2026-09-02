import type { Mv3DSceneConfig } from './mv3dScene';

export interface LyricItem {
    /**
     * 安定 ID。バグ修正: UI 編集時の indexOf 取り違え（同じ time/同じ text の
     * 重複行で indexOf が常に 0 を返す問題）を解消するため、フレーズ毎に
     * 永続 ID を持たせる。LRC インポート・AI 文字起こし・手動追加のいずれでも
     * 必ず setLyricId() で採番する。
     */
    id?: string;
    time: number;       // 開始秒数
    duration?: number;   // 表示持続秒数（省略時は次の歌詞まで）
    text: string;       // 歌詞テキスト
    stylePreset?: string; // 個別スタイル指定（neon, glitch, classic等）
}

/**
 * 歌詞フレーズに安定した一意 ID を付与する（同 time/同 text の重複でも識別可能にする）。
 * 既存 ID はそのまま保持し、未付与の要素にのみ新規 ID を生成する。
 */
export function ensureLyricIds<T extends LyricItem>(lyrics: T[]): T[] {
    let counter = 0;
    const seen = new Set<string>();
    return lyrics.map((l) => {
        if (l.id && !seen.has(l.id)) {
            seen.add(l.id);
            return l;
        }
        let newId: string;
        do {
            counter += 1;
            newId = `ly_${Date.now().toString(36)}_${counter.toString(36)}`;
        } while (seen.has(newId));
        seen.add(newId);
        return { ...l, id: newId };
    });
}

//==============================================================================
// 歌詞グローバルスタイル（カラオケ・アニメーション含む）
//==============================================================================

/** 歌詞の表示アニメーション種別 */
export type LyricAnimationKind =
    | 'none'        // アニメーションなし
    | 'fadeUp'      // フェードしながら下から浮上
    | 'typewriter'  // 一文字ずつタイプライター表示
    | 'pop'         // ポップイン（スケール）
    | 'slideIn';    // 左からスライドイン

/** 歌詞の縦位置 */
export type LyricPositionKind = 'bottom' | 'center' | 'top';

/** 全歌詞共通の表示スタイル設定 */
export interface LyricGlobalStyle {
    fontFamily?: string;
    fontSizePx?: number;
    color?: string;
    /** 縁取りを有効化 */
    strokeEnabled?: boolean;
    strokeColor?: string;
    strokeWidthPx?: number;
    /** 影を付ける */
    shadow?: boolean;
    position?: LyricPositionKind;
    animation?: LyricAnimationKind;
    /** カラオケ式塗りつぶしアニメーション */
    karaokeEnabled?: boolean;
    karaokeColor?: string;
    /** サンドボックス内蔵の歌詞レイヤーを表示するか（false で data-lyric-display のみ） */
    showBuiltIn?: boolean;
}

//==============================================================================
// シーン遷移エフェクト
//==============================================================================

/** シーン遷移エフェクト種別 */
export type MvTransitionKind =
    | 'none'      // 遷移なし（即切替）
    | 'fade'      // クロスフェード
    | 'slideLeft' // 左へスライドイン
    | 'slideRight'// 右へスライドイン
    | 'wipe'      // 左からワイプ
    | 'zoom';     // ズームイン

//==============================================================================
// キーフレームアニメーション
//==============================================================================

/** キーフレームで制御できるプロパティ種別 */
export type KeyframeProperty =
    | 'opacity'
    | 'scale'
    | 'rotateDeg'
    | 'translateXPct'
    | 'translateYPct'
    | 'blurPx'
    | 'brightness';

/** 単一キーフレーム。t はシーン内相対進行度 0〜1 */
export interface MvKeyframe {
    t: number;
    value: number;
    /** このキーフレームから次へかけての補間カーブ */
    easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
}

/** プロパティごとのキーフレーム列 */
export type SceneKeyframes = Partial<Record<KeyframeProperty, MvKeyframe[]>>;

//==============================================================================
// シーン ＆ プロジェクト設定
//==============================================================================

/** Phaser 4 WebGL ビジュアルテーマ種別（プロ機材・シネマティック・非サイバー） */
export type PhaserThemeKind =
    | 'none'              // オフ（演出なし）
    | 'oscilloscope'      // 実機アナログ・オシロスコープ（リサジュー＆フォスファー残光）
    | 'fluid_aurora'      // シネマティック流体オーロラ（多層光帯）
    | 'ambient_bokeh'     // 大気光彩ダスト（浮遊ミスト＆ソフトボケ粒子）
    | 'spectrum_bars';    // スタジオ・リアルタイム精密イコライザー

/** オーディオ同期方式 */
export type AudioSyncMode =
    | 'daw_realtime'    // DAW リアルタイム同期（トラックの生音・強弱に追従）
    | 'bpm_auto';       // BPM オート・ビート同期（理想的なキレキレ拍リズム）

/** 歌詞の表示レイヤー選択モード */
export type LyricDisplayMode =
    | 'preset_box'      // プリセットデザイン（標準）
    | 'phaser_pixel'    // 粒子物理文字（崩壊・合体）
    | 'top_telop'       // 上部テロップ
    | 'none';           // 非表示

/** Phaser 4 キネティック・リリック（文字遊び）演出スタイル種別 */
export type LyricEffectKind =
    | 'none'                   // オフ（ピクセル文字なし）
    | 'particle_disintegrate'   // 1. 文字の粒子崩壊（万単位のチリ・爆散）
    | 'kinetic_assembly'       // 2. 幾何学構築・合体（パーツ飛来・スナップ合体）
    | 'liquid_morph'           // 3. 液体モーフィング（ドロドロ有機変形）
    | 'impact_reactive'        // 4. 衝撃波インパクト（キック完全同期・スプリング）
    | 'glitch_neon'            // 5. ネオン発光＆RGBグリッチ（色収差）
    | 'camera_warp';           // 6. 3Dカメラ・ワープ（空間突き抜け）

export interface MvScene {
    id: string;
    name: string;
    startTime: number;  // シーン開始秒数
    endTime: number;    // シーン終了秒数
    svgCode?: string;    // AIが生成した生のSVG / HTMLテンプレート
    cssCode?: string;   // シーン専用CSSアニメーション定義
    customScript?: string; // 任意のJSロジック（限定APIでサンドボックス実行）
    /** Phaser 4 WebGL バックグラウンドテーマ（未指定時は none） */
    phaserTheme?: PhaserThemeKind;
    /** キネティック・リリック演出（未指定時は none） */
    lyricEffect?: LyricEffectKind;
    /** 歌詞の表示レイヤーモード（未指定時は preset_box） */
    lyricDisplayMode?: LyricDisplayMode;
    /** オーディオ同期方式（未指定時は daw_realtime） */
    audioSyncMode?: AudioSyncMode;
    /** このシーンへの遷移エフェクト種別（未指定時は none） */
    transition?: MvTransitionKind;
    /** 遷移エフェクトの持続秒数（未指定時は 0.6 秒） */
    transitionDurationSec?: number;
    /** シーン背景に敷く画像アセット ID（未指定時は背景なし） */
    backgroundImageId?: string;
    /** シーン内キーフレームアニメーション定義 */
    keyframes?: SceneKeyframes;
    /**
     * AI 生成 GPU 背景シェーダー（TSL ノードグラフの関数本体文字列）。
     * (tsl, u) の本体として評価され、TSL 色ノードを return する。
     * 検証ハーネス（verifyTslShader）を通過したコードのみ設定されること。
     * 未指定時は従来の Phaser 背景テーマで描画される。
     */
    shaderCode?: string;
    /** 宣言的な3D背景シーン（未指定時は従来の背景経路） */
    threeD?: Mv3DSceneConfig;
    /** このシーンのアートディレクション（プロンプトの空気のデータ化）。AI の自己検証・修正ループの基準 */
    artDirection?: string;
}

/** 素材ライブラリに登録された画像アセット */
export interface MvImageAsset {
    id: string;
    name: string;
    /** data URL 形式の画像本体 */
    dataUrl: string;
    addedAt: number;
}

export interface MvProjectConfig {
    title: string;
    scenes: MvScene[];
    lyrics: LyricItem[];
    globalCss?: string;
    activePresetId?: string;
    /** 全歌詞共通スタイル（未指定時はデフォルト適用） */
    lyricStyle?: LyricGlobalStyle;
    /** 素材ライブラリ（シーン背景などに使用する画像） */
    assets?: MvImageAsset[];
    /** タイムラインエフェクトクリップ（サビグリッチ、フラッシュ等） */
    effects?: import('./effects/types').MvEffectClip[];
    /** 保存されたエフェクトアセットライブラリ */
    effectAssets?: import('./effects/types').MvEffectAsset[];
    /**
     * プレビューフレームの解像度プリセット ID（mvExportPresets.ts 参照）。
     * エクスポートモーダル / 中央プレビューのクイック切替と双方向同期し、
     * 選択したアスペクト比でプレビューがレターボックス表示される。
     * 未指定時は既定プリセット（16:9 Full HD）。
     */
    previewResolutionId?: string;
}

export type { MvEffectClip, MvEffectAsset, MvEffectKind } from './effects/types';

export interface AudioSignals {
    peak: number;        // 音量ピーク (0.0 〜 1.0)
    low: number;         // 低音帯域エネルギー (0.0 〜 1.0)
    mid: number;         // 中音帯域エネルギー (0.0 〜 1.0)
    high: number;        // 高音帯域エネルギー (0.0 〜 1.0)
    beat: number;        // BPMテンポに同期した拍パルス (0.0 〜 1.0)
    isPlaying: boolean;  // 再生中フラグ
    timeSeconds: number; // 現在のセッション再生位置
    bpm: number;         // テンポ
    spectrum?: number[]; // 実測FFTスペクトラム（正規化 0.0〜1.0、対数周波数バンド）
    /**
     * リップシンク用 viseme（母音）。TrackSignalHub のフォルマント推定
     * または ASR タイムラインの結果。未接続・無音時は "sil" / 0.0。
     */
    viseme?: VisemeKind;
    /** 口パク開口量 0..1。SVG の口の開きや大きさにスケール適用できる */
    visemeStrength?: number;
    /**
     * ステム分離由来の強化シグナル（未分離プロジェクトでは undefined）。
     * drumPulse = 実測ドラム onset パルス / vocalEnergy = 実測発声エネルギー /
     * bassEnergy = 実測低域エネルギー。stemAnalysis/stemSignals.ts 参照。
     */
    stem?: StemSignals;
}

// mv/types.ts 内で完結させるため AudioSignals と並べて export。
// 実体は native.ts と同じ 7 値 (a/i/u/e/o/sil/x) に固定し、
// C++ 側 VisemeCore::label() と完全同期させる。
export type VisemeKind = 'a' | 'i' | 'u' | 'e' | 'o' | 'sil' | 'x';

import type { StemSignals } from './stemAnalysis/types';
export type { StemSignals };
