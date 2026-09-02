//==============================================================================
// MV オーディオシグナルフックの純粋ロジック検証。
// - resolveMvTimelineSec: 停止中の位置ホールド仕様（0 秒へ飛んで歌詞が消える回帰防止）
// - mvFxTime: 装飾時計の前進量・カメラズームクランプの安全ポリシー
//==============================================================================
import { describe, it, expect } from 'vitest';
import { resolveMvTimelineSec } from './useMvAudioSignals';
import { fxAdvanceSeconds, clampCameraZoom, FX_DELTA_MAX_MS, ZOOM_MIN, ZOOM_MAX } from './mvFxTime';

describe('resolveMvTimelineSec', () => {
    it('再生中はエンジン報告位置に常に追従する（0 を含む）', () => {
        expect(resolveMvTimelineSec(true, 12.5, 99)).toBe(12.5);
        // 巻き戻し直後でも 0 に追従し、古いホールド値を使わない
        expect(resolveMvTimelineSec(true, 0, 99)).toBe(0);
    });

    it('停止中はエンジンの有効な報告位置を採用する（スクラブ反映）', () => {
        expect(resolveMvTimelineSec(false, 42, 10)).toBe(42);
        expect(resolveMvTimelineSec(false, 3.2, 8)).toBe(3.2);
    });

    it('停止中かつ報告が無効（NaN/負/無限大相当）なら最終再生位置をホールドする', () => {
        expect(resolveMvTimelineSec(false, NaN, 57.5)).toBe(57.5);
        expect(resolveMvTimelineSec(false, -1, 57.5)).toBe(57.5);
        expect(resolveMvTimelineSec(false, Number.POSITIVE_INFINITY, 9)).toBe(9);
    });

    it('停止中・報告 0・ホールドも 0 の場合は 0 を返す（起動直後の正常系）', () => {
        expect(resolveMvTimelineSec(false, 0, 0)).toBe(0);
    });

    it('非数や異常なホールド値が混入してもクラッシュしない', () => {
        expect(resolveMvTimelineSec(false, 5, NaN)).toBe(5);
        expect(resolveMvTimelineSec(false, NaN, NaN)).toBe(0);
        expect(Number.isFinite(resolveMvTimelineSec(false, NaN, Infinity))).toBe(true);
    });
});

describe('fxAdvanceSeconds（装飾時計の前進量ポリシー）', () => {
    it('通常フレームはミリ秒を秒へ換算した値を返す', () => {
        expect(fxAdvanceSeconds(16.666)).toBeCloseTo(0.016666, 6);
        expect(fxAdvanceSeconds(1000 / 30)).toBeCloseTo(1 / 30, 6);
    });

    it('巨大デルタは上限でクリップされる（タブ復帰時の演出ジャンプ防止）', () => {
        expect(fxAdvanceSeconds(5000)).toBe(FX_DELTA_MAX_MS / 1000);
        // 非有限なデルタは異常系として完全無視する（時計を進めない）
        expect(fxAdvanceSeconds(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('非数・ゼロ・負値は 0 を返し、時計を破壊しない', () => {
        expect(fxAdvanceSeconds(NaN)).toBe(0);
        expect(fxAdvanceSeconds(0)).toBe(0);
        expect(fxAdvanceSeconds(-16.6)).toBe(0);
    });
});

describe('clampCameraZoom（カメラズーム安全範囲）', () => {
    it('正常値はそのまま通す', () => {
        expect(clampCameraZoom(1.0)).toBe(1.0);
        expect(clampCameraZoom(0.8)).toBe(0.8);
        expect(clampCameraZoom(2.3)).toBe(2.3);
    });

    it('Phaser が不正値とみなす境界（0 / 負値）をクランプする', () => {
        const clamped = clampCameraZoom(0);
        expect(clamped).toBeGreaterThan(0);
        expect(clamped).toBe(ZOOM_MIN);
        expect(clampCameraZoom(-1.5)).toBe(ZOOM_MIN);
    });

    it('過大値は上限へクランプする', () => {
        expect(clampCameraZoom(100)).toBeLessThanOrEqual(4);
        expect(clampCameraZoom(100)).toBe(ZOOM_MAX);
    });

    it('非数・非有限値は等倍 (1.0) へフォールバックする', () => {
        expect(clampCameraZoom(NaN)).toBe(1.0);
        expect(clampCameraZoom(Infinity)).toBe(1.0);
        expect(clampCameraZoom(-Infinity)).toBe(1.0);
    });
});

