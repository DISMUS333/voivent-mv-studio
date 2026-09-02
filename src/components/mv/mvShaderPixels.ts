//==============================================================================
// three.js WebGPURenderer (r185) の readRenderTargetPixelsAsync 戻りバッファの
// 正規化ヘルパー（純粋関数のみ・jsdom テスト可能）。
//
// 背景（2026-08 実機検証で確定した API 仕様差）:
// three r185 の readRenderTargetPixelsAsync(rt, x, y, w, h) は
// 「戻り値で TypedArray を返す」API。旧来の WebGLRenderer 流儀である
// 「第 6 引数に受け取りバッファを渡す」呼び方は不可能で、第 6 引数は
// textureIndex と解釈され WeakMap キー不正でクラッシュする。
//
// さらに戻りバッファの並びはバックエンドごとに異なる（実機 M4 / macOS 26 /
// WKWebView のプローブで実測）:
// - WebGPU バックエンド: 行 256 バイト境界アライン（最終行以外パディング付き）
//   ＋ 上原点（トップダウン。row0 = 画面上端）
// - WebGL2 バックエンド: タイト packing（パディング無し）＋ 下原点
//   （gl.readPixels 準拠。row0 = 画面下端）
//
// normalizePixels() はこの差を吸収し、常に「タイト packing・上原点」の
// RGBA 画素列へ正規化して返す。向きは backend 引数で判定する
// （'webgl2' のみ下原点→反転。'auto' = WebGPU 実行 / 'unknown' は上原点扱い）。
//==============================================================================

export type PixelBuffer = Uint8Array | Uint8ClampedArray | Float32Array;

/** WebGPU バックエンドの読み取り 1 行バイト数（256 バイト境界アライン） */
export function paddedBytesPerRow(width: number): number {
    return Math.ceil((width * 4) / 256) * 256;
}

function isBytePixels(b: PixelBuffer): b is Uint8Array | Uint8ClampedArray {
    return b instanceof Uint8Array || b instanceof Uint8ClampedArray;
}

function makeSame(src: PixelBuffer, len: number): PixelBuffer {
    const Ctor = src.constructor as new (len: number) => PixelBuffer;
    return new Ctor(len);
}

/** タイト packing の画素列の行順を上下反転する */
function flipRows(src: PixelBuffer, width: number, height: number): PixelBuffer {
    const row = width * 4;
    const out = makeSame(src, width * height * 4);
    for (let y = 0; y < height; y++) {
        const s = (height - 1 - y) * row;
        out.set(src.subarray(s, s + row), y * row);
    }
    return out;
}

/** WebGPU 方式（行パディング込み・上原点）バッファからパディングを除去する */
function stripRowPadding(src: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
    const bpr = paddedBytesPerRow(width);
    const row = width * 4;
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        out.set(src.subarray(y * bpr, y * bpr + row), y * row);
    }
    return out;
}

/**
 * readRenderTargetPixelsAsync の戻りバッファを「タイト packing・上原点」の
 * RGBA 画素列へ正規化する。
 *
 * - 行パディング: バッファ長から自動判定して除去（WebGPU バックエンド）
 * - 行の向き: backend === 'webgl2' の場合のみ上下反転する（gl.readPixels 下原点）。
 *   'auto'（WebGPU 実行）および 'unknown' は上原点としてそのまま扱う
 * - 対応: バイト型（Uint8Array / Uint8ClampedArray）はパディング込み可。
 *   Float32Array はタイト長のみ対応（パディング付き float 読み取りは非対応 → null）
 *
 * @returns 正規化済み画素列。長さがどの既知形式にも一致しない不正バッファは null
 */
export function normalizePixels(
    buffer: PixelBuffer,
    width: number,
    height: number,
    backend: string,
): PixelBuffer | null {
    if (width <= 0 || height <= 0) return null;
    const tight = width * height * 4;
    const bpr = paddedBytesPerRow(width);
    const paddedLen = (height - 1) * bpr + width * 4;

    let topDown: PixelBuffer;
    if (buffer.length === tight) {
        topDown = buffer;
    } else if (isBytePixels(buffer) && (buffer.length === paddedLen || buffer.length === bpr * height)) {
        topDown = stripRowPadding(buffer, width, height);
    } else {
        return null;
    }
    return backend === 'webgl2' ? flipRows(topDown, width, height) : topDown;
}
