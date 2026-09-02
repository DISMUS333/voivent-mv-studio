//==============================================================================
// MV Phaser エフェクト用 時間・カメラ制御の純粋ユーティリティ。
// Phaser クラス内部から切り出すことで、単体テスト可能にし、
// デルタ上限・ズーム範囲などの安全ポリシーを一元管理する。
// ※ DOM / Phaser への依存を持たない（テスト環境で直接実行可能）
//==============================================================================

/** 内部時計 (fxClock) の 1 フレーム最大前進ミリ秒。非アクティブ復帰時の瞬間ジャンプ防止 */
export const FX_DELTA_MAX_MS = 50;

/**
 * 1 フレーム分の装飾時計前進量（秒）を算出する。
 * - 非数・負値は 0（時計を逆行・破壊させない）
 * - 上限クリップでタブ復帰時の巨大デルタによる演出ジャンプを防ぐ
 */
export function fxAdvanceSeconds(deltaMs: number): number {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
    return Math.min(deltaMs, FX_DELTA_MAX_MS) / 1000;
}

/** カメラズームの許容範囲（Phaser は zoom<=0 を不正値として無視 / 負値は例外のため防御） */
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 4.0;

/** カメラズームを安全範囲へクランプする（非数時は 1.0 = 等倍） */
export function clampCameraZoom(zoom: number): number {
    if (!Number.isFinite(zoom)) return 1.0;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
}
