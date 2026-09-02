//==============================================================================
// 依存ゼロの GIF エンコーダ（LZW 圧縮 + パレット量子化）。
// オフスクリーンキャンバスのフレーム列からアニメーション GIF を生成する。
//==============================================================================

/** GIF フレーム入力 */
export interface GifFrameInput {
    /** RGBA ピクセルデータ */
    data: Uint8ClampedArray;
    width: number;
    height: number;
    /** 表示持続時間（センチ秒、1/100秒単位） */
    delayCs: number;
}

/** グローバルパレット（最大256色）を構築するための色量子化 */
function buildPalette(
    frames: GifFrameInput[],
    maxColors = 128,
): { palette: Array<[number, number, number]>; indexMap: Uint8Array[] } {
    // 単純な均等 RGB 量子化（上位4bit/チャンネル → 頻度上位 maxColors 色）
    const counts = new Map<number, number>();
    for (const f of frames) {
        const px = f.data;
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 128) continue; // 半透明は背景色扱い
            const r = (px[i] >> 4) & 0xf;
            const g = (px[i + 1] >> 4) & 0xf;
            const b = (px[i + 2] >> 4) & 0xf;
            const key = (r << 8) | (g << 4) | b;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors - 1);

    // インデックス 0 は黒背景に予約
    const palette: Array<[number, number, number]> = [[0, 0, 0]];
    const keyToIdx = new Map<number, number>();
    for (const [key] of sorted) {
        keyToIdx.set(key, palette.length);
        palette.push([
            ((key >> 8) & 0xf) * 17,
            ((key >> 4) & 0xf) * 17,
            (key & 0xf) * 17,
        ]);
    }

    // 各フレームのピクセル→パレットインデックス
    const indexMaps = frames.map((f) => {
        const map = new Uint8Array(f.width * f.height);
        const px = f.data;
        for (let i = 0, p = 0; i < px.length; i += 4, p++) {
            if (px[i + 3] < 128) {
                map[p] = 0;
                continue;
            }
            const r = (px[i] >> 4) & 0xf;
            const g = (px[i + 1] >> 4) & 0xf;
            const b = (px[i + 2] >> 4) & 0xf;
            const key = (r << 8) | (g << 4) | b;
            map[p] = keyToIdx.get(key) ?? 0;
        }
        return map;
    });

    return { palette, indexMap: indexMaps };
}

/** LZW 圧縮（GIF 変種・可変コード長） */
class LzwCompressor {
    private out: number[] = [];
    private curByte = 0;
    private curBits = 0;

    constructor(private readonly minCodeSize: number) {}

    private get clearCode(): number {
        return 1 << this.minCodeSize;
    }
    private get endCode(): number {
        return this.clearCode + 1;
    }

    private nextCode = 0;
    private codeSize = 0;
    private dict = new Map<string, number>();

    private resetDict(): void {
        this.dict.clear();
        this.nextCode = this.endCode + 1;
        this.codeSize = this.minCodeSize + 1;
    }

    private emit(code: number): void {
        this.curByte |= code << this.curBits;
        this.curBits += this.codeSize;
        while (this.curBits >= 8) {
            this.out.push(this.curByte & 0xff);
            this.curByte >>= 8;
            this.curBits -= 8;
        }
    }

    /** 1フレーム分のインデックス列を圧縮する */
    compress(indices: Uint8Array): number[] {
        this.out = [];
        this.curByte = 0;
        this.curBits = 0;
        this.resetDict();
        this.emit(this.clearCode);

        let prefix = String.fromCharCode(indices[0]);
        for (let i = 1; i < indices.length; i++) {
            const c = String.fromCharCode(indices[i]);
            const combined = prefix + c;
            if (this.dict.has(combined)) {
                prefix = combined;
            } else {
                this.emit(this.dict.get(prefix) ?? prefix.charCodeAt(0));
                this.dict.set(combined, this.nextCode++);
                if (this.nextCode > (1 << this.codeSize) && this.codeSize < 12) {
                    this.codeSize++;
                }
                if (this.nextCode > 4095) {
                    this.emit(this.clearCode);
                    this.resetDict();
                }
                prefix = c;
            }
        }
        this.emit(this.dict.get(prefix) ?? prefix.charCodeAt(0));
        this.emit(this.endCode);

        if (this.curBits > 0) {
            this.out.push(this.curByte & 0xff);
        }
        return this.out;
    }
}

/** 数値を little-endian バイト列へ */
function u16le(v: number): number[] {
    return [v & 0xff, (v >> 8) & 0xff];
}

/**
 * フレーム列から GIF バイナリを生成する。
 * @returns GIF ファイル全体のバイト配列
 */
export function encodeGif(frames: GifFrameInput[]): Uint8Array {
    if (frames.length === 0) return new Uint8Array(0);
    const w = frames[0].width;
    const h = frames[0].height;

    const { palette, indexMap } = buildPalette(frames, 128);

    // パレットサイズは 2 の冪
    let palPow = 2;
    while (palPow < palette.length) palPow <<= 1;
    const palBits = Math.max(1, Math.round(Math.log2(palPow)));
    const palSizeField = palBits - 1;

    const bytes: number[] = [];

    // ---- Header / Logical Screen Descriptor ----
    bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
    bytes.push(...u16le(w), ...u16le(h));
    bytes.push(0x80 | ((palSizeField & 7) << 4) | (palSizeField & 7));
    bytes.push(0x00); // background color index
    bytes.push(0x00); // aspect

    // Global Color Table
    const gctEntries = 1 << palBits;
    for (let i = 0; i < gctEntries; i++) {
        const c = palette[i] ?? [0, 0, 0];
        bytes.push(c[0], c[1], c[2]);
    }

    // ---- Netscape Loop Extension（無限ループ）----
    bytes.push(0x21, 0xff, 0x0b);
    for (const ch of 'NETSCAPE2.0') bytes.push(ch.charCodeAt(0));
    bytes.push(0x03, 0x01, ...u16le(0), 0x00);

    // ---- Frames ----
    const minCodeSize = Math.max(2, palBits);
    for (let fi = 0; fi < frames.length; fi++) {
        const frame = frames[fi];
        const indices = indexMap[fi];

        // Graphic Control Extension
        bytes.push(0x21, 0xf9, 0x04);
        bytes.push(0x04); // disposal=1
        bytes.push(...u16le(frame.delayCs));
        bytes.push(0x00, 0x00);

        // Image Descriptor
        bytes.push(0x2c);
        bytes.push(...u16le(0), ...u16le(0), ...u16le(w), ...u16le(h));
        bytes.push(0x00); // no local color table

        // LZW データ（255バイトごとのサブブロック）
        bytes.push(minCodeSize);
        const lzw = new LzwCompressor(minCodeSize).compress(indices);
        for (let i = 0; i < lzw.length; i += 255) {
            const chunkLen = Math.min(255, lzw.length - i);
            bytes.push(chunkLen);
            for (let j = i; j < i + chunkLen; j++) bytes.push(lzw[j]);
        }
        bytes.push(0x00); // block terminator
    }

    bytes.push(0x3b); // trailer
    return new Uint8Array(bytes);
}
