//==============================================================================
// webMcpTools.ts の単体テスト。
// WebMCP ツール群（プロジェクト情報取得、シーン追加・更新・削除、歌詞設定、解像度切替、トランスポート操作）
// のバリデーションと実行ロジックを検証する。
//==============================================================================
import { describe, it, expect, vi } from 'vitest';
import { WEB_MCP_TOOLS, type WebMcpContext } from './webMcpTools';
import { normalizeMv3DScene } from './mv3dScene';
import type { MvProjectConfig } from './types';

function createMockContext(initialConfig?: Partial<MvProjectConfig>): {
    context: WebMcpContext;
    configRef: { current: MvProjectConfig };
    onSeekMock: ReturnType<typeof vi.fn>;
    onTogglePlayMock: ReturnType<typeof vi.fn>;
    onStopMock: ReturnType<typeof vi.fn>;
} {
    const configRef = {
        current: {
            title: 'Test Project',
            scenes: [
                {
                    id: 'scene_1',
                    name: 'Intro Scene',
                    startTime: 0,
                    endTime: 5.0,
                    phaserTheme: 'oscilloscope',
                    lyricEffect: 'particle_disintegrate',
                },
            ],
            lyrics: [
                { id: 'lyric_1', time: 1.0, text: 'Hello World', duration: 3.0 },
            ],
            globalCss: '',
            assets: [],
            previewResolutionId: 'youtube_fhd',
            ...initialConfig,
        } as MvProjectConfig,
    };

    const onSeekMock = vi.fn();
    const onTogglePlayMock = vi.fn();
    const onStopMock = vi.fn();

    const context: WebMcpContext = {
        getConfig: () => configRef.current,
        setConfig: (updater) => {
            configRef.current = updater(configRef.current);
        },
        getTransport: () => ({
            isPlaying: false,
            playheadSec: 2.5,
            bpm: 128,
            duration: 60,
        }),
        getAnalysis: () => null,
        onSeek: onSeekMock,
        onTogglePlay: onTogglePlayMock,
        onStop: onStopMock,
    };

    return { context, configRef, onSeekMock, onTogglePlayMock, onStopMock };
}

describe('WebMCP Tools', () => {
    it('全38個のツールが定義されている', () => {
        expect(WEB_MCP_TOOLS.length).toBe(38);
        const names = WEB_MCP_TOOLS.map((t) => t.name);
        expect(names).toContain('get_mv_project');
        expect(names).toContain('add_mv_scene');
        expect(names).toContain('create_full_mv_scenes');
        expect(names).toContain('update_mv_scene');
        expect(names).toContain('select_mv_scene');
        expect(names).toContain('export_mv_project');
        expect(names).toContain('validate_mv_shader');
        expect(names).toContain('validate_mv_shader_variants');
        expect(names).toContain('delete_mv_scene');
        expect(names).toContain('set_mv_lyrics');
        expect(names).toContain('set_mv_lyric_style');
        expect(names).toContain('add_mv_effect');
        expect(names).toContain('delete_mv_effect');
        expect(names).toContain('save_mv_effect_asset');
        expect(names).toContain('set_preview_resolution');
        expect(names).toContain('control_mv_transport');
        expect(names).toContain('set_mv_master_gain');
        expect(names).toContain('get_energy_map');
        expect(names).toContain('get_mv_preview');
        expect(names).toContain('render_mv_video');
        expect(names).toContain('analyze_mv_stems');
        expect(names).toContain('get_mv_stem_map');
        expect(names).toContain('validate_3d_scene');
        expect(names).toContain('create_3d_mv_scene');
        expect(names).toContain('update_3d_scene');
        expect(names).toContain('get_3d_scene_diagnostics');
        expect(names).toContain('validate_mv_timeline');
        expect(names).toContain('render_mv_clip');
        expect(names).toContain('split_mv_scene');
        expect(names).toContain('resize_mv_scene');
        expect(names).toContain('update_mv_effect');
        expect(names).toContain('list_3d_capabilities');
        expect(names).toContain('validate_3d_scene_graph');
        expect(names).toContain('create_3d_scene');
        expect(names).toContain('get_3d_scene_graph');
        expect(names).toContain('patch_3d_scene_graph');
        expect(names).toContain('inspect_3d_scene');
        expect(names).toContain('render_3d_scene_clip');
    });

    describe('add_mv_effect / delete_mv_effect / save_mv_effect_asset', () => {
        it('エフェクトの追加・削除・アセット保存が正常に動作する', async () => {
            const { context, configRef } = createMockContext();
            const addTool = WEB_MCP_TOOLS.find((t) => t.name === 'add_mv_effect')!;
            const delTool = WEB_MCP_TOOLS.find((t) => t.name === 'delete_mv_effect')!;
            const saveTool = WEB_MCP_TOOLS.find((t) => t.name === 'save_mv_effect_asset')!;

            // 追加
            const resAdd = await addTool.execute({
                name: 'Chorus Glitch',
                kind: 'rgb_glitch',
                startTime: 10,
                duration: 5,
                intensity: 0.9,
            }, context);
            expect(resAdd.success).toBe(true);
            expect(configRef.current.effects).toHaveLength(1);
            const effectId = configRef.current.effects![0].id;

            // アセット保存
            const resSave = await saveTool.execute({
                name: 'Saved Cyber Glitch',
                kind: 'rgb_glitch',
                description: 'Cyberpunk style glitch effect',
                intensity: 0.9,
            }, context);
            expect(resSave.success).toBe(true);
            expect(configRef.current.effectAssets).toHaveLength(1);

            // 削除
            const resDel = await delTool.execute({ effectId }, context);
            expect(resDel.success).toBe(true);
            expect(configRef.current.effects).toHaveLength(0);
        });
    });

    describe('get_mv_project', () => {
        it('プロジェクトの最新状態とシーン・歌詞・BPM情報を正しく取得する', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_mv_project')!;
            const res = await tool.execute({}, context);

            expect(res.success).toBe(true);
            const data = res.data as any;
            expect(data.title).toBe('Test Project');
            expect(data.bpm).toBe(128);
            expect(data.scenesCount).toBe(1);
            expect(data.scenes[0].name).toBe('Intro Scene');
            expect(data.lyricsCount).toBe(1);
        });
    });

    describe('3D scene tools', () => {
        it('トンネル面・リング・ストリップを独立して正規化する', () => {
            const openTunnel = normalizeMv3DScene({
                sceneType: 'tunnel',
                geometry: { floor: false, walls: false, ceiling: false },
            });
            expect(openTunnel.geometry.tunnelSurface).toBe(true);
            expect(openTunnel.geometry.tunnelRings).toBe(false);
            expect(openTunnel.geometry.tunnelStrips).toBe(false);

            const layeredTunnel = normalizeMv3DScene({
                sceneType: 'tunnel',
                geometry: {
                    tunnel: { surface: { enabled: true }, rings: false, strips: { enabled: false } },
                    floor: false,
                    walls: false,
                    ceiling: false,
                },
            });
            expect(layeredTunnel.geometry.tunnelSurface).toBe(true);
            expect(layeredTunnel.geometry.tunnelRings).toBe(false);
            expect(layeredTunnel.geometry.tunnelStrips).toBe(false);
        });

        it('宣言的な3Dシーンを検証・作成できる', async () => {
            const { context, configRef } = createMockContext({ scenes: [] });
            const validate = WEB_MCP_TOOLS.find((t) => t.name === 'validate_3d_scene')!;
            const create = WEB_MCP_TOOLS.find((t) => t.name === 'create_3d_mv_scene')!;
            const getGraph = WEB_MCP_TOOLS.find((t) => t.name === 'get_3d_scene_graph')!;
            const scene = {
                sceneType: 'tunnel',
                palette: ['#07152f', '#38bdf8'],
                geometry: { tunnel: { radius: 7, length: 80, segments: 32 }, floor: { enabled: true } },
                camera: { path: 'forward_dolly', fov: 58, speed: 1.1 },
            };
            const checked = await validate.execute({ scene }, context);
            expect(checked.success).toBe(true);
            expect((checked.data as any).scene.sceneType).toBe('procedural_tunnel');

            const created = await create.execute({ name: 'Tunnel', startTime: 0, duration: 12, scene }, context);
            expect(created.success).toBe(true);
            expect(configRef.current.scenes[0].threeD?.geometry.radius).toBe(7);
            expect(configRef.current.scenes[0].phaserTheme).toBe('none');
            const graph = await getGraph.execute({ sceneId: (created.data as any).scene.id }, context);
            expect((graph.data as any).source).toBe('preset_adapter');
            expect((graph.data as any).sceneGraph.nodes.length).toBeGreaterThan(0);
        });

        it('3Dシーンを部分更新し、範囲外の値を正規化する', async () => {
            const { context, configRef } = createMockContext({ scenes: [] });
            const create = WEB_MCP_TOOLS.find((t) => t.name === 'create_3d_mv_scene')!;
            const update = WEB_MCP_TOOLS.find((t) => t.name === 'update_3d_scene')!;
            const created = await create.execute({
                name: 'Room', startTime: 4, duration: 8,
                scene: { sceneType: 'room', camera: { path: 'static' } },
            }, context);
            const id = (created.data as any).scene.id;
            const result = await update.execute({ sceneId: id, patch: { lighting: { bloomStrength: 4 }, camera: { fov: 120 } } }, context);
            expect(result.success).toBe(true);
            expect(configRef.current.scenes[0].threeD?.lighting.bloomStrength).toBe(1);
            expect(configRef.current.scenes[0].threeD?.camera.fov).toBe(90);
        });

        it('宣言的なScene Graphを作成・取得・差分更新できる', async () => {
            const { context, configRef } = createMockContext({ scenes: [] });
            const validate = WEB_MCP_TOOLS.find((t) => t.name === 'validate_3d_scene_graph')!;
            const create = WEB_MCP_TOOLS.find((t) => t.name === 'create_3d_scene')!;
            const get = WEB_MCP_TOOLS.find((t) => t.name === 'get_3d_scene_graph')!;
            const patch = WEB_MCP_TOOLS.find((t) => t.name === 'patch_3d_scene_graph')!;
            const graph = {
                renderer: { toneMapping: 'aces', exposure: 1.1, bloom: { strength: 0.35, threshold: 0.7 } },
                environment: { background: '#020617', fog: { color: '#09162d', near: 8, far: 140, density: 0.015 } },
                camera: { type: 'perspective', fov: 58, position: [0, 2, 18], lookAt: [0, 1, -20], motion: { type: 'dolly', speed: 0.18, parallax: 0.22 } },
                lights: [{ id: 'key', type: 'point', color: '#55eaff', intensity: 8, position: [0, 6, -18] }],
                nodes: [{ id: 'monolith', geometry: { type: 'box', size: [3, 12, 2] }, material: { type: 'physical', color: '#17132e', metalness: 0.8, roughness: 0.22 }, transform: { position: [0, 0, -24] } }],
            };
            const checked = await validate.execute({ sceneGraph: graph }, context);
            expect(checked.success).toBe(true);
            expect((checked.data as any).renderedNodes).toEqual(['monolith']);
            expect((checked.data as any).ignoredFields).toEqual([]);

            const created = await create.execute({ name: 'Graph Scene', startTime: 0, duration: 10, sceneGraph: graph }, context);
            expect(created.success).toBe(true);
            const id = (created.data as any).scene.id;
            expect(configRef.current.scenes[0].threeD?.sceneType).toBe('scene_graph');
            const fetched = await get.execute({ sceneId: id }, context);
            expect((fetched.data as any).sceneGraph.nodes[0].id).toBe('monolith');

            const updated = await patch.execute({ sceneId: id, operations: [
                { op: 'addNode', node: { id: 'ring', geometry: { type: 'torus', radius: 8, tube: 0.08 }, material: { type: 'emissive', color: '#64edff', intensity: 2.2 }, transform: { position: [0, 1, -16] }, repeat: { count: 3, axis: 'z', spacing: 7 } } },
                { op: 'updateNode', id: 'monolith', patch: { transform: { position: [0, 3, -24] } } },
            ] }, context);
            expect(updated.success).toBe(true);
            expect((updated.data as any).renderedNodes).toEqual(['monolith', 'ring']);
            expect(configRef.current.scenes[0].threeD?.sceneGraph?.nodes).toHaveLength(2);
            expect(configRef.current.scenes[0].threeD?.sceneGraph?.nodes[0].transform.position).toEqual([0, 3, -24]);
        });
    });

    describe('add_mv_scene', () => {
        it('新しいシーンをタイムラインに追加しソートする', async () => {
            const { context, configRef } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'add_mv_scene')!;

            const res = await tool.execute({
                name: 'Chorus Scene',
                startTime: 15.0,
                duration: 8.0,
                // テンプレ演出指定は無視される (人間 UI 専用のため常に none)
                phaserTheme: 'cyber_grid',
                lyricEffect: 'neon_glow',
            }, context);

            expect(res.success).toBe(true);
            expect(configRef.current.scenes.length).toBe(2);
            expect(configRef.current.scenes[1].name).toBe('Chorus Scene');
            expect(configRef.current.scenes[1].startTime).toBe(15.0);
            // テンプレ演出はエージェント経由では常に none (人間 UI 専用の設計)
            expect(configRef.current.scenes[1].phaserTheme).toBe('none');
            expect(configRef.current.scenes[1].lyricEffect).toBe('none');
        });

        it('startTime が負数の場合はエラーを返す', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'add_mv_scene')!;

            const res = await tool.execute({
                name: 'Bad Scene',
                startTime: -5,
            }, context);

            expect(res.success).toBe(false);
            expect(res.message).toContain('startTime');
        });
    });

    describe('update_mv_scene', () => {
        it('ID 指定でシーンのプロパティを部分更新する', async () => {
            const { context, configRef } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'update_mv_scene')!;

            const res = await tool.execute({
                sceneId: 'scene_1',
                name: 'Updated Intro',
            }, context);

            expect(res.success).toBe(true);
            expect(configRef.current.scenes[0].name).toBe('Updated Intro');
            // テンプレ演出はエージェント経由では変更されない (人間 UI 専用)
            expect(configRef.current.scenes[0].phaserTheme).toBe('oscilloscope');
        });

        it('存在しないシーンIDを指定した場合はエラーを返す', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'update_mv_scene')!;

            const res = await tool.execute({
                sceneId: 'non_existent',
                name: 'New Name',
            }, context);

            expect(res.success).toBe(false);
        });

        it('ID の部分一致でシーンを解決して更新する', async () => {
            const { context, configRef } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'update_mv_scene')!;

            const res = await tool.execute({
                sceneId: 'ne_1', // scene_1 の部分一致
                name: 'Partial Matched',
            }, context);

            expect(res.success).toBe(true);
            expect(configRef.current.scenes[0].name).toBe('Partial Matched');
        });

        it('シーン名指定でも更新できる', async () => {
            const { context, configRef } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'update_mv_scene')!;

            const res = await tool.execute({
                sceneId: 'Intro Scene',
                name: 'Renamed By Name',
            }, context);

            expect(res.success).toBe(true);
            expect(configRef.current.scenes[0].name).toBe('Renamed By Name');
        });

        it('解決失敗時は現存シーン一覧をエラーへ添えて返す', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'update_mv_scene')!;

            const res = await tool.execute({
                sceneId: 'totally_unknown',
                name: 'X',
            }, context);

            expect(res.success).toBe(false);
            expect(res.message).toContain('現存するシーン');
            expect(res.message).toContain('scene_1');
            expect((res.data as { availableScenes: unknown[] }).availableScenes.length).toBe(1);
        });
    });

    describe('select_mv_scene', () => {
        it('シーンを選択し onSelectScene へ ID を通知する', async () => {
            const { context } = createMockContext();
            const selectMock = vi.fn();
            (context as { onSelectScene?: unknown }).onSelectScene = selectMock;
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'select_mv_scene')!;

            const res = await tool.execute({ sceneIndex: 0 }, context);

            expect(res.success).toBe(true);
            expect(selectMock).toHaveBeenCalledWith('scene_1');
            expect(res.message).toContain('Intro Scene');
        });

        it('名前部分一致でも選択できる', async () => {
            const { context } = createMockContext();
            const selectMock = vi.fn();
            (context as { onSelectScene?: unknown }).onSelectScene = selectMock;
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'select_mv_scene')!;

            const res = await tool.execute({ sceneId: 'Intro' }, context);

            expect(res.success).toBe(true);
            expect(selectMock).toHaveBeenCalledWith('scene_1');
        });

        it('存在しないシーンはエラーになり候補を添える', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'select_mv_scene')!;

            const res = await tool.execute({ sceneId: 'nope' }, context);

            expect(res.success).toBe(false);
            expect(res.message).toContain('現存するシーン');
        });

        it('ホストが未対応の場合は明確に失敗を返す', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'select_mv_scene')!;

            const res = await tool.execute({ sceneIndex: 0 }, context);

            expect(res.success).toBe(false);
            expect(res.message).toContain('サポートされていません');
        });
    });

    describe('export_mv_project', () => {
        it('プリセット形式ヘッダー付き JSON をホストへ渡してダウンロードする', async () => {
            const { context } = createMockContext();
            const exportMock = vi.fn(() => true);
            (context as { onExportProject?: unknown }).onExportProject = exportMock;
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'export_mv_project')!;

            const res = await tool.execute({ name: '俺のMV' }, context);

            expect(res.success).toBe(true);
            expect(exportMock).toHaveBeenCalledTimes(1);
            const [json, filename] = exportMock.mock.calls[0] as unknown as [string, string];
            const parsed = JSON.parse(json);
            expect(parsed.format).toBe('voivent-mv-preset');
            expect(parsed.version).toBe(1);
            expect(parsed.name).toBe('俺のMV');
            expect(parsed.config.scenes).toHaveLength(1);
            expect(filename).toBe('俺のMV.voivent-mv.json');
            expect(res.message).toContain('俺のMV.voivent-mv.json');
        });

        it('プリセット名未指定時はプロジェクトタイトルを使う', async () => {
            const { context } = createMockContext();
            const exportMock = vi.fn(() => true);
            (context as { onExportProject?: unknown }).onExportProject = exportMock;
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'export_mv_project')!;

            const res = await tool.execute({}, context);

            const [json, filename] = exportMock.mock.calls[0] as unknown as [string, string];
            expect(JSON.parse(json).name).toBe('Test Project');
            expect(filename).toBe('Test Project.voivent-mv.json');
            expect(res.success).toBe(true);
        });

        it('ホスト未対応時は明確に失敗を返す', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'export_mv_project')!;

            const res = await tool.execute({}, context);

            expect(res.success).toBe(false);
            expect(res.message).toContain('サポートされていません');
        });

        it('ホストがダウンロード失敗を返したら success=false', async () => {
            const { context } = createMockContext();
            (context as { onExportProject?: unknown }).onExportProject = () => false;
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'export_mv_project')!;

            const res = await tool.execute({}, context);

            expect(res.success).toBe(false);
            expect(res.message).toContain('失敗');
        });
    });

    describe('delete_mv_scene', () => {
        it('指定したインデックスのシーンを削除する', async () => {
            const { context, configRef } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'delete_mv_scene')!;

            const res = await tool.execute({ sceneIndex: 0 }, context);

            expect(res.success).toBe(true);
            expect(configRef.current.scenes.length).toBe(0);
        });
    });

    describe('set_mv_lyrics', () => {
        it('歌詞リストを一括置換設定する', async () => {
            const { context, configRef } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'set_mv_lyrics')!;

            const res = await tool.execute({
                lyrics: [
                    { time: 0.5, text: 'First Line', duration: 2.0 },
                    { time: 3.0, text: 'Second Line', duration: 2.5 },
                ],
                append: false,
            }, context);

            expect(res.success).toBe(true);
            expect(configRef.current.lyrics.length).toBe(2);
            expect(configRef.current.lyrics[0].text).toBe('First Line');
        });
    });

    describe('set_preview_resolution', () => {
        it('有効な解像度プリセット（9:16 Shorts）へ切り替える', async () => {
            const { context, configRef } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'set_preview_resolution')!;

            const res = await tool.execute({ resolutionId: 'shorts_fhd' }, context);

            expect(res.success).toBe(true);
            expect(configRef.current.previewResolutionId).toBe('shorts_fhd');
        });

        it('無効な解像度プリセット ID の場合はエラーを返す', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'set_preview_resolution')!;

            const res = await tool.execute({ resolutionId: 'invalid_ratio' }, context);

            expect(res.success).toBe(false);
            expect(res.message).toContain('存在しません');
        });
    });

    describe('control_mv_transport', () => {
        it('seek アクションで指定秒数へジャンプする', async () => {
            const { context, onSeekMock } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'control_mv_transport')!;

            const res = await tool.execute({ action: 'seek', seekTimeSec: 14.5 }, context);

            expect(res.success).toBe(true);
            expect(onSeekMock).toHaveBeenCalledWith(14.5);
        });

        it('toggle_play アクションで再生状態を切り替える', async () => {
            const { context, onTogglePlayMock } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'control_mv_transport')!;

            const res = await tool.execute({ action: 'toggle_play' }, context);

            expect(res.success).toBe(true);
            expect(onTogglePlayMock).toHaveBeenCalled();
        });
    });

    describe('get_energy_map', () => {
        /** 指定セグメント [from, to, amp] で振幅が定義された解析ピークを生成する */
        function makeAnalysis(
            durationSec: number,
            segments: Array<{ from: number; to: number; amp: number }>,
            samplesPerSec = 20,
        ): { peaks: Array<[number, number]>; duration: number } {
            const count = Math.ceil(durationSec * samplesPerSec);
            const peaks: Array<[number, number]> = [];
            for (let i = 0; i < count; i++) {
                const t = (i + 0.5) / samplesPerSec;
                const seg = segments.find((s) => t >= s.from && t < s.to);
                const amp = seg ? seg.amp : 0;
                peaks.push([-amp, amp]);
            }
            return { peaks, duration: durationSec };
        }

        function createAnalysisContext(analysis: { peaks: Array<[number, number]>; duration: number } | null): WebMcpContext {
            const base = createMockContext();
            return { ...base.context, getAnalysis: () => analysis };
        }

        it('楽曲未読込の場合はエラーを返す', async () => {
            const context = createAnalysisContext(null);
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_energy_map')!;

            const res = await tool.execute({}, context);

            expect(res.success).toBe(false);
            expect(res.message).toContain('読み込まれていない');
        });

        it('BPM 同期バンドとサマリ（イントロ/ピーク/ドロップ）を返す', async () => {
            // 0-2s: 静寂 / 2-6s: 中強度 / 6-8s: 急落
            const analysis = makeAnalysis(8, [
                { from: 0, to: 2, amp: 0.02 },
                { from: 2, to: 6, amp: 0.6 },
                { from: 6, to: 8, amp: 0.1 },
            ]);
            const context = createAnalysisContext(analysis);
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_energy_map')!;

            const res = await tool.execute({ bandsPerBeat: 2, maxBands: 64 }, context);

            expect(res.success).toBe(true);
            const data = res.data as any;
            expect(data.bpm).toBe(128);
            // 128 BPM → beat 0.46875s、8分バンド 0.234375s → 8 秒 = 34.13 拍 → 35 バンド（端数切上げ）
            expect(data.totalBands).toBe(35);
            expect(data.truncated).toBe(false);
            expect(data.bands.length).toBe(35);
            expect(data.bands[0].kind).toBe('quiet');
            // 区切りはバンド境界に丸められる（bandSec = 0.234375s）
            expect(data.summary.introEndSec).toBeCloseTo(2.109375, 5);
            expect(data.summary.dropStartSec).toBeCloseTo(6.09375, 5);
            expect(data.summary.peakEnergy).toBeCloseTo(0.6, 3);
            // 応答バンドは丸め込みの軽量フィールドのみ
            expect(Object.keys(data.bands[0]).sort()).toEqual(['bar', 'beatInBar', 'endSec', 'energy', 'kind', 'startSec']);
        });

        it('maxBands 超過時は間引きフラグ付きで返す', async () => {
            const analysis = makeAnalysis(16, [{ from: 0, to: 16, amp: 0.5 }]);
            const context = createAnalysisContext(analysis);
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_energy_map')!;

            const res = await tool.execute({ maxBands: 8 }, context);

            expect(res.success).toBe(true);
            const data = res.data as any;
            // 128 BPM × 16 秒 → 8分バンド 0.234375s → 69 バンド（端数切上げ）→ 8 バンドへ間引き
            expect(data.totalBands).toBe(69);
            expect(data.truncated).toBe(true);
            expect(data.bands.length).toBe(8);
        });
    });

    describe('create_full_mv_scenes', () => {
        it('複数のシーンを一括でタイムラインに構築・配置する', async () => {
            const { context, configRef } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'create_full_mv_scenes')!;

            const res = await tool.execute({
                scenes: [
                    { name: 'Intro', startTime: 0, duration: 15, phaserTheme: 'ambient_bokeh' },
                    { name: 'Chorus A', startTime: 15, duration: 30, phaserTheme: 'fluid_aurora' },
                    { name: 'Outro', startTime: 45, duration: 15, phaserTheme: 'starfield_warp' },
                ],
            }, context);

            expect(res.success).toBe(true);
            expect(configRef.current.scenes.length).toBe(3);
            expect(configRef.current.scenes[0].name).toBe('Intro');
            expect(configRef.current.scenes[1].name).toBe('Chorus A');
            expect(configRef.current.scenes[2].name).toBe('Outro');
        });
    });

    describe('get_mv_preview', () => {
        it('ポート未接続時は success: false を返す', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_mv_preview')!;
            const result = await tool.execute({}, context);
            expect(result.success).toBe(false);
            expect(result.message).toContain('キャプチャ');
        });

        it('ポート接続時は JPEG 画像コンテントを返す', async () => {
            const { context } = createMockContext();
            (context as any).getPreviewCapture = () => ({
                isAvailable: () => true,
                captureJpeg: async () => ({
                    dataUrl: 'data:image/jpeg;base64,QUJD',
                    width: 512,
                    height: 288,
                }),
            });
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_mv_preview')!;
            const result = await tool.execute({ maxWidth: 256 }, context);
            expect(result.success).toBe(true);
            const images = (result as any).images;
            expect(Array.isArray(images)).toBe(true);
            expect(images[0].type).toBe('image');
            expect(images[0].data).toBe('QUJD');
            expect(images[0].mimeType).toBe('image/jpeg');
        });

        it('captureJpeg が null を返した場合は失敗を返す', async () => {
            const { context } = createMockContext();
            (context as any).getPreviewCapture = () => ({
                isAvailable: () => true,
                captureJpeg: async () => null,
            });
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_mv_preview')!;
            const result = await tool.execute({}, context);
            expect(result.success).toBe(false);
        });

        it('sceneId 指定時は対象シーンの時刻を選び、シーンを選択する', async () => {
            const { context, onTogglePlayMock } = createMockContext();
            const selected = vi.fn();
            (context as any).onSelectScene = selected;
            (context as any).getPreviewCapture = () => ({
                isAvailable: () => true,
                captureJpeg: async (_max: number, time: number) => ({ dataUrl: 'data:image/jpeg;base64,QUJD', width: 256, height: 144, time }),
            });
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_mv_preview')!;
            const result = await tool.execute({ sceneId: 'scene_1' }, context);
            expect(result.success).toBe(true);
            expect(selected).toHaveBeenCalledWith('scene_1');
            expect((result.data as any).timeSec).toBe(1);
            expect(onTogglePlayMock).not.toHaveBeenCalled();
        });
    });

    describe('review and timeline tools', () => {
        it('短尺フレーム列を返す', async () => {
            const { context } = createMockContext();
            (context as any).getPreviewCapture = () => ({
                isAvailable: () => true,
                captureFrames: async () => [
                    { dataUrl: 'data:image/jpeg;base64,QQ==', width: 128, height: 72, timeSec: 0 },
                    { dataUrl: 'data:image/jpeg;base64,Qg==', width: 128, height: 72, timeSec: 0.25 },
                ],
                captureJpeg: async () => null,
            });
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'render_mv_clip')!;
            const result = await tool.execute({ startSec: 0, endSec: 1 }, context);
            expect(result.success).toBe(true);
            expect((result.data as any).frameCount).toBe(2);
            expect((result as any).content).toHaveLength(2);
        });

        it('シーン分割とリップル付きリサイズを行う', async () => {
            const { context, configRef } = createMockContext({
                scenes: [
                    { id: 'a', name: 'A', startTime: 0, endTime: 5, phaserTheme: 'none', lyricEffect: 'none' },
                    { id: 'b', name: 'B', startTime: 5, endTime: 10, phaserTheme: 'none', lyricEffect: 'none' },
                ],
            });
            const split = WEB_MCP_TOOLS.find((t) => t.name === 'split_mv_scene')!;
            const resize = WEB_MCP_TOOLS.find((t) => t.name === 'resize_mv_scene')!;
            const splitResult = await split.execute({ sceneId: 'a', splitTime: 2 }, context);
            expect(splitResult.success).toBe(true);
            expect(configRef.current.scenes).toHaveLength(3);
            const resizeResult = await resize.execute({ sceneId: 'a', duration: 3, ripple: true }, context);
            expect(resizeResult.success).toBe(true);
            expect(configRef.current.scenes.find((s) => s.id === 'b')?.startTime).toBe(6);
        });

        it('エフェクト強度を削除せずに更新する', async () => {
            const { context, configRef } = createMockContext();
            const add = WEB_MCP_TOOLS.find((t) => t.name === 'add_mv_effect')!;
            const update = WEB_MCP_TOOLS.find((t) => t.name === 'update_mv_effect')!;
            await add.execute({ name: 'Flash', kind: 'invert_flash', startTime: 1, intensity: 0.92 }, context);
            const id = configRef.current.effects![0].id;
            const result = await update.execute({ effectId: id, intensity: 0.18, enabled: false }, context);
            expect(result.success).toBe(true);
            expect(configRef.current.effects![0].intensity).toBe(0.18);
            expect(configRef.current.effects![0].enabled).toBe(false);
        });
    });

    describe('render_mv_video', () => {
        it('ポート未接続時は success: false を返す', async () => {
            const { context } = createMockContext();
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'render_mv_video')!;
            const result = await tool.execute({}, context);
            expect(result.success).toBe(false);
            expect(result.message).toContain('レンダリング');
        });

        it('区間 0.5 秒未満は拒否される', async () => {
            const { context } = createMockContext();
            (context as any).getVideoRender = () => ({
                isAvailable: () => true,
                renderVideo: async () => ({ ok: true, fileName: 'x.mp4' }),
            });
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'render_mv_video')!;
            // transport.duration = 60 のモックに対し 59.9〜60.0 (0.1 秒) を指定
            const result = await tool.execute({ startSec: 59.9, endSec: 60.0 }, context);
            expect(result.success).toBe(false);
            expect(result.message).toContain('0.5 秒');
        });

        it('レンダリング成功時はファイル名とフレーム数を返す', async () => {
            const { context } = createMockContext();
            let called: any = null;
            (context as any).getVideoRender = () => ({
                isAvailable: () => true,
                renderVideo: async (opts: any) => {
                    called = opts;
                    return { ok: true, fileName: 'Test_Project_0-3s.mp4', frames: 90, durationSec: 3 };
                },
            });
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'render_mv_video')!;
            const result = await tool.execute({ startSec: 0, endSec: 3 }, context);
            expect(result.success).toBe(true);
            expect(called.fps).toBe(30);
            expect(called.filename).toContain('Test_Project');
            expect((result as any).data.frames).toBe(90);
        });

        it('レンダリング失敗時はエラーメッセージを返す', async () => {
            const { context } = createMockContext();
            (context as any).getVideoRender = () => ({
                isAvailable: () => true,
                renderVideo: async () => ({ ok: false, error: 'エンコーダ起動失敗' }),
            });
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'render_mv_video')!;
            const result = await tool.execute({ startSec: 0, endSec: 3 }, context);
            expect(result.success).toBe(false);
            expect(result.message).toContain('エンコーダ起動失敗');
        });
    });
});

// ============================================================================
// stem 分離ツール (analyze_mv_stems / get_mv_stem_map) の契約テスト
// ============================================================================
describe('WebMCP stem tools', () => {
    /** stem 解析済みコンテキストを生成する */
    function createStemContext(analysis: any) {
        return {
            getConfig: () => ({ title: 'T', scenes: [], lyrics: [] }),
            setConfig: () => {},
            getTransport: () => ({ isPlaying: false, playheadSec: 0, bpm: 120, duration: 10 }),
            getAnalysis: () => null,
            onSeek: () => {},
            onTogglePlay: () => {},
            onStop: () => {},
            getStemAnalysis: () => analysis,
            runStemSeparation: async () => ({ ok: true, backend: 'webgpu', elapsedSec: 3.2 }),
        } as any;
    }

    const sampleAnalysis = {
        version: 1 as const,
        sampleRate: 44100,
        durationSec: 10,
        proposedBpm: 122,
        beatConfidence: 0.7,
        beatOffsetSec: 0.5,
        drumOnsets: [
            { timeSec: 1.0, strength: 0.9 },
            { timeSec: 1.5, strength: 0.4 },
            { timeSec: 2.0, strength: 0.8 },
        ],
        energy: {
            drums: [0.1, 0.9, 0.2, 0.5],
            vocals: [0, 0.8, 0.8, 0],
            bass: [0.7, 0.7, 0, 0],
            other: [0, 0, 0, 0],
        },
        bandSec: 0.25,
        vocalSegments: [{ startSec: 0.25, endSec: 0.75, meanEnergy: 0.8 }],
    };

    it('get_mv_stem_map: 未分離時は Stem分離 ボタンを案内する', async () => {
        const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_mv_stem_map')!;
        const res = await tool.execute({}, createStemContext(null));
        expect(res.success).toBe(false);
        expect(res.message).toContain('Stem分離');
    });

    it('get_mv_stem_map: 解析データを開示する (onset / 包絡 / 発声区間)', async () => {
        const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_mv_stem_map')!;
        const res = await tool.execute({}, createStemContext(sampleAnalysis));
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.proposedBpm).toBe(122);
        expect(data.drumOnsets.length).toBe(3);
        expect(data.energy.drums.length).toBe(4);
        expect(data.energy.vocals.length).toBe(4);
        expect(data.vocalSegments.length).toBe(1);
        expect(data.truncated).toBe(false);
    });

    it('get_mv_stem_map: kind 絞り込みと区間絞り込みが効く', async () => {
        const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_mv_stem_map')!;
        const res = await tool.execute({ kind: 'drums', fromSec: 1.2, toSec: 2.5 }, createStemContext(sampleAnalysis));
        const data = res.data as any;
        expect(data.energy.drums).toBeDefined();
        expect(data.energy.vocals).toBeUndefined();
        // onset は 1.5 / 2.0 の 2 件
        expect(data.drumOnsets.length).toBe(2);
    });

    it('get_mv_stem_map: maxOnsets は下限 16 にクランプされる (少量は間引きなし)', async () => {
        const tool = WEB_MCP_TOOLS.find((t) => t.name === 'get_mv_stem_map')!;
        const res = await tool.execute({ maxOnsets: 2 }, createStemContext(sampleAnalysis));
        const data = res.data as any;
        // 3 件は下限 16 以下なので全件返却・間切りなし
        expect(data.drumOnsets.length).toBe(3);
        expect(data.truncated).toBe(false);
    });

    it('analyze_mv_stems: runStemSeparation 未接続ホストは未対応を返す', async () => {
        const tool = WEB_MCP_TOOLS.find((t) => t.name === 'analyze_mv_stems')!;
        const res = await tool.execute({}, {} as any);
        expect(res.success).toBe(false);
    });

    it('analyze_mv_stems: 分離成功時はサマリを返す', async () => {
        const tool = WEB_MCP_TOOLS.find((t) => t.name === 'analyze_mv_stems')!;
        const ctx = {
            ...createStemContext(sampleAnalysis),
        } as any;
        const res = await tool.execute({}, ctx);
        expect(res.success).toBe(true);
        const data = res.data as any;
        expect(data.ok).toBe(true);
        expect(data.backend).toBe('webgpu');
        expect(data.proposedBpm).toBe(122);
        expect(data.drumOnsetsPreview.length).toBeLessThanOrEqual(64);
        expect(data.vocalSegmentCount).toBe(1);
    });

    it('analyze_mv_stems: 分離失敗時はエラーを返す', async () => {
        const tool = WEB_MCP_TOOLS.find((t) => t.name === 'analyze_mv_stems')!;
        const ctx = createStemContext(null) as any;
        ctx.runStemSeparation = async () => ({ ok: false, error: 'モデル未取得' });
        const res = await tool.execute({}, ctx);
        expect(res.success).toBe(false);
        expect(res.message).toContain('モデル未取得');
    });

    describe('set_mv_master_gain', () => {
        it('ゲイン倍率およびパーセント値でマスター音量を更新できる', async () => {
            const tool = WEB_MCP_TOOLS.find((t) => t.name === 'set_mv_master_gain')!;
            let currentGain = 1.0;
            const ctx: any = {
                getMasterGain: () => currentGain,
                setMasterGain: (g: number) => { currentGain = g; },
            };

            // 倍率 1.4
            const res1 = await tool.execute({ gain: 1.4 }, ctx);
            expect(res1.success).toBe(true);
            expect(currentGain).toBe(1.4);
            expect((res1.data as any)?.volumePercent).toBe(140);

            // パーセント 80%
            const res2 = await tool.execute({ volumePercent: 80 }, ctx);
            expect(res2.success).toBe(true);
            expect(currentGain).toBe(0.8);
            expect((res2.data as any)?.volumePercent).toBe(80);

            // リセット 1.0
            const res3 = await tool.execute({ gain: 1.0 }, ctx);
            expect(res3.success).toBe(true);
            expect(currentGain).toBe(1.0);
            expect((res3.data as any)?.volumePercent).toBe(100);
        });
    });
});
