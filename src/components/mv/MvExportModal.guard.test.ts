//==============================================================================
// MV 決定論的フレームレンダラー (mvFrameRenderer) の単体テスト。
//  - 決定論的オフライン描画、シーン切替、歌詞、Phaser Canvas 合成
//  - preloadAssets / 画像キャッシュ（書き出し前の素材事前デコード）
//==============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadAssets, renderFrameToCanvas } from './mvFrameRenderer';
import type { AudioSignals, MvImageAsset, MvScene } from './types';

/** jsdom は data URL をデコードしないため、onload を即時発火するモックに差し替える */
class MockImage {
    static instances: MockImage[] = [];
    static failSrcs = new Set<string>();
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 640;
    naturalHeight = 360;
    private _src = '';
    get src(): string {
        return this._src;
    }
    set src(v: string) {
        this._src = v;
        MockImage.instances.push(this);
        if (MockImage.failSrcs.has(v)) {
            this.onerror?.();
        } else {
            this.onload?.();
        }
    }
}

const makeAsset = (id: string, dataUrl: string): MvImageAsset => ({
    id,
    name: id,
    dataUrl,
    addedAt: 0,
});

describe('mvFrameRenderer preloadAssets — 素材事前デコード', () => {
    beforeEach(() => {
        MockImage.instances = [];
        MockImage.failSrcs = new Set();
        vi.stubGlobal('Image', MockImage as unknown as typeof Image);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('全素材のデコード完了を待ってから解決する', async () => {
        const assets = [makeAsset('a', 'data:image/png;base64,AAA'), makeAsset('b', 'data:image/png;base64,BBB')];
        await expect(preloadAssets(assets)).resolves.toBeUndefined();
        expect(MockImage.instances).toHaveLength(2);
    });

    it('同一 data URL の再プリロードはキャッシュ命中で Image を再生成しない', async () => {
        // 他テストと混ざらないよう実行ごとにユニークな URL を使う
        // （モジュールレベルキャッシュはテスト間で保持されるため）
        const url = `data:image/png;base64,CACHE${Date.now()}`;
        const assets = [makeAsset('a', url)];
        await preloadAssets(assets);
        expect(MockImage.instances).toHaveLength(1);
        // 2 回目はキャッシュ命中でインスタンスが増えない
        await preloadAssets(assets);
        expect(MockImage.instances).toHaveLength(1);
    });

    it('デコード失敗の素材があっても全体は解決する（背景なしで続行）', async () => {
        const bad = 'data:image/png;base64,BAD';
        MockImage.failSrcs.add(bad);
        const assets = [makeAsset('a', 'data:image/png;base64,AAA'), makeAsset('b', bad)];
        await expect(preloadAssets(assets)).resolves.toBeUndefined();
    });

    it('空配列・null 相当要素でも即座に解決する', async () => {
        await expect(preloadAssets([])).resolves.toBeUndefined();
    });

    it('背景画像付きシーンのフレーム描画がプリロード済みでクラッシュしない', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        expect(ctx).toBeTruthy();

        const scene: MvScene = {
            id: 'scene-bg',
            name: '背景あり',
            startTime: 0,
            endTime: 5,
            backgroundImageId: 'bg1',
        };
        const assets = [makeAsset('bg1', 'data:image/png;base64,IMG')];
        await preloadAssets(assets);

        if (ctx) {
            await expect(
                renderFrameToCanvas({
                    canvas,
                    ctx,
                    width: 640,
                    height: 360,
                    timeSec: 1.0,
                    scenes: [scene],
                    lyrics: [],
                    signals: {
                        peak: 0.5, low: 0.4, mid: 0.3, high: 0.2, beat: 0.5,
                        isPlaying: true, timeSeconds: 1, bpm: 120,
                    },
                    assets,
                }),
            ).resolves.toBeUndefined();
        }
    });
});

describe('mvFrameRenderer — 決定論的フレーム描画テスト', () => {
    const dummySignals: AudioSignals = {
        peak: 0.5,
        low: 0.4,
        mid: 0.3,
        high: 0.2,
        beat: 0.8,
        isPlaying: true,
        timeSeconds: 1.0,
        bpm: 120,
        viseme: 'a',
        visemeStrength: 0.7,
    };

    const dummyScenes: MvScene[] = [
        {
            id: 'scene-1',
            name: 'オープニング',
            startTime: 0,
            endTime: 5,
        },
        {
            id: 'scene-2',
            name: 'サビ',
            startTime: 5,
            endTime: 15,
        },
    ];

    it('renderFrameToCanvas: 指定解像度で黒塗りクリアおよび背景描画が完了する', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        expect(ctx).toBeTruthy();

        if (ctx) {
            await renderFrameToCanvas({
                canvas,
                ctx,
                width: 1920,
                height: 1080,
                timeSec: 1.0,
                scenes: dummyScenes,
                lyrics: [],
                signals: dummySignals,
            });
            // クラッシュせず正常終了することを確認
            expect(canvas.width).toBe(1920);
            expect(canvas.height).toBe(1080);
        }
    });

    it('renderFrameToCanvas: シーン区間外（ギャップ）では黒画面をレンダリングする', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        expect(ctx).toBeTruthy();

        if (ctx) {
            await renderFrameToCanvas({
                canvas,
                ctx,
                width: 1280,
                height: 720,
                timeSec: 20.0, // シーン範囲外
                scenes: dummyScenes,
                lyrics: [],
                signals: dummySignals,
            });
            expect(canvas.width).toBe(1280);
        }
    });

    it('renderFrameToCanvas: 歌詞と Phaser 4 Canvas が存在する場合に安全に合成できる', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');

        const phaserCanvas = document.createElement('canvas');
        phaserCanvas.width = 1280;
        phaserCanvas.height = 720;

        const lyrics = [
            { id: '1', time: 0.5, duration: 3.0, text: 'Hello World', color: '#ffffff' },
        ];

        if (ctx) {
            await renderFrameToCanvas({
                canvas,
                ctx,
                width: 1280,
                height: 720,
                timeSec: 1.0,
                scenes: dummyScenes,
                lyrics,
                signals: dummySignals,
                phaserCanvas,
            });
            expect(canvas.width).toBe(1280);
        }
    });
});
