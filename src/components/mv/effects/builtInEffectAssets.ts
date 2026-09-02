//==============================================================================
// builtInEffectAssets.ts - 実機機材・シネマティック標準エフェクトプリセット
//==============================================================================

import type { MvEffectAsset } from './types';

export const BUILT_IN_EFFECT_ASSETS: MvEffectAsset[] = [
    {
        id: 'preset_fx_rgb_glitch',
        name: 'RGB 色収差グリッチ',
        kind: 'rgb_glitch',
        description: 'ビートに同期してRGBチャンネルが横方向に分離・ズレるサイバーグリッチ。サビやドロップのインパクトに最適。',
        intensity: 0.85,
        colorTag: '#38bdf8', // スカイブルー
        savedAt: 0,
        isCustom: false,
    },
    {
        id: 'preset_fx_film_grain',
        name: 'フィルムグレイン＆シネマビネット',
        kind: 'film_grain',
        description: '映画用35mmフィルムのような粒子ノイズと周辺減光（ビネット）を付加し、重厚な質感を与える。',
        intensity: 0.6,
        colorTag: '#f59e0b', // アンバー
        savedAt: 0,
        isCustom: false,
    },
    {
        id: 'preset_fx_vhs_distortion',
        name: 'CRT 走査線＆テープ歪み',
        kind: 'vhs_distortion',
        description: 'アナログモニターの走査線と水平同期ズレ、微細なジッターを再現するレトロハードウェア演出。',
        intensity: 0.75,
        colorTag: '#10b981', // エメラルドグリーン
        savedAt: 0,
        isCustom: false,
    },
    {
        id: 'preset_fx_bloom_glow',
        name: 'ハイライト・ブルーム発光',
        kind: 'bloom_glow',
        description: '高輝度部分が柔らかく周囲に光を滲ませるアナモルフィック・グロー効果。',
        intensity: 0.7,
        colorTag: '#a855f7', // パープル
        savedAt: 0,
        isCustom: false,
    },
    {
        id: 'preset_fx_camera_zoom_pan',
        name: 'ダイナミック・カメラキック',
        kind: 'camera_zoom_pan',
        description: 'ビートの頭で瞬間的にズームインし、緩やかに元の画角に戻る躍動的なカメラ演出。',
        intensity: 0.8,
        colorTag: '#06b6d4', // シアン
        savedAt: 0,
        isCustom: false,
    },
    {
        id: 'preset_fx_invert_flash',
        name: '色相反転ネガ・インパクト',
        kind: 'invert_flash',
        description: 'キックまたはブレイクで一瞬色相を反転させ、視覚的なコントラストショックを生み出す。',
        intensity: 1.0,
        colorTag: '#e11d48', // ディープローズ
        savedAt: 0,
        isCustom: false,
    },
    {
        id: 'preset_fx_lens_blur',
        name: '被写界深度レンズブラー',
        kind: 'lens_blur',
        description: 'イントロや間奏で画面全体を心地よくボカし、歌詞やフォーカス要素を引き立てる。',
        intensity: 0.65,
        colorTag: '#64748b', // スレート
        savedAt: 0,
        isCustom: false,
    },
];
