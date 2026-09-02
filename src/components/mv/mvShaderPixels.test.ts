//==============================================================================
// mvShaderPixels の単体テスト（純粋関数・jsdom 不要）
//
// 期待値は 2026-08 の実機プローブ（Apple M4 / macOS 26 / WKWebView / three r185）
// で実測したバックエンド差に基づく:
// - WebGPU バックエンド: 行 256 バイトアライン＋上原点
// - WebGL2 バックエンド: タイト packing＋下原点（gl.readPixels 準拠）
//==============================================================================
import { describe, it, expect } from 'vitest';
import { normalizePixels, paddedBytesPerRow } from './mvShaderPixels';

/** テスト用: 指定行が指定色の画像バッファを作る（タイト packing） */
function makeTight(width: number, height: number, rowColor: (y: number) => [number, number, number, number]): Uint8Array {
    const px = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const [r, g, b, a] = rowColor(y);
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
        }
    }
    return px;
}

describe('paddedBytesPerRow', () => {
    it('256 バイト境界へ切り上げアラインされる', () => {
        expect(paddedBytesPerRow(64)).toBe(256); // 64*4=256 → ちょうど
        expect(paddedBytesPerRow(65)).toBe(512); // 65*4=260 → 512
        expect(paddedBytesPerRow(100)).toBe(512); // 100*4=400 → 512
        expect(paddedBytesPerRow(1)).toBe(256);
    });
});

describe('normalizePixels', () => {
    const W = 100;
    const H = 50;
    const BPR = paddedBytesPerRow(W); // 512

    it('WebGPU 方式（パディング込み・上原点）からパディングを除去し向きを維持する', () => {
        // 実測: raw 長 = (H-1)*BPR + W*4 = 25488
        const raw = new Uint8Array((H - 1) * BPR + W * 4);
        raw[0] = 200; // row0 先頭画素
        const out = normalizePixels(raw, W, H, 'auto');
        expect(out).not.toBeNull();
        expect(out!.length).toBe(W * H * 4);
        expect(out![0]).toBe(200); // row0 は上原点のまま維持
    });

    it('WebGPU 方式の「全行 BPR」長のバッファも受け付ける', () => {
        const raw = new Uint8Array(BPR * H);
        raw[0] = 111;
        const out = normalizePixels(raw, W, H, 'auto');
        expect(out).not.toBeNull();
        expect(out!.length).toBe(W * H * 4);
        expect(out![0]).toBe(111);
    });

    it('タイト長バッファ（WebGL2 長）は auto ではそのまま返す', () => {
        const raw = makeTight(W, H, (y) => [y, 0, 0, 255]);
        const out = normalizePixels(raw, W, H, 'auto');
        expect(out).toBe(raw);
    });

    it('webgl2 は下原点のため上下反転する', () => {
        const raw = makeTight(W, H, (y) => [y + 1, 0, 0, 255]); // row0=赤1, rowLast=赤50
        const out = normalizePixels(raw, W, H, 'webgl2') as Uint8Array;
        expect(out).not.toBeNull();
        expect(out[0]).toBe(50); // 元の最終行が先頭へ
        const lastRowStart = (H - 1) * W * 4;
        expect(out[lastRowStart]).toBe(1); // 元の row0 が最終行へ
    });

    it('unknown バックエンドは上原点扱い（反転しない）', () => {
        const raw = makeTight(2, 2, (y) => [y + 1, 0, 0, 255]);
        const out = normalizePixels(raw, 2, 2, 'unknown') as Uint8Array;
        expect(out[0]).toBe(1);
        expect(out[(2 - 1) * 2 * 4]).toBe(2);
    });

    it('Uint8ClampedArray は Uint8Array へ正規化される', () => {
        const raw = new Uint8ClampedArray(BPR * 2);
        raw[0] = 90;
        const out = normalizePixels(raw, W, 2, 'auto');
        expect(out).not.toBeNull();
        expect(out).toBeInstanceOf(Uint8Array);
        expect(out![0]).toBe(90);
    });

    it('Float32Array（タイト長）は型を保ったまま通す', () => {
        const raw = new Float32Array(W * H * 4);
        raw[0] = 0.5;
        const out = normalizePixels(raw, W, H, 'auto');
        expect(out).toBeInstanceOf(Float32Array);
        expect((out as Float32Array)[0]).toBeCloseTo(0.5);
    });

    it('Float32Array のパディング長は非対応で null', () => {
        const raw = new Float32Array(BPR * H);
        expect(normalizePixels(raw, W, H, 'auto')).toBeNull();
    });

    it('既知形式に一致しない長さは null', () => {
        expect(normalizePixels(new Uint8Array(123), W, H, 'auto')).toBeNull();
    });

    it('幅 0 や高さ 0 は null', () => {
        expect(normalizePixels(new Uint8Array(0), 0, 10, 'auto')).toBeNull();
        expect(normalizePixels(new Uint8Array(0), 10, 0, 'auto')).toBeNull();
    });

    it('パディング除去で行ズレが起きない（行内容を検証）', () => {
        // 各行に y を埋め込んだ WebGPU 方式バッファ
        const raw = new Uint8Array(BPR * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                raw[y * BPR + x * 4] = y;
            }
        }
        const out = normalizePixels(raw, W, H, 'auto') as Uint8Array;
        for (let y = 0; y < H; y++) {
            // 各行の先頭・末尾画素が正しく y を保持する（パディング混入がない）
            expect(out[y * W * 4]).toBe(y);
            expect(out[y * W * 4 + (W - 1) * 4]).toBe(y);
        }
    });
});
