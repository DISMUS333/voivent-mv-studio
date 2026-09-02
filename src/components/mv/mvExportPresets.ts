//==============================================================================
// MV エクスポート解像度プリセット定義とプレビューフレーム計算ユーティリティ。
// エクスポートモーダルと中央プレビュー（レターボックスフレーム）の
// 双方向同期の単一ソースとして機能する。描画に依存しない純粋関数のみ。
//==============================================================================

import { getDict } from '../../i18n';

/** エクスポート解像度プリセット */
export interface ResolutionPreset {
    id: string;
    label: string;
    subLabel: string;
    width: number;
    height: number;
    platform: string;
}

/** エクスポートビットレートプリセット */
export interface BitratePreset {
    id: string;
    label: string;
    subLabel: string;
    bps: number;
}

/** 言語ごとに表示ラベルが切り替わる解像度プリセット（id・寸法は不変） */
export function getResolutionPresets(): ResolutionPreset[] {
    const t = getDict();
    return [
        { id: 'youtube_fhd', label: '1920 × 1080', subLabel: 'Full HD', width: 1920, height: 1080, platform: t.resPlatformYouTube },
        { id: 'shorts_fhd', label: '1080 × 1920', subLabel: 'Vertical HD', width: 1080, height: 1920, platform: t.resPlatformShorts },
        { id: 'square_hd', label: '1080 × 1080', subLabel: 'Square HD', width: 1080, height: 1080, platform: t.resPlatformSquare },
        { id: 'hd720', label: '1280 × 720', subLabel: 'HD 720p', width: 1280, height: 720, platform: t.resPlatformHd },
        { id: 'shorts_720', label: '720 × 1280', subLabel: 'Vertical 720p', width: 720, height: 1280, platform: t.resPlatformShortsLite },
    ];
}

/** 言語ごとに表示ラベルが切り替わるビットレートプリセット */
export function getBitratePresets(): BitratePreset[] {
    const t = getDict();
    return [
        { id: 'hq', label: t.bitrateHq, subLabel: '12 Mbps', bps: 12_000_000 },
        { id: 'std', label: t.bitrateStd, subLabel: '6 Mbps', bps: 6_000_000 },
        { id: 'lite', label: t.bitrateLite, subLabel: '3 Mbps', bps: 3_000_000 },
    ];
}

/** 既定の解像度プリセット ID（16:9 Full HD） */
export const DEFAULT_RESOLUTION_ID = 'youtube_fhd';

/**
 * プリセット ID から解像度プリセットを解決する。
 * 未知・空・型不一致の ID はすべて既定プリセットへフォールバックする
 * （旧セーブデータや破損データでも必ず有効なプリセットを返す）。
 */
export function resolveResolution(id: string | null | undefined): ResolutionPreset {
    if (typeof id === 'string' && id) {
        const found = getResolutionPresets().find((p) => p.id === id);
        if (found) return found;
    }
    return getResolutionPresets()[0];
}

/** 最大公約数（ユークリッド互除法）。0 以下は絶対値へ正規化 */
export function gcd(a: number, b: number): number {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y > 0) {
        const t = x % y;
        x = y;
        y = t;
    }
    return x;
}

/**
 * アスペクト比ラベル（例: 1920×1080 → "16:9"、1080×1080 → "1:1"）。
 * 整数比に約分できない極端な比率では "16:9" の代わりに小数比は返さず、
 * 元の寸法ベースの近似整数比を返す。
 */
export function aspectLabel(width: number, height: number): string {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return '—';
    }
    const g = gcd(width, height);
    const rw = Math.round(width / g);
    const rh = Math.round(height / g);
    // 長辺が 40 を超える約分結果は実用比として長すぎるため小数表記へフォールバック
    if (rw > 40 || rh > 40) {
        return `${(width / height).toFixed(2).replace(/\.00$/, '')}:1`;
    }
    return `${rw}:${rh}`;
}

/** レターボックス計算結果（コンテナ内の中央配置フレーム） */
export interface LetterboxFrame {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
}

/**
 * コンテナサイズにターゲットアスペクト比（プリセット解像度）を
 * 可能な最大サイズで中央フィットさせたフレーム矩形を返す。
 * コンテナが未計測（0 以下）やターゲット不正時はコンテナ全体を返す。
 */
export function computeLetterboxFrame(
    containerW: number,
    containerH: number,
    targetW: number,
    targetH: number,
): LetterboxFrame {
    const cw = Math.max(1, Math.floor(containerW));
    const ch = Math.max(1, Math.floor(containerH));
    if (!Number.isFinite(targetW) || !Number.isFinite(targetH) || targetW <= 0 || targetH <= 0) {
        return { width: cw, height: ch, offsetX: 0, offsetY: 0 };
    }
    const scale = Math.min(cw / targetW, ch / targetH);
    const width = Math.max(1, Math.floor(targetW * scale));
    const height = Math.max(1, Math.floor(targetH * scale));
    return {
        width,
        height,
        offsetX: Math.floor((cw - width) / 2),
        offsetY: Math.floor((ch - height) / 2),
    };
}

/**
 * アスペクト比ダイアグラム（モーダル内の小プレビュー枠など）の
 * 表示サイズを maxW × maxH に収まるよう計算する。
 */
export function aspectDiagramBox(
    width: number,
    height: number,
    maxW: number,
    maxH: number,
): { width: number; height: number } {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { width: maxW, height: maxH };
    }
    const ar = width / height;
    if (ar >= 1) {
        return { width: maxW, height: Math.max(1, Math.round(maxW / ar)) };
    }
    return { width: Math.max(1, Math.round(maxH * ar)), height: maxH };
}
