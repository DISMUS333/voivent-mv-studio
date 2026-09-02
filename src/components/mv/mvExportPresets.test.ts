//==============================================================================
// mvExportPresets（エクスポート解像度プリセット・レターボックス計算）の単体テスト。
//==============================================================================
import { describe, it, expect } from 'vitest';
import {
    getBitratePresets,
    getResolutionPresets,
    DEFAULT_RESOLUTION_ID,
    aspectDiagramBox,
    aspectLabel,
    computeLetterboxFrame,
    gcd,
    resolveResolution,
} from './mvExportPresets';

describe('mvExportPresets / resolveResolution', () => {
    it('既知 ID をそのまま解決する', () => {
        expect(resolveResolution('youtube_fhd').width).toBe(1920);
        expect(resolveResolution('shorts_fhd').height).toBe(1920);
        expect(resolveResolution('square_hd').width).toBe(1080);
    });

    it('未知 ID・空・null は既定プリセットへフォールバック', () => {
        expect(resolveResolution('unknown_id').id).toBe(DEFAULT_RESOLUTION_ID);
        expect(resolveResolution('').id).toBe(DEFAULT_RESOLUTION_ID);
        expect(resolveResolution(null).id).toBe(DEFAULT_RESOLUTION_ID);
        expect(resolveResolution(undefined).id).toBe(DEFAULT_RESOLUTION_ID);
    });

    it('全プリセットが一意 ID と正の寸法を持つ', () => {
        const ids = getResolutionPresets().map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const p of getResolutionPresets()) {
            expect(p.width).toBeGreaterThan(0);
            expect(p.height).toBeGreaterThan(0);
            expect(Number.isFinite(p.width)).toBe(true);
            expect(Number.isFinite(p.height)).toBe(true);
        }
    });

    it('ビットレートプリセットは降順（高画質→軽量）で一意', () => {
        const bpsList = getBitratePresets().map((b) => b.bps);
        for (let i = 1; i < bpsList.length; i++) {
            expect(bpsList[i]).toBeLessThan(bpsList[i - 1]);
        }
        expect(new Set(bpsList).size).toBe(bpsList.length);
    });
});

describe('mvExportPresets / gcd & aspectLabel', () => {
    it('gcd の基本計算', () => {
        expect(gcd(1920, 1080)).toBe(120);
        expect(gcd(1080, 1920)).toBe(120);
        expect(gcd(1080, 1080)).toBe(1080);
        expect(gcd(7, 13)).toBe(1);
    });

    it('aspectLabel は整数比へ約分する', () => {
        expect(aspectLabel(1920, 1080)).toBe('16:9');
        expect(aspectLabel(1080, 1920)).toBe('9:16');
        expect(aspectLabel(1080, 1080)).toBe('1:1');
        expect(aspectLabel(1280, 720)).toBe('16:9');
        expect(aspectLabel(720, 1280)).toBe('9:16');
    });

    it('aspectLabel は不正値でプレースホルダを返す', () => {
        expect(aspectLabel(0, 100)).toBe('—');
        expect(aspectLabel(-100, 100)).toBe('—');
        expect(aspectLabel(Number.NaN, 100)).toBe('—');
    });
});

describe('mvExportPresets / computeLetterboxFrame', () => {
    it('16:9 コンテナに 16:9 ターゲット = 全画面フィット', () => {
        const f = computeLetterboxFrame(1600, 900, 1920, 1080);
        expect(f.width).toBe(1600);
        expect(f.height).toBe(900);
        expect(f.offsetX).toBe(0);
        expect(f.offsetY).toBe(0);
    });

    it('横長コンテナに縦型 9:16 ターゲット = 左右に黒帯', () => {
        const f = computeLetterboxFrame(1600, 900, 1080, 1920);
        // 高さ基準でフィット: 900 * (1080/1920) = 506.25 → 506
        expect(f.height).toBe(900);
        expect(f.width).toBe(506);
        expect(f.offsetY).toBe(0);
        expect(f.offsetX).toBe(Math.floor((1600 - 506) / 2));
    });

    it('正方形ターゲット = 左右に黒帯', () => {
        const f = computeLetterboxFrame(1600, 900, 1080, 1080);
        expect(f.height).toBe(900);
        expect(f.width).toBe(900);
        expect(f.offsetX).toBe(Math.floor((1600 - 900) / 2));
        expect(f.offsetY).toBe(0);
    });

    it('縦長コンテナに 16:9 ターゲット = 上下に黒帯', () => {
        const f = computeLetterboxFrame(600, 900, 1920, 1080);
        // 幅基準: 600 * (1080/1920) = 337.5 → 337
        expect(f.width).toBe(600);
        expect(f.height).toBe(337);
        expect(f.offsetX).toBe(0);
        expect(f.offsetY).toBe(Math.floor((900 - 337) / 2));
    });

    it('未計測コンテナでも 1x1 以上を返す（ゼロ除算・負値ガード）', () => {
        const f = computeLetterboxFrame(0, 0, 1920, 1080);
        expect(f.width).toBeGreaterThanOrEqual(1);
        expect(f.height).toBeGreaterThanOrEqual(1);
        const f2 = computeLetterboxFrame(-10, -10, 1920, 1080);
        expect(f2.width).toBeGreaterThanOrEqual(1);
    });

    it('不正ターゲットはコンテナ全体を返す', () => {
        const f = computeLetterboxFrame(800, 600, Number.NaN, 1080);
        expect(f.width).toBe(800);
        expect(f.height).toBe(600);
        expect(f.offsetX).toBe(0);
        expect(f.offsetY).toBe(0);
    });

    it('フレームは常にコンテナ内に収まる', () => {
        const cases: Array<[number, number, number, number]> = [
            [1600, 900, 1920, 1080],
            [1600, 900, 1080, 1920],
            [500, 700, 1080, 1080],
            [1280, 400, 720, 1280],
        ];
        for (const [cw, ch, tw, th] of cases) {
            const f = computeLetterboxFrame(cw, ch, tw, th);
            expect(f.width).toBeLessThanOrEqual(cw);
            expect(f.height).toBeLessThanOrEqual(ch);
            expect(f.offsetX).toBeGreaterThanOrEqual(0);
            expect(f.offsetY).toBeGreaterThanOrEqual(0);
            expect(f.offsetX + f.width).toBeLessThanOrEqual(cw);
            expect(f.offsetY + f.height).toBeLessThanOrEqual(ch);
        }
    });
});

describe('mvExportPresets / aspectDiagramBox', () => {
    it('横型は幅基準で収める', () => {
        const b = aspectDiagramBox(1920, 1080, 26, 26);
        expect(b.width).toBe(26);
        expect(b.height).toBe(Math.round(26 / (1920 / 1080)));
    });

    it('縦型は高さ基準で収める', () => {
        const b = aspectDiagramBox(1080, 1920, 26, 26);
        expect(b.height).toBe(26);
        expect(b.width).toBe(Math.round(26 * (1080 / 1920)));
    });

    it('正方形は max サイズそのまま', () => {
        expect(aspectDiagramBox(1080, 1080, 26, 26)).toEqual({ width: 26, height: 26 });
    });

    it('不正値は max サイズへフォールバック', () => {
        expect(aspectDiagramBox(0, 0, 26, 26)).toEqual({ width: 26, height: 26 });
    });
});
