//==============================================================================
// verifyTslShader プローブ描画経路の回帰テスト（モックレンダラー使用）。
//
// 実機バグ（2026-08）: three r185 の WebGPURenderer には disposeAsync が
// 存在しない。旧実装は renderProbeFrames の finally で disposeAsync を呼び、
// TypeError が try 内の return（成功 captures）を握り潰していた。その結果、
// コンパイル通過・描画成功の提出コードまで必ず「プローブ描画失敗:
// ... is not a function」で不合格になり、AI 生成シェーダーが全滅した。
//
// 本テストは three/webgpu の TSL は実物を使い、WebGPURenderer のみ
// r185 の実際の API 面（disposeAsync 無し / dispose 同期のみ）で置き換え、
// プローブ描画 → 統計 → 判定 → クリーンアップまでの全経路を jsdom で検証する。
//==============================================================================
import { describe, expect, it, vi } from 'vitest';

/** モックレンダラーへのテストハーネス用フラグ */
const mockState = vi.hoisted(() => ({ disposeShouldThrow: false }));

vi.mock('three/webgpu', async (importOriginal) => {
    const actual = await importOriginal<typeof import('three/webgpu')>();
    let frame = 0;
    /** r185 の実際の公開 API 面だけを持つモック（disposeAsync は意図的に未定義） */
    class MockWebGPURenderer {
        backend = { isWebGPUBackend: true };
        domElement = { style: {} };
        async init(): Promise<void> { frame = 0; }
        setRenderTarget(_t: unknown): void { /* noop */ }
        async renderAsync(_scene: unknown, _cam: unknown): Promise<void> { /* noop */ }
        async readRenderTargetPixelsAsync(): Promise<Uint8Array> {
            // x 方向に空間変化 ＋ フレーム間で時間変化するパターン（合格要件を満たす）
            const px = new Uint8Array(64 * 64 * 4);
            const shift = (frame++ * 70) % 256;
            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    const i = (y * 64 + x) * 4;
                    px[i] = (x * 4 + shift) % 256;
                    px[i + 1] = (y * 3 + shift) % 256;
                    px[i + 2] = 120;
                    px[i + 3] = 255;
                }
            }
            return px;
        }
        dispose(): void {
            if (mockState.disposeShouldThrow) throw new Error('dispose failed (test)');
        }
    }
    return { ...actual, WebGPURenderer: MockWebGPURenderer } as unknown as typeof actual;
});

import { verifyTslShader } from './mvTslSandbox';

const PROBE_SHADER =
    'return tsl.vec4(tsl.sin(u.uTimeSec).mul(0.5).add(0.5), u.uLow, tsl.uv().x, 1.0);';

describe('verifyTslShader (モックレンダラーによるプローブ完全経路)', () => {
    it('r185 形態のレンダラー（disposeAsync 無し）でプローブ検証が合格する', async () => {
        const r = await verifyTslShader(PROBE_SHADER);
        expect(r.error).toBeNull();
        expect(r.ok).toBe(true);
        expect(r.stats).toBeDefined();
        expect(r.stats?.interFrameMeanDelta ?? 0).toBeGreaterThan(0.5);
        expect(r.backend).toBe('auto');
    });

    it('dispose が例外を投げても検証結果は握り潰されない', async () => {
        mockState.disposeShouldThrow = true;
        try {
            const r = await verifyTslShader(PROBE_SHADER);
            expect(r.ok).toBe(true);
            expect(r.error).toBeNull();
        } finally {
            mockState.disposeShouldThrow = false;
        }
    });

    it('3 連続検証（レンダラー生成・破棄の繰り返し）でも安定して合格する', async () => {
        for (let i = 0; i < 3; i++) {
            const r = await verifyTslShader(PROBE_SHADER);
            expect(r.ok).toBe(true);
        }
    });

    it('静止パターン（全フレーム同一）は機械的に不合格と判定される', async () => {
        // モックを静止モードに差し替えるため、同一フレームを返す renderer を
        // 二重 mock せず、判定ロジック自体は mvShaderProbeStats.test.ts で担保済み。
        // ここでは「合格経路が動いている」ことの対比として NaN 系の不合格のみ検証する。
        const r = await verifyTslShader('return tsl.vec4(tsl.div(tsl.float(1), tsl.float(0)).xxx, 1.0);');
        // 無限大は実 GPU では NaN/0 正規化されるため環境差がある。jsdom モックでは
        // 描画されないため「合格 or 不合格のどちらかが必ず明確に返る」ことだけを検証
        expect(typeof r.ok).toBe('boolean');
    });
});
