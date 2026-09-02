//==============================================================================
// webMcpBootTools.ts の単体テスト。
// ウェルカム画面 (楽曲ロード前) に先行登録されるブートツールの
// ロード委譲・状態報告・エラーハンドリングを検証する。
//==============================================================================
import { describe, it, expect, vi } from 'vitest';
import { createBootToolDefinitions, type WebMcpBootContext } from './webMcpBootTools';

function createBootContext(overrides: Partial<WebMcpBootContext> = {}): WebMcpBootContext & {
    loadMock: ReturnType<typeof vi.fn>;
} {
    const loadMock = vi.fn(async () => true);
    const ctx: WebMcpBootContext = {
        isAudioLoaded: () => false,
        onLoadFile: loadMock,
        ...overrides,
    };
    return { ...ctx, loadMock } as never;
}

describe('webMcpBootTools', () => {
    it('ブートツールは load_demo_track と get_studio_status の 2 本', () => {
        const tools = createBootToolDefinitions(createBootContext());
        expect(tools.map((t) => t.name)).toEqual(['load_demo_track', 'get_studio_status']);
    });

    describe('load_demo_track', () => {
        it('デモ曲を取得してホストのロード処理へ委譲する', async () => {
            // global fetch をスタブ
            const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response));
            vi.stubGlobal('fetch', fetchMock);
            const ctx = createBootContext();
            const tool = createBootToolDefinitions(ctx).find((t) => t.name === 'load_demo_track')!;

            const res = await tool.execute({}, ctx as never);

            expect(fetchMock).toHaveBeenCalled();
            expect(ctx.loadMock).toHaveBeenCalledWith(expect.any(File));
            expect(res.success).toBe(true);
            expect(res.message).toContain('デモ曲');
            vi.unstubAllGlobals();
        });

        it('楽曲ロード済みの場合は案内のみで再ロードしない', async () => {
            const ctx = createBootContext({ isAudioLoaded: () => true });
            const tool = createBootToolDefinitions(ctx).find((t) => t.name === 'load_demo_track')!;

            const res = await tool.execute({}, ctx as never);

            expect(res.success).toBe(true);
            expect(ctx.loadMock).not.toHaveBeenCalled();
        });

        it('ホスト側ロード失敗時は success=false を返す', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response)));
            const ctx = createBootContext({ onLoadFile: async () => false });
            const tool = createBootToolDefinitions(ctx).find((t) => t.name === 'load_demo_track')!;

            const res = await tool.execute({}, ctx as never);

            expect(res.success).toBe(false);
            vi.unstubAllGlobals();
        });

        it('fetch 失敗時は success=false を返す', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 } as Response)));
            const ctx = createBootContext();
            const tool = createBootToolDefinitions(ctx).find((t) => t.name === 'load_demo_track')!;

            const res = await tool.execute({}, ctx as never);

            expect(res.success).toBe(false);
            expect(res.message).toContain('404');
            vi.unstubAllGlobals();
        });
    });

    describe('get_studio_status', () => {
        it('未ロード時は load_demo_track を推奨フローの先頭に示す', async () => {
            const ctx = createBootContext();
            const tool = createBootToolDefinitions(ctx).find((t) => t.name === 'get_studio_status')!;

            const res = await tool.execute({}, ctx as never);
            const data = res.data as { audioLoaded: boolean; recommendedFlow: string[] };

            expect(res.success).toBe(true);
            expect(data.audioLoaded).toBe(false);
            expect(data.recommendedFlow[0]).toBe('load_demo_track');
            expect(res.message).toContain('load_demo_track');
        });

        it('ロード済み時は編集ツール群を案内する', async () => {
            const ctx = createBootContext({ isAudioLoaded: () => true });
            const tool = createBootToolDefinitions(ctx).find((t) => t.name === 'get_studio_status')!;

            const res = await tool.execute({}, ctx as never);
            const data = res.data as { audioLoaded: boolean; recommendedFlow: string[] };

            expect(data.audioLoaded).toBe(true);
            expect(data.recommendedFlow).toContain('create_full_mv_scenes');
            expect(data.recommendedFlow).not.toContain('load_demo_track');
        });
    });
});