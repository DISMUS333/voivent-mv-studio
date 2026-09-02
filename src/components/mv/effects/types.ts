//==============================================================================
// types.ts - MV エフェクトクリップおよびエフェクトアセットの型定義
//==============================================================================

/** エフェクトの種類 */
export type MvEffectKind =
    | 'rgb_glitch'           // RGB 色収差グリッチ
    | 'beat_flash'           // キック同期ホワイト/ネガフラッシュ
    | 'film_grain'           // フィルムグレイン＆シネマビネット
    | 'camera_zoom_pan'      // ダイナミックカメラズーム・パン
    | 'chromatic_aberration' // 色ズレ・プリズム分散
    | 'bloom_glow'           // 高輝度ブルーム発光
    | 'vhs_distortion'       // CRT 走査線＆歪み
    | 'lens_blur'            // レンズ被写界深度ブラー
    | 'invert_flash'         // 色相反転インパクト
    | 'custom_shader'        // 独自 TSL シェーダーエフェクト
    | 'custom_css';          // 独自 CSS アニメーション

/** タイムライン上に配置されるエフェクトクリップ */
export interface MvEffectClip {
    id: string;
    name: string;
    kind: MvEffectKind;
    startTime: number;  // タイムライン開始秒数
    endTime: number;    // タイムライン終了秒数
    intensity?: number; // エフェクト強度 0.0 〜 1.0 (既定 1.0)
    enabled?: boolean;  // false のとき一時的に無効化
    shaderCode?: string; // custom_shader の場合の TSL コード
    cssCode?: string;    // custom_css の場合の CSS
    params?: Record<string, number | string | boolean>;
}

/** アセットライブラリに保存されるエフェクトプリセット */
export interface MvEffectAsset {
    id: string;
    name: string;
    kind: MvEffectKind;
    description: string;
    intensity?: number;
    shaderCode?: string;
    cssCode?: string;
    params?: Record<string, number | string | boolean>;
    savedAt: number;
    isCustom?: boolean; // AI 生成またはユーザー自作
    colorTag?: string;  // タイムライン上のバッジ色
}

/** エフェクトクリップの一意 ID 採番 */
export function ensureEffectClipIds<T extends MvEffectClip>(clips: T[] | undefined | null): T[] {
    if (!clips || !Array.isArray(clips)) return [];
    let counter = 0;
    const seen = new Set<string>();
    return clips.map((clip) => {
        if (clip.id && !seen.has(clip.id)) {
            seen.add(clip.id);
            return clip;
        }
        let newId: string;
        do {
            counter += 1;
            newId = `fx_${Date.now().toString(36)}_${counter.toString(36)}`;
        } while (seen.has(newId));
        seen.add(newId);
        return { ...clip, id: newId };
    });
}
