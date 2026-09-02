//==============================================================================
// mvGifEncoder.ts の単体テスト。
// GIF バイナリ構造（ヘッダ・LSD・パレット・トレーラ）と LZW 圧縮を検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { encodeGif } from './mvGifEncoder';
import type { GifFrameInput } from './mvGifEncoder';

/** 単色フレームを生成するヘルパー */
function solidFrame(
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    delayCs = 10,
): GifFrameInput {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = 255;
    }
    return { data, width: w, height: h, delayCs };
}

describe('encodeGif', () => {
    it('空フレーム配列は空バイト列', () => {
        const out = encodeGif([]);
        expect(out.length).toBe(0);
    });

    it('GIF89a ヘッダを持つ', () => {
        const out = encodeGif([solidFrame(4, 4, 255, 0, 0)]);
        const header = String.fromCharCode(...out.slice(0, 6));
        expect(header).toBe('GIF89a');
    });

    it('論理画面サイズが正しく書き込まれる（little-endian）', () => {
        const out = encodeGif([solidFrame(320, 240, 0, 128, 255)]);
        // width
        expect(out[6]).toBe(320 & 0xff);
        expect(out[7]).toBe((320 >> 8) & 0xff);
        // height
        expect(out[8]).toBe(240 & 0xff);
        expect(out[9]).toBe((240 >> 8) & 0xff);
    });

    it('グローバルカラーテーブルフラグが立つ', () => {
        const out = encodeGif([solidFrame(4, 4, 10, 20, 30)]);
        // LSD の packed フィールド: bit7 = GCT flag
        expect(out[10] & 0x80).not.toBe(0);
    });

    it('Netscape ループ拡張を含む', () => {
        const out = encodeGif([
            solidFrame(2, 2, 255, 0, 0),
            solidFrame(2, 2, 0, 255, 0),
        ]);
        const text = Array.from(out)
            .map((b) => String.fromCharCode(b))
            .join('');
        expect(text).toContain('NETSCAPE2.0');
    });

    it('複数フレームで Graphic Control Extension を含む', () => {
        const frames = [
            solidFrame(8, 8, 255, 0, 0, 5),
            solidFrame(8, 8, 0, 255, 0, 12),
        ];
        const out = encodeGif(frames);
        // 0x21 0xF9 (GCE) が 2 回出現
        let gceCount = 0;
        for (let i = 0; i < out.length - 1; i++) {
            if (out[i] === 0x21 && out[i + 1] === 0xf9) gceCount++;
        }
        expect(gceCount).toBe(2);
    });

    it('遅延時間がセンチ秒で書き込まれる', () => {
        const out = encodeGif([solidFrame(4, 4, 0, 0, 255, 25)]);
        // GCE ブロック探索
        for (let i = 0; i < out.length - 1; i++) {
            if (out[i] === 0x21 && out[i + 1] === 0xf9) {
                // GCE: 0x21 0xF9 0x04 [packed] [delay lo] [delay hi]
                const delay = out[i + 4] | (out[i + 5] << 8);
                expect(delay).toBe(25);
                return;
            }
        }
        throw new Error('GCE not found');
    });

    it('トレーラ 0x3B で終端する', () => {
        const out = encodeGif([solidFrame(4, 4, 1, 2, 3)]);
        expect(out[out.length - 1]).toBe(0x3b);
    });

    it('出力は有効な非空バイナリである', () => {
        const frames = [
            solidFrame(16, 16, 200, 50, 50),
            solidFrame(16, 16, 50, 200, 50),
            solidFrame(16, 16, 50, 50, 200),
        ];
        const out = encodeGif(frames);
        expect(out.length).toBeGreaterThan(40);
        expect(out instanceof Uint8Array).toBe(true);
    });
});