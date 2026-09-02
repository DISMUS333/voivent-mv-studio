//==============================================================================
// lib/music.ts の単体テスト（純粋関数のみ・依存ゼロ）
//==============================================================================
import { describe, it, expect } from 'vitest';
import {
    MIN_HZ,
    MAX_HZ,
    KEY_W,
    NOTE_NAMES,
    noteName,
    isBlack,
    hzToY,
    formatTime,
    buildKeys,
} from './music';

describe('noteName', () => {
    it('MIDI ノート番号を音名表記へ変換する', () => {
        expect(noteName(48)).toBe('C3');
        expect(noteName(60)).toBe('C4');
        expect(noteName(61)).toBe('C#4');
        expect(noteName(69)).toBe('A4'); // コンサートピッチ
        expect(noteName(21)).toBe('A0');
        expect(noteName(127)).toBe('G9');
    });

    it('負値の MIDI 番号でもクラッシュしない（現在仕様の固定化）', () => {
        // ((midi % 12) + 12) % 12 の位取りにより負値も音名へ写像される
        const name = noteName(-4);
        expect(typeof name).toBe('string');
        expect(NOTE_NAMES.some((n) => name.startsWith(n))).toBe(true);
    });
});

describe('isBlack', () => {
    it('黒鍵セット {1,3,6,8,10} を正しく判定する', () => {
        for (const pitchClass of [1, 3, 6, 8, 10]) {
            expect(isBlack(pitchClass)).toBe(true);
        }
        for (const pitchClass of [0, 2, 4, 5, 7, 9, 11]) {
            expect(isBlack(pitchClass)).toBe(false);
        }
    });

    it('オクターブをまたいでも位取りで判定される', () => {
        expect(isBlack(49)).toBe(true); // C#4
        expect(isBlack(48)).toBe(false); // C4
        expect(isBlack(127)).toBe(false); // G9
    });

    it('負値でもクラッシュせず判定できる', () => {
        expect(() => isBlack(-3)).not.toThrow();
        expect(isBlack(-3)).toBe(false); // 位取り 9 は A (ラ) → 白鍵
        expect(isBlack(-2)).toBe(true);  // 位取り 10 は A# (ラ#) → 黒鍵
    });
});

describe('hzToY', () => {
    it('境界値: hz <= 0 は最下端 (height) を返す', () => {
        expect(hzToY(0, 100)).toBe(100);
        expect(hzToY(-10, 100)).toBe(100);
    });

    it('境界値: MIN_HZ は最下端、MAX_HZ は最上端 (0)', () => {
        expect(hzToY(MIN_HZ, 100)).toBe(100);
        expect(hzToY(MAX_HZ, 100)).toBe(0);
    });

    it('範囲外の周波数はクランプされる', () => {
        expect(hzToY(MAX_HZ * 10, 100)).toBe(0);
        expect(hzToY(MIN_HZ / 10, 100)).toBe(100);
    });

    it('対数スケールの中間値を返す', () => {
        const y = hzToY(400, 100);
        // log(400/40) / log(2000/40) の位置
        const expected = 100 - (Math.log(400 / 40) / Math.log(2000 / 40)) * 100;
        expect(y).toBeCloseTo(expected, 6);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(100);
    });
});

describe('formatTime', () => {
    it('0 秒を "0:00.0" と表示する', () => {
        expect(formatTime(0)).toBe('0:00.0');
    });

    it('負値は 0 にクランプされる', () => {
        expect(formatTime(-5)).toBe('0:00.0');
    });

    it('分・秒・十分の一秒を整形する', () => {
        expect(formatTime(61.25)).toBe('1:01.2');
        expect(formatTime(9.96)).toBe('0:09.9'); // 小数切捨て
        expect(formatTime(600)).toBe('10:00.0');
    });

    it('1 桁秒はゼロ埋めされる', () => {
        expect(formatTime(5.5)).toBe('0:05.5');
    });
});

describe('buildKeys', () => {
    it('デフォルト（C3・3 オクターブ）のキー配列を生成する', () => {
        const { keys, width } = buildKeys();
        // 両端を含む 37 鍵 (C3..C6)
        expect(keys).toHaveLength(37);
        expect(keys[0].note).toBe(48);
        expect(keys[0].black).toBe(false);
        expect(keys[keys.length - 1].note).toBe(84);
    });

    it('白鍵は左から順に KEY_W 刻みで並ぶ', () => {
        const { keys } = buildKeys(3, 1); // C3..C4
        const whites = keys.filter((k) => !k.black);
        expect(whites).toHaveLength(8); // 7 + 端の C
        whites.forEach((k, i) => {
            expect(k.left).toBe(i * KEY_W);
        });
    });

    it('黒鍵は直前の白鍵との間に配置される', () => {
        const { keys } = buildKeys(3, 1);
        const cSharp = keys.find((k) => k.note === 49)!;
        expect(cSharp.black).toBe(true);
        expect(cSharp.left).toBe((1 - 0.5) * KEY_W); // 白鍵 1 個分の半分
    });

    it('総幅は白鍵数 × KEY_W と一致する', () => {
        const { keys, width } = buildKeys(2, 2);
        const whiteCount = keys.filter((k) => !k.black).length;
        expect(width).toBe(whiteCount * KEY_W);
    });
});