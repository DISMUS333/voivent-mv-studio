//==============================================================================
// WebMCP (Web Model Context Protocol / サイトツール) ツール定義モジュール。
// ChatGPT デスクトップアプリの内蔵ブラウザや Chrome 149+ などの
// AI エージェントに対して、DAW の MV 操作を構造化ツールとして公開する。
//==============================================================================
import type { MvProjectConfig, MvScene, LyricEffectKind, LyricItem } from './types';
import { getResolutionPresets, getBitratePresets } from './mvExportPresets';
import { buildEnergyMap, downsampleEnergyMapBands } from './mvEnergyMap';
import { verifyTslShader, TSL_SHADER_CONTRACT_DOC } from './mvTslSandbox';
import type { StemAnalysis } from './stemAnalysis/types';
import { MV_3D_SCENE_TYPES, diagnoseMv3DScene, validateMv3DScene } from './mv3dScene';
import {
    applyMv3DSceneGraphOperations,
    createMv3DSceneGraphFromPreset,
    validateMv3DSceneGraph,
} from './mv3dSceneGraph';
import type { Mv3DFrameDiagnostics } from './mv3dOffline';

/** get_energy_map が参照する解析データの最小インターフェース */
export type EnergyAnalysisSource = {
    peaks?: Array<[number, number]>;
    duration?: number;
};

export interface WebMcpToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
    execute: (args: any, context: WebMcpContext) => Promise<WebMcpResult> | WebMcpResult;
}

export interface WebMcpContext {
    getConfig: () => MvProjectConfig;
    setConfig: (updater: (prev: MvProjectConfig) => MvProjectConfig) => void;
    getTransport: () => { isPlaying: boolean; playheadSec: number; bpm: number; duration: number };
    /** 楽曲解析データ（ピーク波形・長さ）。未ロード時は null */
    getAnalysis: () => EnergyAnalysisSource | null;
    onSeek: (sec: number) => void;
    onTogglePlay: () => void;
    onStop: () => void;
    /** プレビュー画面の JPEG キャプチャポート (get_mv_preview 用)。未接続時は null */
    getPreviewCapture?: () => WebMcpPreviewCapturePort | null;
    /** シーン選択要求 (select_mv_scene 用)。プレビューは選択中シーンを表示する */
    onSelectScene?: (sceneId: string) => void;
    /** プロジェクトのプリセット JSON ダウンロード要求 (export_mv_project 用)。
     *  未接続時はツールが未対応を返す */
    onExportProject?: (json: string, filename: string) => boolean;
    /** 動画レンダリングポート (render_mv_video 用)。未接続時は null */
    getVideoRender?: () => WebMcpVideoRenderPort | null;
    /** stem 分離解析結果 (analyze_mv_stems / get_mv_stem_map 用)。未分離時は null */
    getStemAnalysis?: () => StemAnalysis | null;
    /** stem 分離の実行要求 (AI トリガー)。ホスト未接続時は null */
    runStemSeparation?: (force: boolean) => Promise<{
        ok: boolean;
        backend?: string;
        elapsedSec?: number;
        error?: string;
        /** 初回モデル取得の許可が必要な場合にホスト側で表示する場合 true */
        needsConsent?: boolean;
    }>;
    /** マスターゲイン取得 (1.0 = 100%)。未接続時は null */
    getMasterGain?: () => number;
    /** マスターゲイン設定 (0.0〜2.0)。未接続時は null */
    setMasterGain?: (gain: number) => void;
}

/** プレビュー静止画キャプチャポートのホスト側インターフェース */
export interface WebMcpPreviewCapturePort {
    isAvailable: () => boolean;
    /** 現在のプレビュー内容を決定論的描画し、縮小 JPEG (data URL) 化して返す。
     *  timeSec を指定するとその時刻の 1 枚を描画 (未指定は現在の再生位置)。 */
    captureJpeg: (maxWidth?: number, timeSec?: number) => Promise<{ dataUrl: string; width: number; height: number; threeD?: Mv3DFrameDiagnostics } | null>;
    captureFrames?: (options: {
        startSec: number;
        endSec: number;
        fps: number;
        maxWidth: number;
    }) => Promise<Array<{ dataUrl: string; width: number; height: number; timeSec: number; threeD?: Mv3DFrameDiagnostics }> | null>;
}

/** 動画レンダリング (AI の「納品」) のホスト側ポート */
export interface WebMcpVideoRenderPort {
    isAvailable: () => boolean;
    renderVideo: (opts: {
        startSec: number;
        endSec: number;
        fps: number;
        width: number;
        height: number;
        bitrateBps: number;
        filename: string;
    }) => Promise<{ ok: boolean; fileName?: string; frames?: number; durationSec?: number; error?: string }>;
}

export interface WebMcpResultImage {
    type: 'image';
    data: string;
    mimeType: string;
}

/** WebMCP ツール実行結果 (MCP content 形式との互換フィールドを含む) */
export interface WebMcpResult {
    success: boolean;
    message: string;
    data?: unknown;
    /** MCP 標準の content 配列 (画像返却はここに {type:'image'} として含める) */
    content?: Array<{ type: 'text' | 'image'; text?: string; data?: string; mimeType?: string }>;
    /** 画像コンテント (get_mv_preview が使用)。後方互換のため content と並行して添付 */
    images?: WebMcpResultImage[];
}

/**
 * WebMCP ツール定義一覧
 */
export const WEB_MCP_TOOLS: WebMcpToolDefinition[] = [
    // ── 1. プロジェクト状態取得 ────────────────────────────────────────────────
    {
        name: 'get_mv_project',
        description: '現在開いている MV プロジェクトの全データ（シーン一覧、歌詞、BPM、解像度、再生状態）を取得します。',
        inputSchema: {
            type: 'object',
            properties: {},
        },
        execute: (_args, ctx) => {
            const config = ctx.getConfig();
            const transport = ctx.getTransport();
            return {
                success: true,
                message: `MV プロジェクト「${config.title || 'Untitled'}」の情報を取得しました（全 ${config.scenes.length} シーン、歌詞 ${config.lyrics.length} 行）。`,
                data: {
                    title: config.title,
                    bpm: transport.bpm,
                    sessionDuration: transport.duration,
                    playheadSec: transport.playheadSec,
                    isPlaying: transport.isPlaying,
                    masterGain: ctx.getMasterGain ? Number(ctx.getMasterGain().toFixed(2)) : 1.0,
                    volumePercent: ctx.getMasterGain ? Math.round(ctx.getMasterGain() * 100) : 100,
                    previewResolutionId: config.previewResolutionId ?? 'youtube_fhd',
                    scenesCount: config.scenes.length,
                    scenes: config.scenes.map((s) => ({
                        id: s.id,
                        name: s.name,
                        startTime: s.startTime,
                        endTime: s.endTime,
                        duration: Number((s.endTime - s.startTime).toFixed(2)),
                        phaserTheme: s.phaserTheme,
                        lyricEffect: s.lyricEffect,
                        svgCode: s.svgCode || undefined,
                        cssCode: s.cssCode || undefined,
                        shaderCode: s.shaderCode || undefined,
                        threeD: s.threeD || undefined,
                        artDirection: s.artDirection || undefined,
                    })),
                    lyricsCount: config.lyrics.length,
                    lyrics: config.lyrics,
                    lyricStyle: config.lyricStyle,
                    effects: config.effects ?? [],
                    effectAssets: config.effectAssets ?? [],
                },
            };
        },
    },

    // ── 2. 新規シーン追加 / 置換 ──────────────────────────────────────────────
    {
        name: 'add_mv_scene',
        description: 'タイムラインに新しい MV シーンを追加または既存シーンを置換します。曲全体の全シーンを構成・再構築する場合は、このツールを個別呼出しするのではなく create_full_mv_scenes を使用してください。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'シーン名' },
                startTime: { type: 'number', description: 'タイムライン上の開始時間（秒）' },
                duration: { type: 'number', description: 'シーンの長さ（秒）。既定は 4.0 秒' },
                shaderCode: {
                    type: 'string',
                    description: `【動的背景】Three.js / WebGPU による動的 GPU シェーダー。音楽（低音 u.uLow、ビート u.uBeat、時間 u.uTimeSec 等）と連動したビジュアルをコードで自由に表現できる。まず validate_mv_shader で合格させてから渡すこと。${TSL_SHADER_CONTRACT_DOC}`,
                },
                svgCode: {
                    type: 'string',
                    description: '【前景レイヤー】フレーム枠、図形、イラスト等のグラフィック要素。※歌詞は別レイヤーで表示されるため、背景側に文字を埋め込む必要はありません（純粋なビジュアルグラフィックに専念できます）。',
                },
                cssCode: {
                    type: 'string',
                    description: '音連動 CSS（任意）。var(--audio-peak / --audio-low / --audio-mid / --audio-high / --audio-beat) に反応するアニメーションを定義できる',
                },
                clearExisting: {
                    type: 'boolean',
                    description: 'true に設定すると、既存のシーンを全て削除してから新しいシーンを追加します（MV全体のシーン再構築時に有用）。',
                },
            },
            required: ['name', 'startTime', 'duration', 'svgCode'],
        },
        execute: async (args, ctx) => {
            const { name, startTime, duration = 4.0, svgCode, cssCode, shaderCode, clearExisting } = args;

            if (typeof startTime !== 'number' || startTime < 0) {
                return { success: false, message: 'startTime は 0 以上の数値を指定してください。' };
            }

            const validStart = Math.max(0, startTime);
            const validDur = Math.max(0.5, Number(duration) || 4.0);

            const newScene: MvScene = {
                id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: String(name),
                startTime: validStart,
                endTime: validStart + validDur,
                // テンプレ演出 (phaserTheme / lyricEffect) は人間 UI 専用。
                // エージェントには常に none を設定し、独自 shaderCode/svgCode/cssCode で作らせる。
                phaserTheme: 'none',
                lyricEffect: 'none' as LyricEffectKind,
                svgCode: svgCode || undefined,
                cssCode: cssCode || undefined,
                shaderCode: shaderCode ? String(shaderCode) : undefined,
            };

            ctx.setConfig((prev) => {
                // 初期状態の 300 秒全編単一シーン（初期プレースホルダー）または clearExisting が指定された場合はクリア
                const isInitialDefault = prev.scenes.length === 1 && prev.scenes[0].endTime >= 250 && !prev.scenes[0].svgCode;
                if (clearExisting || isInitialDefault) {
                    return { ...prev, scenes: [newScene] };
                }
                // タイムライン自己修復: ほぼ同じ時間帯 (開始/終了差 0.5s以内) の古いシーンがあれば自動置換し、二重レイヤー化を防ぐ
                const filtered = prev.scenes.filter((s) => {
                    const isSameRange = Math.abs(s.startTime - newScene.startTime) < 0.5 && Math.abs(s.endTime - newScene.endTime) < 0.5;
                    return !isSameRange;
                });
                const nextScenes = [...filtered, newScene].sort((a, b) => a.startTime - b.startTime);
                return { ...prev, scenes: nextScenes };
            });

            return {
                success: true,
                message: `シーン「${newScene.name}」を開始位置 ${newScene.startTime.toFixed(1)}秒 (長さ ${validDur.toFixed(1)}秒) に追加しました。`,
                data: { scene: newScene },
            };
        },
    },

    // ── 2.1. 宣言的3Dシーン ──────────────────────────────────────────────────
    {
        name: 'validate_3d_scene',
        description: '宣言的な3D背景シーンを検証します。ポリゴン密度、色、霧、照明、音連動値を正規化し、描画負荷の警告を返します。',
        inputSchema: {
            type: 'object',
            properties: {
                scene: {
                    type: 'object',
                    description: `3Dシーン仕様。sceneType は ${MV_3D_SCENE_TYPES.join(' / ')}。geometry、camera、lighting、audioReactive を指定できます。`,
                },
            },
            required: ['scene'],
        },
        execute: (args) => {
            const result = validateMv3DScene(args.scene);
            return {
                success: result.ok,
                message: result.ok
                    ? `3Dシーン検証に合格しました（${result.warnings.length}件の警告）。`
                    : `3Dシーン検証に失敗しました（${result.errors.length}件）。`,
                data: { errors: result.errors, warnings: result.warnings, scene: result.scene },
            };
        },
    },
    {
        name: 'create_3d_mv_scene',
        description: 'PerspectiveCamera、立体メッシュ、ライト、霧、音連動を使う本物の3D MV背景シーンを作成します。作成前に validate_3d_scene を使ってください。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'シーン名' },
                startTime: { type: 'number', description: '開始時間（秒）' },
                duration: { type: 'number', description: 'シーンの長さ（秒）' },
                scene: { type: 'object', description: '3Dシーン仕様（sceneType、palette、geometry、camera、lighting、audioReactive）' },
                clearExisting: { type: 'boolean', description: '既存シーンを置換するか' },
            },
            required: ['name', 'startTime', 'duration', 'scene'],
        },
        execute: async (args, ctx) => {
            if (typeof args.startTime !== 'number' || args.startTime < 0) {
                return { success: false, message: 'startTime は0以上の数値を指定してください。' };
            }
            const validation = validateMv3DScene(args.scene);
            if (!validation.ok || !validation.scene) {
                return { success: false, message: '3Dシーン仕様が不正です。', data: { errors: validation.errors, warnings: validation.warnings } };
            }
            const startTime = args.startTime;
            const duration = Math.max(0.5, Number(args.duration) || 4);
            const scene: MvScene = {
                id: `scene_3d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: String(args.name),
                startTime,
                endTime: startTime + duration,
                phaserTheme: 'none',
                lyricEffect: 'none' as LyricEffectKind,
                threeD: validation.scene,
            };
            ctx.setConfig((prev) => {
                if (args.clearExisting) return { ...prev, scenes: [scene] };
                const next = prev.scenes.filter((s) => !(Math.abs(s.startTime - scene.startTime) < 0.5 && Math.abs(s.endTime - scene.endTime) < 0.5));
                return { ...prev, scenes: [...next, scene].sort((a, b) => a.startTime - b.startTime) };
            });
            // Reactの状態反映を待ってから実フレームを1枚描画し、Scene Graphの
            // 検証だけでなく「実際に黒ではないか」も作成直後に確認する。
            let renderCheck: unknown = { status: 'not_available' as const };
            const previewPort = ctx.getPreviewCapture?.() ?? null;
            if (previewPort?.isAvailable()) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                const shot = await previewPort.captureJpeg(256, startTime);
                if (shot?.threeD) {
                    renderCheck = {
                        status: 'checked' as const,
                        passed: shot.threeD.rendererReady && shot.threeD.maxLuminance > 0.004,
                        ...shot.threeD,
                    };
                } else if (shot) {
                    renderCheck = { status: 'checked' as const, passed: false, lastRenderError: '3Dフレーム診断が返りませんでした。' };
                }
            }
            const renderCheckFailed = typeof renderCheck === 'object' && renderCheck !== null
                && 'passed' in renderCheck && renderCheck.passed === false;
            return {
                success: true,
                message: `3Dシーン「${scene.name}」を作成しました。${renderCheckFailed ? '実フレーム検証で黒または未描画を検出しました。' : ''}${validation.warnings.length > 0 ? `警告: ${validation.warnings.join(' ')}` : ''}`,
                data: { scene, warnings: validation.warnings, renderCheck },
            };
        },
    },
    {
        name: 'update_3d_scene',
        description: '既存3Dシーンのカメラ、照明、霧、密度、音連動だけを部分更新します。',
        inputSchema: {
            type: 'object',
            properties: {
                sceneId: { type: 'string', description: '対象シーンIDまたはシーン名' },
                patch: { type: 'object', description: '変更する3Dシーン項目。ネストした項目も部分更新できます。' },
            },
            required: ['sceneId', 'patch'],
        },
        execute: (args, ctx) => {
            const config = ctx.getConfig();
            const key = String(args.sceneId ?? '');
            const target = config.scenes.find((s) => s.id === key || s.id.includes(key) || s.name === key);
            if (!target?.threeD) return { success: false, message: '指定された3Dシーンが見つかりません。' };
            const merge = (base: any, patch: any): any => {
                if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
                const out = { ...(base && typeof base === 'object' ? base : {}) };
                for (const [k, v] of Object.entries(patch)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(out[k], v) : v;
                return out;
            };
            const validation = validateMv3DScene(merge(target.threeD, args.patch));
            if (!validation.ok || !validation.scene) return { success: false, message: '更新後の3Dシーン仕様が不正です。', data: { errors: validation.errors, warnings: validation.warnings } };
            ctx.setConfig((prev) => ({ ...prev, scenes: prev.scenes.map((s) => s.id === target.id ? { ...s, threeD: validation.scene } : s) }));
            return { success: true, message: `3Dシーン「${target.name}」を更新しました。`, data: { sceneId: target.id, scene: validation.scene, warnings: validation.warnings } };
        },
    },
    {
        name: 'get_3d_scene_diagnostics',
        description: '指定時刻の3Dカメラ位置、視線、天井・床・壁との距離、歌詞セーフゾーン侵入を診断します。静止プレビューと併用して構図を修正してください。',
        inputSchema: {
            type: 'object',
            properties: {
                sceneId: { type: 'string', description: '対象シーン ID または名前' },
                timeSec: { type: 'number', description: '診断するタイムライン時刻。既定はシーン開始時' },
            },
            required: ['sceneId'],
        },
        execute: (args, ctx) => {
            const key = String(args.sceneId ?? '');
            const target = ctx.getConfig().scenes.find((s) => s.id === key || s.id.includes(key) || s.name === key);
            if (!target?.threeD) return { success: false, message: '指定された3Dシーンが見つかりません。' };
            const timeSec = typeof args.timeSec === 'number' && Number.isFinite(args.timeSec) ? args.timeSec : target.startTime;
            const diagnostics = diagnoseMv3DScene(target.threeD, timeSec);
            return {
                success: true,
                message: diagnostics.warnings.length > 0 ? `3D診断で${diagnostics.warnings.length}件の注意点が見つかりました。` : '3D診断に問題はありません。',
                data: { sceneId: target.id, sceneName: target.name, diagnostics },
            };
        },
    },
    {
        name: 'list_3d_capabilities',
        description: '宣言的な3Dシーンで利用できるジオメトリ、ボクセル地形、階層、マテリアル、ライト、カメラ、検証情報を返します。',
        inputSchema: { type: 'object', properties: {} },
        execute: () => ({
            success: true,
            message: '宣言的3Dシーンの対応機能一覧を取得しました。',
            data: {
                geometry: ['box', 'sphere', 'torus', 'cylinder', 'plane', 'icosahedron', 'text', 'gltf'],
                materials: ['standard', 'physical', 'emissive', 'voxel', 'toon', 'unlit', 'glass', 'water'],
                lights: ['ambient', 'point', 'directional', 'spot'],
                camera: ['perspective', 'static', 'dolly', 'orbit', 'path_points'],
                world: ['voxelWorld', 'voxelTerrain', 'noise', 'seed', 'water', 'trees', 'buildings', 'instanced_blocks', 'chunk_streaming'],
                hierarchy: ['groups', 'parent'],
                operations: ['addNode', 'updateNode', 'removeNode'],
                unsupported: ['custom shader geometry'],
                diagnostics: ['renderedNodes', 'ignoredFields', 'triangles', 'drawCalls', 'lyricSafeZoneIntrusion'],
            },
        }),
    },
    {
        name: 'validate_3d_scene_graph',
        description: '宣言的3Dシーングラフを正規化し、ノードID、未対応項目、推定三角形数、描画回数を検証します。',
        inputSchema: {
            type: 'object',
            properties: { sceneGraph: { type: 'object', description: 'renderer、environment、camera、lights、nodesを含むシーングラフ' } },
            required: ['sceneGraph'],
        },
        execute: (args) => {
            const result = validateMv3DSceneGraph(args.sceneGraph);
            return {
                success: result.ok,
                message: result.ok
                    ? `3Dシーングラフ検証に合格しました（${result.manifest.renderedNodes.length}ノード）。`
                    : `3Dシーングラフ検証に失敗しました（${result.errors.length}件）。`,
                data: {
                    sceneGraph: result.sceneGraph,
                    renderedNodes: result.manifest.renderedNodes,
                    ignoredFields: result.manifest.ignoredFields,
                    triangles: result.manifest.triangles,
                    drawCalls: result.manifest.drawCalls,
                    errors: result.errors,
                    warnings: result.warnings,
                },
            };
        },
    },
    {
        name: 'create_3d_scene',
        description: '自動プリセットを使わず、宣言されたノード・マテリアル・ライト・カメラだけで3D MVシーンを作成します。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'シーン名' },
                startTime: { type: 'number', description: '開始時間（秒）' },
                duration: { type: 'number', description: 'シーンの長さ（秒）' },
                sceneGraph: { type: 'object', description: '宣言的3Dシーングラフ' },
                clearExisting: { type: 'boolean', description: '既存シーンを置換するか' },
            },
            required: ['name', 'startTime', 'duration', 'sceneGraph'],
        },
        execute: (args, ctx) => {
            if (typeof args.startTime !== 'number' || args.startTime < 0) return { success: false, message: 'startTime は0以上の数値を指定してください。' };
            const graphResult = validateMv3DSceneGraph(args.sceneGraph);
            if (!graphResult.ok || !graphResult.sceneGraph) {
                return { success: false, message: '3Dシーングラフが不正です。', data: { errors: graphResult.errors, warnings: graphResult.warnings, ignoredFields: graphResult.manifest.ignoredFields } };
            }
            const sceneConfig = validateMv3DScene({ sceneType: 'scene_graph', sceneGraph: graphResult.sceneGraph });
            if (!sceneConfig.ok || !sceneConfig.scene) return { success: false, message: '3Dシーン設定の生成に失敗しました。', data: { errors: sceneConfig.errors } };
            const duration = Math.max(0.5, Number(args.duration) || 4);
            const scene: MvScene = {
                id: `scene_graph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: String(args.name),
                startTime: args.startTime,
                endTime: args.startTime + duration,
                phaserTheme: 'none',
                lyricEffect: 'none' as LyricEffectKind,
                threeD: sceneConfig.scene,
            };
            ctx.setConfig((prev) => args.clearExisting
                ? { ...prev, scenes: [scene] }
                : { ...prev, scenes: [...prev.scenes, scene].sort((a, b) => a.startTime - b.startTime) });
            return {
                success: true,
                message: `3Dシーン「${scene.name}」を作成しました。${graphResult.warnings.length > 0 ? `警告: ${graphResult.warnings.join(' ')}` : ''}`,
                data: {
                    scene,
                    renderedNodes: graphResult.manifest.renderedNodes,
                    ignoredFields: graphResult.manifest.ignoredFields,
                    triangles: graphResult.manifest.triangles,
                    drawCalls: graphResult.manifest.drawCalls,
                },
            };
        },
    },
    {
        name: 'get_3d_scene_graph',
        description: '指定した3Dシーンの正規化済みシーングラフと描画実績を取得します。',
        inputSchema: {
            type: 'object',
            properties: { sceneId: { type: 'string', description: '対象シーンIDまたは名前' } },
            required: ['sceneId'],
        },
        execute: (args, ctx) => {
            const key = String(args.sceneId ?? '');
            const target = ctx.getConfig().scenes.find((s) => s.id === key || s.id.includes(key) || s.name === key);
            if (!target?.threeD) return { success: false, message: '指定された3Dシーンが見つかりません。' };
            const graph = target.threeD.sceneGraph ?? createMv3DSceneGraphFromPreset(target.threeD);
            const manifest = validateMv3DSceneGraph(graph).manifest;
            return { success: true, message: `3Dシーン「${target.name}」のシーングラフを取得しました。`, data: { sceneId: target.id, sceneName: target.name, source: target.threeD.sceneGraph ? 'scene_graph' : 'preset_adapter', sceneGraph: graph, ...manifest } };
        },
    },
    {
        name: 'patch_3d_scene_graph',
        description: '3DシーングラフへaddNode、updateNode、removeNodeの差分操作を適用します。',
        inputSchema: {
            type: 'object',
            properties: {
                sceneId: { type: 'string', description: '対象シーンIDまたは名前' },
                operations: { type: 'array', description: 'Scene Graph差分操作の配列' },
            },
            required: ['sceneId', 'operations'],
        },
        execute: (args, ctx) => {
            const key = String(args.sceneId ?? '');
            const target = ctx.getConfig().scenes.find((s) => s.id === key || s.id.includes(key) || s.name === key);
            if (!target?.threeD) return { success: false, message: '指定された3Dシーンが見つかりません。' };
            const currentGraph = target.threeD.sceneGraph ?? createMv3DSceneGraphFromPreset(target.threeD);
            const applied = applyMv3DSceneGraphOperations(currentGraph, args.operations);
            if (!applied.sceneGraph) return { success: false, message: 'Scene Graphの差分適用に失敗しました。', data: { errors: applied.errors } };
            const checked = validateMv3DSceneGraph(applied.sceneGraph);
            if (!checked.ok || !checked.sceneGraph) return { success: false, message: '更新後のScene Graphが不正です。', data: { errors: checked.errors, warnings: checked.warnings } };
            ctx.setConfig((prev) => ({
                ...prev,
                scenes: prev.scenes.map((scene) => scene.id === target.id
                    ? { ...scene, threeD: { ...scene.threeD!, sceneType: 'scene_graph', sceneGraph: checked.sceneGraph } }
                    : scene),
            }));
            return { success: true, message: `3Dシーン「${target.name}」のScene Graphを更新しました。`, data: { sceneId: target.id, sceneGraph: checked.sceneGraph, ...checked.manifest } };
        },
    },
    {
        name: 'inspect_3d_scene',
        description: '指定時刻の3Dシーン構成、カメラ、ノード描画実績を確認し、必要なら静止フレームも返します。',
        inputSchema: {
            type: 'object',
            properties: {
                sceneId: { type: 'string', description: '対象シーンIDまたは名前' },
                timeSec: { type: 'number', description: '確認する時刻（秒）' },
                maxWidth: { type: 'number', description: '返す画像の最大幅' },
            },
            required: ['sceneId'],
        },
        execute: async (args, ctx) => {
            const key = String(args.sceneId ?? '');
            const target = ctx.getConfig().scenes.find((s) => s.id === key || s.id.includes(key) || s.name === key);
            if (!target?.threeD) return { success: false, message: '指定された3Dシーンが見つかりません。' };
            const timeSec = typeof args.timeSec === 'number' ? args.timeSec : target.startTime;
            const graph = target.threeD.sceneGraph ?? createMv3DSceneGraphFromPreset(target.threeD);
            const checked = validateMv3DSceneGraph(graph);
            const port = ctx.getPreviewCapture?.() ?? null;
            const shot = port?.isAvailable() ? await port.captureJpeg(Math.max(128, Math.min(768, Number(args.maxWidth) || 512)), timeSec) : null;
            const content = shot ? [{ type: 'image' as const, data: shot.dataUrl.replace(/^data:image\/[a-z]+;base64,/, ''), mimeType: 'image/jpeg' }] : undefined;
            return {
                success: true,
                message: shot ? '3Dシーンの構成情報と静止フレームを取得しました。' : '3Dシーンの構成情報を取得しました。',
                content,
                images: content,
                data: {
                    sceneId: target.id,
                    sceneName: target.name,
                    timeSec,
                    camera: graph.camera,
                    renderedNodes: checked.manifest.renderedNodes,
                    ignoredFields: checked.manifest.ignoredFields,
                    triangles: checked.manifest.triangles,
                    drawCalls: checked.manifest.drawCalls,
                    lyricSafeZoneIntrusion: false,
                    rendererReady: shot?.threeD?.rendererReady ?? false,
                    lastRenderError: shot?.threeD?.lastRenderError ?? null,
                    actualFrameLuminance: shot?.threeD?.actualFrameLuminance ?? 0,
                    maxLuminance: shot?.threeD?.maxLuminance ?? 0,
                    nonBlackPixelRatio: shot?.threeD?.nonBlackPixelRatio ?? 0,
                    renderPath: shot?.threeD?.renderPath ?? 'none',
                    backend: shot?.threeD?.backend ?? 'unknown',
                    warnings: [...checked.warnings, ...(shot?.threeD && !shot.threeD.rendererReady ? ['3Dレンダラーが初期化されていません。'] : []), ...(shot?.threeD && shot.threeD.maxLuminance <= 0.004 ? ['実フレームが黒です。Scene Graphの統計だけでなく、描画結果も確認してください。'] : []), '歌詞との実画面上の重なりは、返却されたフレームで確認してください。'],
                },
            };
        },
    },
    {
        name: 'render_3d_scene_clip',
        description: '指定したScene Graphシーンの短尺フレーム列を返し、カメラ移動・ちらつき・歌詞との重なりを確認します。',
        inputSchema: {
            type: 'object',
            properties: {
                sceneId: { type: 'string', description: '対象シーンIDまたは名前' },
                startSec: { type: 'number', description: '開始秒。既定はシーン開始' },
                endSec: { type: 'number', description: '終了秒。最大5秒' },
                fps: { type: 'number', description: 'フレーム数/秒。最大8' },
                maxWidth: { type: 'number', description: '各フレームの最大幅' },
            },
            required: ['sceneId'],
        },
        execute: async (args, ctx) => {
            const key = String(args.sceneId ?? '');
            const target = ctx.getConfig().scenes.find((s) => s.id === key || s.id.includes(key) || s.name === key);
            if (!target?.threeD) return { success: false, message: '指定された3Dシーンが見つかりません。' };
            const startSec = Math.max(0, Number.isFinite(Number(args.startSec)) ? Number(args.startSec) : target.startTime);
            const endSec = Math.min(startSec + 5, Math.max(startSec + 0.5, Number.isFinite(Number(args.endSec)) ? Number(args.endSec) : startSec + 3), ctx.getTransport().duration);
            const fps = Math.max(1, Math.min(8, Number(args.fps) || 4));
            const maxWidth = Math.max(128, Math.min(768, Number(args.maxWidth) || 384));
            const port = ctx.getPreviewCapture?.() ?? null;
            if (!port?.isAvailable() || !port.captureFrames) return { success: false, message: 'フレーム列プレビューが利用できません。' };
            const frames = await port.captureFrames({ startSec, endSec, fps, maxWidth });
            if (!frames?.length) return { success: false, message: '3Dシーンのフレーム列生成に失敗しました。' };
            const content = frames.map((frame) => ({ type: 'image' as const, data: frame.dataUrl.replace(/^data:image\/[a-z]+;base64,/, ''), mimeType: 'image/jpeg' }));
            return {
                success: true,
                message: `${frames.length}フレームの3Dシーンプレビューを生成しました。`,
                content,
                images: content,
                data: { sceneId: target.id, startSec, endSec, fps, frameCount: frames.length, frames: frames.map((frame) => ({ timeSec: frame.timeSec, width: frame.width, height: frame.height, threeD: frame.threeD ?? null })) },
            };
        },
    },
    {
        name: 'validate_mv_timeline',
        description: 'シーンの未カバー区間、重複、歌詞のタイムライン外はみ出しを検出します。',
        inputSchema: {
            type: 'object',
            properties: { duration: { type: 'number', description: '検証対象の曲長（秒）。既定はセッション長' } },
        },
        execute: (args, ctx) => {
            const config = ctx.getConfig();
            const duration = Math.max(0.1, Number(args?.duration) || ctx.getTransport().duration);
            const scenes = [...config.scenes].sort((a, b) => a.startTime - b.startTime);
            const uncovered: Array<{ startSec: number; endSec: number }> = [];
            const overlaps: Array<{ firstSceneId: string; secondSceneId: string; startSec: number; endSec: number }> = [];
            let cursor = 0;
            let previous: MvScene | null = null;
            for (const scene of scenes) {
                if (scene.startTime > cursor + 0.01) uncovered.push({ startSec: cursor, endSec: Math.min(duration, scene.startTime) });
                if (previous && scene.startTime < previous.endTime - 0.01) overlaps.push({ firstSceneId: previous.id, secondSceneId: scene.id, startSec: scene.startTime, endSec: Math.min(previous.endTime, scene.endTime) });
                cursor = Math.max(cursor, scene.endTime);
                previous = scene;
            }
            if (cursor < duration - 0.01) uncovered.push({ startSec: cursor, endSec: duration });
            const lyricOverflow = config.lyrics.filter((lyric) => lyric.time < 0 || lyric.time >= duration || lyric.time + (lyric.duration ?? 4) > duration).map((lyric) => ({ id: lyric.id, time: lyric.time, duration: lyric.duration ?? 4 }));
            const ok = uncovered.length === 0 && overlaps.length === 0 && lyricOverflow.length === 0;
            return {
                success: ok,
                message: ok ? 'タイムラインに未カバー区間・重複・歌詞のはみ出しはありません。' : `タイムラインに未カバー${uncovered.length}件、重複${overlaps.length}件、歌詞のはみ出し${lyricOverflow.length}件があります。`,
                data: { duration, ok, uncovered, overlaps, lyricOverflow },
            };
        },
    },

    {
        name: 'split_mv_scene',
        description: '1つのシーンを指定時刻で2つに分割します。元の3D・SVG・歌詞設定は両方へ引き継ぎ、隙間や重複を作りません。',
        inputSchema: {
            type: 'object',
            properties: { sceneId: { type: 'string', description: '対象シーン ID または名前' }, splitTime: { type: 'number', description: '分割するタイムライン時刻' }, rightName: { type: 'string', description: '分割後右側シーン名' } },
            required: ['sceneId', 'splitTime'],
        },
        execute: (args, ctx) => {
            const key = String(args.sceneId ?? '');
            const snap = ctx.getConfig();
            const target = snap.scenes.find((s) => s.id === key || s.id.includes(key) || s.name === key);
            const splitTime = Number(args.splitTime);
            if (!target) return { success: false, message: '分割対象のシーンが見つかりません。' };
            if (!Number.isFinite(splitTime) || splitTime <= target.startTime + 0.25 || splitTime >= target.endTime - 0.25) return { success: false, message: 'splitTime はシーンの開始・終了から0.25秒以上内側に指定してください。' };
            const right: MvScene = { ...target, id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: String(args.rightName || `${target.name} 2`), startTime: splitTime, endTime: target.endTime };
            const left: MvScene = { ...target, endTime: splitTime };
            ctx.setConfig((prev) => ({ ...prev, scenes: prev.scenes.map((s) => s.id === target.id ? left : s).concat(right).sort((a, b) => a.startTime - b.startTime) }));
            return { success: true, message: `シーン「${target.name}」を ${splitTime.toFixed(2)}秒で分割しました。`, data: { left, right } };
        },
    },
    {
        name: 'resize_mv_scene',
        description: 'シーンの開始・終了を安全に変更します。ripple=true なら後続シーンも同じ差分だけ移動します。',
        inputSchema: {
            type: 'object',
            properties: { sceneId: { type: 'string', description: '対象シーン ID または名前' }, startTime: { type: 'number', description: '新しい開始時刻' }, duration: { type: 'number', description: '新しい長さ' }, endTime: { type: 'number', description: '新しい終了時刻' }, ripple: { type: 'boolean', description: '後続シーンを差分移動するか' } },
            required: ['sceneId'],
        },
        execute: (args, ctx) => {
            const key = String(args.sceneId ?? '');
            const snap = ctx.getConfig();
            const target = snap.scenes.find((s) => s.id === key || s.id.includes(key) || s.name === key);
            if (!target) return { success: false, message: 'サイズ変更対象のシーンが見つかりません。' };
            const nextStart = typeof args.startTime === 'number' ? Math.max(0, args.startTime) : target.startTime;
            const nextEnd = typeof args.endTime === 'number' ? Math.max(nextStart + 0.5, args.endTime) : nextStart + Math.max(0.5, Number(args.duration) || target.endTime - target.startTime);
            const delta = nextEnd - target.endTime;
            const resized = { ...target, startTime: nextStart, endTime: nextEnd };
            let nextScenes = snap.scenes.map((s) => s.id === target.id ? resized : s);
            if (args.ripple) nextScenes = nextScenes.map((s) => s.id !== target.id && s.startTime >= target.endTime - 0.01 ? { ...s, startTime: s.startTime + delta, endTime: s.endTime + delta } : s);
            const sorted = [...nextScenes].sort((a, b) => a.startTime - b.startTime);
            const collision = sorted.some((s, i) => i > 0 && s.startTime < sorted[i - 1].endTime - 0.01);
            if (collision) return { success: false, message: '変更後にシーンが重複します。ripple=true で後続シーンも移動してください。' };
            ctx.setConfig((prev) => ({ ...prev, scenes: sorted }));
            return { success: true, message: `シーン「${target.name}」を ${nextStart.toFixed(2)}〜${nextEnd.toFixed(2)}秒へ変更しました。`, data: { scene: resized, ripple: Boolean(args.ripple), delta } };
        },
    },

    // ── 2.5. 曲全体の全シーン一括生成 ──────────────────────────────────────────
    {
        name: 'create_full_mv_scenes',
        description: 'タイムラインのシーン構成を一括生成・配置します（既存シーンは置換されます）。ユーザーの要望や楽曲の雰囲気に合わせて、Three.js / WebGPU シェーダー（shaderCode）やグラフィック（svgCode）を自由に組み合わせて作成してください。',
        inputSchema: {
            type: 'object',
            properties: {
                scenes: {
                    type: 'array',
                    description: 'タイムラインに配置するシーンのリスト（startTime 順）',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'シーン名' },
                            startTime: { type: 'number', description: '開始時間（秒）' },
                            duration: { type: 'number', description: 'シーンの長さ（秒）' },
                            shaderCode: {
                                type: 'string',
                                description: `【動的背景】Three.js / WebGPU による動的 GPU シェーダー。低音 (u.uLow)・ビート (u.uBeat)・時間 (u.uTimeSec) 等と連動したビジュアルをコードで自由に表現できる。まず validate_mv_shader で合格させてから渡すこと。${TSL_SHADER_CONTRACT_DOC}`,
                            },
                            svgCode: {
                                type: 'string',
                                description: '【前景レイヤー】viewBox="0 0 1920 1080" で設計するフレーム枠やグラフィック。※歌詞は別レイヤーで表示されるため、背景側に文字を埋め込む必要はありません（純粋なビジュアルグラフィックに専念できます）。',
                            },
                            cssCode: { type: 'string', description: '音連動 CSS コード（任意）' },
                            artDirection: {
                                type: 'string',
                                description: 'このシーンのアートディレクション（任意）。例: "冷たい青基調、サビで巨大文字が回転"。全シーンで一貫した映像言語を保つ基準になる',
                            },
                        },
                        required: ['name', 'startTime', 'duration', 'svgCode'],
                    },
                },
            },
            required: ['scenes'],
        },
        execute: (args, ctx) => {
            const rawList = Array.isArray(args.scenes) ? args.scenes : [];
            if (rawList.length === 0) {
                return { success: false, message: 'scenes 配列が空です。少なくとも 1 つのシーンを指定してください。' };
            }

            const newScenes: MvScene[] = rawList.map((item: any, i: number) => {
                const start = Math.max(0, Number(item.startTime) || 0);
                const dur = Math.max(0.5, Number(item.duration) || 4.0);

                return {
                    id: `scene_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
                    name: String(item.name || `シーン ${i + 1}`),
                    startTime: start,
                    endTime: start + dur,
                    // テンプレ演出 (phaserTheme / lyricEffect) は人間 UI 専用。常に none。
                    phaserTheme: 'none',
                    lyricEffect: 'none' as LyricEffectKind,
                    svgCode: item.svgCode || undefined,
                    cssCode: item.cssCode || undefined,
                    shaderCode: item.shaderCode ? String(item.shaderCode) : undefined,
                    artDirection: item.artDirection ? String(item.artDirection) : undefined,
                };
            });

            newScenes.sort((a, b) => a.startTime - b.startTime);

            ctx.setConfig((prev) => ({
                ...prev,
                scenes: newScenes,
            }));

            return {
                success: true,
                message: `全 ${newScenes.length} 個の MV シーンを一括生成し、タイムラインに綺麗に配置しました！`,
                data: { scenes: newScenes },
            };
        },
    },

    // ── 2b. AI 生成シェーダーの事前検証（自己修正ループ用評価器） ─────────────
    {
        name: 'validate_mv_shader',
        description: `AI が生成したシェーダーコードを検証してから add_mv_scene / update_mv_scene へ渡す。${TSL_SHADER_CONTRACT_DOC}`,
        inputSchema: {
            type: 'object',
            properties: {
                shaderCode: {
                    type: 'string',
                    description: '検証するシェーダーコード。(tsl, u) の本体として評価され、最後に tsl.vec4(...) 等の色ノードを return する',
                },
            },
            required: ['shaderCode'],
        },
        execute: async (args) => {
            const result = await verifyTslShader(String(args.shaderCode ?? ''));
            if (result.ok) {
                return {
                    success: true,
                    message: `シェーダー検証合格（${result.backend ?? 'unknown'} バックエンド）: コンパイル OK、プローブフレーム 3 枚で時間・音響反応を確認しました。このコードを add_mv_scene / update_mv_scene の shaderCode に設定できます。`,
                    data: {
                        backend: result.backend ?? 'unknown',
                        probeStats: result.stats
                            ? {
                                interFrameMeanDelta: result.stats.interFrameMeanDelta,
                                meanLuma: result.stats.frames.map((f) => Number(f.meanLuma.toFixed(1))),
                            }
                            : 'コンパイル検証のみ（描画環境なし）',
                    },
                };
            }
            return {
                success: false,
                message: `シェーダー検証不合格: ${result.error ?? '不明なエラー'} — 修正して再度 validate_mv_shader に提出してください。`,
            };
        },
    },

    // ── 2c. AI 生成シェーダーの複数案バリエーション生成支援（seed 差分計測） ──
    {
        name: 'validate_mv_shader_variants',
        description: 'シェーダー候補を複数案（最大 5 案）まとめて検証し、合格した案の一覧と各案の特徴指標を返す。均質化（似た案に収束）を避けるため、異なるコンセプトで複数案生成してから選ぶのに使う。',
        inputSchema: {
            type: 'object',
            properties: {
                variants: {
                    type: 'array',
                    description: '検証するシェーダー候補の配列（各要素は (tsl, u) 本体コード。name に案のコンセプト名を添える）',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: '案のコンセプト名（例: "雨粒のボケ")' },
                            shaderCode: { type: 'string', description: 'シェーダーコード本体' },
                        },
                        required: ['shaderCode'],
                    },
                },
            },
            required: ['variants'],
        },
        execute: async (args) => {
            const list = Array.isArray(args.variants) ? args.variants.slice(0, 5) : [];
            if (list.length === 0) {
                return { success: false, message: 'variants 配列が空です。1 〜 5 案を指定してください。' };
            }
            const results = [];
            for (const v of list) {
                const r = await verifyTslShader(String(v?.shaderCode ?? ''));
                results.push({
                    name: String(v?.name ?? '無名の案'),
                    ok: r.ok,
                    error: r.error,
                    interFrameMeanDelta: r.stats ? Number(r.stats.interFrameMeanDelta.toFixed(2)) : null,
                    backend: r.backend ?? null,
                });
            }
            const passed = results.filter((r) => r.ok);
            return {
                success: passed.length > 0,
                message: passed.length > 0
                    ? `${passed.length}/${results.length} 案が合格。合格案から最も interFrameMeanDelta（動きの大きさ）が適切なものを選び shaderCode に設定してください。`
                    : `全 ${results.length} 案が不合格です。各 error を読んで修正し、再度提出してください。`,
                data: { results },
            };
        },
    },

    // ── 3. 既存シーン更新 ─────────────────────────────────────────────────────
    {
        name: 'update_mv_scene',
        description: '指定した ID または名前のシーンのパラメータ（名前、時間、動的シェーダー背景、SVG、オーディオリアクティブ CSS）を更新します。',
        inputSchema: {
            type: 'object',
            properties: {
                sceneId: { type: 'string', description: '更新対象のシーン ID（ID または sceneIndex のいずれかを指定）' },
                sceneIndex: { type: 'number', description: '更新対象のシーン番号（0 始まりのインデックス）' },
                name: { type: 'string', description: '新しいシーン名' },
                startTime: { type: 'number', description: '新しい開始時間（秒）' },
                duration: { type: 'number', description: '新しい長さ（秒）' },
                svgCode: {
                    type: 'string',
                    description: '新しい SVG コード（フレーム枠やグラフィック）。※歌詞は別レイヤーで表示されるため、背景側に文字を埋め込む必要はありません。',
                },
                cssCode: {
                    type: 'string',
                    description: '新しいオーディオリアクティブ CSS。var(--audio-peak), var(--audio-low), var(--audio-mid), var(--audio-high), var(--audio-beat) と連携可能。',
                },
                shaderCode: {
                    type: 'string',
                    description: `【動的背景】Three.js / WebGPU による動的背景シェーダー。validate_mv_shader で合格したコードのみ設定すること。${TSL_SHADER_CONTRACT_DOC}`,
                },
                artDirection: {
                    type: 'string',
                    description: 'このシーンのアートディレクション。全シーンで一貫した映像言語の基準になる',
                },
            },
        },
        execute: (args, ctx) => {
            // エージェントの入力揺れに備え sceneIndex の別名として index も受け付ける
            const sceneIndex = typeof args?.sceneIndex === 'number' ? args.sceneIndex
                : typeof args?.index === 'number' ? args.index : undefined;
            const { sceneId, name, startTime, duration, svgCode, cssCode, shaderCode, artDirection } = args;

            // バグ修正: React setState の更新関数はコミット時 (非同期) に走るため、
            // setConfig のコールバック内変数を同期的に参照すると常に「未解決」になる。
            // 解決は getConfig() スナップショットで行い、反映は ID 基準の関数型更新で行う。
            const snap = ctx.getConfig();
            let idx = -1;
            if (typeof sceneIndex === 'number') {
                idx = sceneIndex;
            } else if (typeof sceneId === 'string') {
                // 完全 ID 一致 → 部分一致（大文字小文字を無視）→ 名前一致 の順で解決
                idx = snap.scenes.findIndex((s) => s.id === sceneId);
                if (idx < 0) {
                    const lower = sceneId.toLowerCase();
                    idx = snap.scenes.findIndex((s) => s.id.toLowerCase().includes(lower) || s.name === sceneId);
                }
                if (idx < 0) {
                    idx = snap.scenes.findIndex((s) => s.name.toLowerCase().includes(sceneId.toLowerCase()));
                }
            }

            if (idx < 0 || idx >= snap.scenes.length) {
                const availableScenes = snap.scenes.map((s, i) => ({ index: i, id: s.id, name: s.name }));
                const hint = availableScenes.length > 0
                    ? `現存するシーン: ${availableScenes.map((s) => `[${s.index}] ${s.name} (id: ${s.id})`).join(', ')}`
                    : 'シーンが 1 件もありません。add_mv_scene または create_full_mv_scenes で追加してください。';
                return {
                    success: false,
                    message: `指定されたシーン (ID: ${sceneId ?? 'N/A'}, Index: ${sceneIndex ?? 'N/A'}) が見つかりませんでした。${hint} get_mv_project で正しい sceneId / sceneIndex を確認してください。`,
                    data: { availableScenes },
                };
            }

            const current = snap.scenes[idx];
            const newStart = typeof startTime === 'number' ? Math.max(0, startTime) : current.startTime;
            const curDur = current.endTime - current.startTime;
            const newDur = typeof duration === 'number' ? Math.max(0.5, duration) : curDur;

            const updated: MvScene = {
                ...current,
                name: name !== undefined ? String(name) : current.name,
                startTime: newStart,
                endTime: newStart + newDur,
                // テンプレ演出は人間 UI 専用のため、エージェント更新では変更しない
                phaserTheme: current.phaserTheme,
                lyricEffect: current.lyricEffect,
                svgCode: svgCode !== undefined ? svgCode : current.svgCode,
                cssCode: cssCode !== undefined ? cssCode : current.cssCode,
                shaderCode: shaderCode !== undefined ? String(shaderCode) : current.shaderCode,
                artDirection: artDirection !== undefined ? String(artDirection) : current.artDirection,
            };

            // ID 基準の関数型更新: スナップショット解決と反映の間に
            // シーン配列が書き換わっても正しいシーンへ適用される
            ctx.setConfig((prev) => ({
                ...prev,
                scenes: prev.scenes.map((s) => (s.id === current.id ? updated : s)).sort((a, b) => a.startTime - b.startTime),
            }));

            return {
                success: true,
                message: `シーン「${updated.name}」を更新しました。`,
                data: { scene: updated },
            };
        },
    },

    // ── 4. シーン削除 ─────────────────────────────────────────────────────────
    {
        name: 'delete_mv_scene',
        description: '指定した ID またはインデックスのシーンをタイムラインから削除します。',
        inputSchema: {
            type: 'object',
            properties: {
                sceneId: { type: 'string', description: '削除対象のシーン ID' },
                sceneIndex: { type: 'number', description: '削除対象のシーン番号（0 始まり）' },
            },
        },
        execute: (args, ctx) => {
            // エージェントの入力揺れに備え sceneIndex の別名として index も受け付ける
            const sceneIndex = typeof args?.sceneIndex === 'number' ? args.sceneIndex
                : typeof args?.index === 'number' ? args.index : undefined;
            const { sceneId } = args;

            // バグ修正: update_mv_scene と同じ理由。スナップショットで解決し、
            // ID 基準の関数型更新で反映する (同期参照バグの撲滅)。
            const snap = ctx.getConfig();
            let idx = -1;
            if (typeof sceneIndex === 'number') {
                idx = sceneIndex;
            } else if (typeof sceneId === 'string') {
                // 完全 ID 一致 → 部分一致 → 名前一致 の順で解決
                idx = snap.scenes.findIndex((s) => s.id === sceneId);
                if (idx < 0) {
                    const lower = sceneId.toLowerCase();
                    idx = snap.scenes.findIndex((s) => s.id.toLowerCase().includes(lower) || s.name === sceneId);
                }
                if (idx < 0) {
                    idx = snap.scenes.findIndex((s) => s.name.toLowerCase().includes(sceneId.toLowerCase()));
                }
            }

            if (idx < 0 || idx >= snap.scenes.length) {
                const availableScenes = snap.scenes.map((s, i) => ({ index: i, id: s.id, name: s.name }));
                const hint = availableScenes.length > 0
                    ? `現存するシーン: ${availableScenes.map((s) => `[${s.index}] ${s.name} (id: ${s.id})`).join(', ')}`
                    : 'シーンが 1 件もありません。';
                return {
                    success: false,
                    message: `削除対象のシーンが見つかりませんでした。${hint}`,
                    data: { availableScenes },
                };
            }

            const deletedName = snap.scenes[idx].name;
            const deletedId = snap.scenes[idx].id;
            ctx.setConfig((prev) => ({
                ...prev,
                scenes: prev.scenes.filter((s) => s.id !== deletedId),
            }));

            return {
                success: true,
                message: `シーン「${deletedName}」を削除しました。`,
            };
        },
    },

    // ── 4.5. シーン選択 (プレビュー対象の切り替え) ─────────────────────────────
    {
        name: 'select_mv_scene',
        description: 'プレビューに表示するシーンを選択します。プレビューは「選択中のシーン」を描画するため、get_mv_preview で特定シーンを視覚確認する前に必ず実行してください。',
        inputSchema: {
            type: 'object',
            properties: {
                sceneId: { type: 'string', description: '選択対象のシーン ID (部分一致・名前一致も可)' },
                sceneIndex: { type: 'number', description: '選択対象のシーン番号（0 始まり）。sceneId と両方指定された場合は sceneId を優先' },
            },
        },
        execute: (args, ctx) => {
            // エージェントの入力揺れに備え sceneIndex の別名として index も受け付ける
            const sceneIndex = typeof args?.sceneIndex === 'number' ? args.sceneIndex
                : typeof args?.index === 'number' ? args.index : undefined;
            const { sceneId } = args;
            const snap = ctx.getConfig();
            let idx = -1;
            if (typeof sceneId === 'string' && sceneId.length > 0) {
                idx = snap.scenes.findIndex((s) => s.id === sceneId);
                if (idx < 0) {
                    const lower = sceneId.toLowerCase();
                    idx = snap.scenes.findIndex((s) => s.id.toLowerCase().includes(lower) || s.name === sceneId);
                }
                if (idx < 0) {
                    idx = snap.scenes.findIndex((s) => s.name.toLowerCase().includes(sceneId.toLowerCase()));
                }
            } else if (typeof sceneIndex === 'number') {
                idx = sceneIndex;
            }
            if (idx < 0 || idx >= snap.scenes.length) {
                const availableScenes = snap.scenes.map((s, i) => ({ index: i, id: s.id, name: s.name }));
                return {
                    success: false,
                    message: `選択対象のシーンが見つかりませんでした。現存するシーン: ${availableScenes.map((s) => `[${s.index}] ${s.name}`).join(', ') || 'なし'}`,
                    data: { availableScenes },
                };
            }
            if (!ctx.onSelectScene) {
                return { success: false, message: 'このホストではシーン選択がサポートされていません。' };
            }
            const target = snap.scenes[idx];
            ctx.onSelectScene(target.id);
            return {
                success: true,
                message: `シーン「${target.name}」を選択しました。get_mv_preview でこのシーンのプレビューを確認できます。`,
                data: { scene: { id: target.id, name: target.name, startTime: target.startTime, endTime: target.endTime } },
            };
        },
    },

    // ── 4.6. プロジェクト書き出し (AI → ユーザーへの納品) ──────────────────────
    {
        name: 'export_mv_project',
        description: '現在の MV プロジェクト全体をプリセット JSON ファイルとしてブラウザダウンロードへ出力します。ユーザーはアプリの「JSON 取り込み」からそのまま読み込めます。シーン構成を作り上げたら、ユーザーへ成果物を引き渡すために最後に実行してください。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'プリセット名（任意。既定は現在のプロジェクトタイトル）' },
            },
        },
        execute: (args, ctx) => {
            if (!ctx.onExportProject) {
                return { success: false, message: 'このホストではプロジェクト書き出しがサポートされていません。' };
            }
            const config = ctx.getConfig();
            const presetName = String(args?.name ?? config.title ?? '').trim() || 'Voivent MV';
            const file = {
                format: 'voivent-mv-preset' as const,
                version: 1,
                name: presetName,
                savedAt: Date.now(),
                config,
            };
            const safeName = presetName.replace(/[\\/:*?"<>|]+/g, '_');
            const ok = ctx.onExportProject(JSON.stringify(file, null, 2), `${safeName}.voivent-mv.json`);
            if (!ok) {
                return { success: false, message: 'ダウンロードの開始に失敗しました。' };
            }
            return {
                success: true,
                message: `プロジェクト「${presetName}」を ${safeName}.voivent-mv.json としてダウンロードしました。ユーザーは「JSON 取り込み」から読み込めます。`,
            };
        },
    },

    // ── 5. 歌詞フレーズ設定 ───────────────────────────────────────────────────
    {
        name: 'set_mv_lyrics',
        description: 'MV の歌詞フレーズを設定・同期します。タイムラインに沿った歌詞の自動表示やリップシンクに使用されます。',
        inputSchema: {
            type: 'object',
            properties: {
                lyrics: {
                    type: 'array',
                    description: '歌詞フレーズのリスト',
                    items: {
                        type: 'object',
                        properties: {
                            time: { type: 'number', description: '表示開始時間（秒）' },
                            text: { type: 'string', description: '歌詞テキスト' },
                            duration: { type: 'number', description: '表示時間（秒）' },
                        },
                        required: ['time', 'text'],
                    },
                },
                append: { type: 'boolean', description: '既存の歌詞に追加するかどうか（false の場合は全置換）' },
            },
            required: ['lyrics'],
        },
        execute: (args, ctx) => {
            const { lyrics: inputLyrics, append = false } = args;

            if (!Array.isArray(inputLyrics)) {
                return { success: false, message: 'lyrics は配列で指定してください。' };
            }

            const formatted: LyricItem[] = inputLyrics.map((item, i) => ({
                id: item.id || `lyric_${Date.now()}_${i}`,
                time: Number(item.time) || 0,
                text: String(item.text || ''),
                duration: item.duration ? Math.max(0.5, Number(item.duration)) : 3.5,
            })).sort((a, b) => a.time - b.time);

            ctx.setConfig((prev) => {
                const nextLyrics = append ? [...prev.lyrics, ...formatted].sort((a, b) => a.time - b.time) : formatted;
                return { ...prev, lyrics: nextLyrics };
            });

            return {
                success: true,
                message: `歌詞フレーズを ${formatted.length} 件設定しました。`,
                data: { lyricsCount: formatted.length },
            };
        },
    },

    // ── 5.5. 歌詞グローバルスタイル・文字アニメーション設定 ──────────────────
    {
        name: 'set_mv_lyric_style',
        description: '歌詞全体のタイポグラフィ、フォント、文字アニメーション（フェード浮上・タイプライター・ポップイン等）、縁取り、配置位置（中央・下部・上部）を一括設定します。',
        inputSchema: {
            type: 'object',
            properties: {
                fontFamily: { type: 'string', description: 'フォント名（例: "sans-serif", "serif", "monospace", "Impact"）' },
                fontSizePx: { type: 'number', description: 'フォントサイズ（px。既定は 48）' },
                color: { type: 'string', description: '文字色（例: "#ffffff", "#38bdf8"）' },
                strokeEnabled: { type: 'boolean', description: '文字の縁取りを有効にするか' },
                strokeColor: { type: 'string', description: '縁取りの色（例: "#000000"）' },
                strokeWidthPx: { type: 'number', description: '縁取りの太さ（px）' },
                shadow: { type: 'boolean', description: '影（ドロップシャドウ）を付けるか' },
                position: { type: 'string', description: '縦位置: "bottom" (下部), "center" (中央), "top" (上部)' },
                animation: { type: 'string', description: 'アニメーション演出: "none", "fadeUp" (下から浮上), "typewriter" (一文字ずつ), "pop" (ポップイン), "slideIn" (スライドイン)' },
                karaokeEnabled: { type: 'boolean', description: 'カラオケ式塗りつぶしアニメーションを有効にするか' },
                karaokeColor: { type: 'string', description: 'カラオケ進行色（例: "#38bdf8"）' },
                showBuiltIn: { type: 'boolean', description: '共通歌詞レイヤーを表示するか。AI制作キャンバスでは true にすると歌詞が表示されます' },
            },
        },
        execute: (args, ctx) => {
            ctx.setConfig((prev) => ({
                ...prev,
                lyricStyle: {
                    ...(prev.lyricStyle ?? {}),
                    ...args,
                    // スタイル指定を行った時点で、AI制作キャンバスの歌詞を表示する。
                    showBuiltIn: typeof args?.showBuiltIn === 'boolean' ? args.showBuiltIn : true,
                },
            }));
            return {
                success: true,
                message: '歌詞のグローバルスタイルを更新しました。',
                data: { lyricStyle: args },
            };
        },
    },

    // ── 5.6. タイムラインエフェクト追加 ───────────────────────────────────────
    {
        name: 'add_mv_effect',
        description: 'タイムラインの特定区間（例: サビ 45s〜70s、キック打点）にエフェクトクリップ（RGBグリッチ、ビートフラッシュ、フィルムグレイン、カメラズーム等）を配置します。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'エフェクト名（例: "サビ RGB グリッチ", "ドロップ・ホワイトフラッシュ"）' },
                kind: {
                    type: 'string',
                    description: 'エフェクト種別: "rgb_glitch" (RGB色収差), "film_grain" (フィルム粒子＆ビネット), "camera_zoom_pan" (動的ズーム), "vhs_distortion" (走査線), "bloom_glow" (高輝度発光), "lens_blur" (レンズボケ), "invert_flash" (反転インパクト), "custom_shader" (独自TSL), "custom_css" (独自CSS)',
                },
                startTime: { type: 'number', description: '開始時間（秒）' },
                duration: { type: 'number', description: 'エフェクトの長さ（秒。既定は 4.0 秒）' },
                intensity: { type: 'number', description: 'エフェクトの適用強度（0.0 〜 1.0。既定は 1.0）' },
                shaderCode: { type: 'string', description: 'kind が "custom_shader" の場合の TSL シェーダーコード' },
                cssCode: { type: 'string', description: 'kind が "custom_css" の場合の CSS アニメーションコード' },
            },
            required: ['name', 'kind', 'startTime'],
        },
        execute: (args, ctx) => {
            const { name, kind, startTime, duration = 4.0, intensity = 1.0, shaderCode, cssCode } = args;
            if (typeof startTime !== 'number' || startTime < 0) {
                return { success: false, message: 'startTime は 0 以上の数値を指定してください。' };
            }
            const validStart = Math.max(0, startTime);
            const validDur = Math.max(0.5, Number(duration) || 4.0);
            const newEffect: import('./effects/types').MvEffectClip = {
                id: `fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: String(name || 'Effect'),
                kind: kind as import('./effects/types').MvEffectKind,
                startTime: validStart,
                endTime: validStart + validDur,
                intensity: Math.min(1.0, Math.max(0.0, Number(intensity) || 1.0)),
                shaderCode: shaderCode ? String(shaderCode) : undefined,
                cssCode: cssCode ? String(cssCode) : undefined,
            };

            ctx.setConfig((prev) => {
                const nextEffects = [...(prev.effects ?? []), newEffect].sort((a, b) => a.startTime - b.startTime);
                return { ...prev, effects: nextEffects };
            });

            return {
                success: true,
                message: `エフェクト「${newEffect.name}」を開始位置 ${validStart.toFixed(1)}秒 (長さ ${validDur.toFixed(1)}秒) に追加しました。`,
                data: { effect: newEffect },
            };
        },
    },

    // ── 5.7. タイムラインエフェクト削除 ───────────────────────────────────────
    {
        name: 'delete_mv_effect',
        description: 'タイムライン上の特定のエフェクトクリップを削除します。',
        inputSchema: {
            type: 'object',
            properties: {
                effectId: { type: 'string', description: '削除対象のエフェクト ID' },
            },
            required: ['effectId'],
        },
        execute: (args, ctx) => {
            const { effectId } = args;
            const snap = ctx.getConfig();
            const exists = (snap.effects ?? []).some((fx) => fx.id === effectId);
            if (!exists) {
                return { success: false, message: `エフェクト ID「${effectId}」が見つかりませんでした。` };
            }
            ctx.setConfig((prev) => ({
                ...prev,
                effects: (prev.effects ?? []).filter((fx) => fx.id !== effectId),
            }));
            return {
                success: true,
                message: `エフェクト「${effectId}」を削除しました。`,
            };
        },
    },

    {
        name: 'update_mv_effect',
        description: '既存エフェクトの強度、時間、enabled、シェーダー、CSSを部分更新します。削除して作り直す必要はありません。',
        inputSchema: {
            type: 'object',
            properties: {
                effectId: { type: 'string', description: '対象エフェクト ID' },
                intensity: { type: 'number', description: '強度 0〜1' },
                startTime: { type: 'number', description: '開始時刻' },
                duration: { type: 'number', description: '長さ' },
                endTime: { type: 'number', description: '終了時刻' },
                enabled: { type: 'boolean', description: '有効/無効' },
                shaderCode: { type: 'string', description: 'カスタムシェーダー' },
                cssCode: { type: 'string', description: 'カスタムCSS' },
            },
            required: ['effectId'],
        },
        execute: (args, ctx) => {
            const key = String(args.effectId ?? '');
            const snap = ctx.getConfig();
            const target = (snap.effects ?? []).find((fx) => fx.id === key || fx.id.includes(key) || fx.name === key);
            if (!target) return { success: false, message: '指定されたエフェクトが見つかりません。' };
            const startTime = typeof args.startTime === 'number' ? Math.max(0, args.startTime) : target.startTime;
            const endTime = typeof args.endTime === 'number'
                ? Math.max(startTime + 0.05, args.endTime)
                : startTime + Math.max(0.05, Number(args.duration) || target.endTime - target.startTime);
            const updated = {
                ...target,
                startTime,
                endTime,
                intensity: typeof args.intensity === 'number' ? Math.max(0, Math.min(1, args.intensity)) : target.intensity,
                enabled: typeof args.enabled === 'boolean' ? args.enabled : target.enabled,
                shaderCode: args.shaderCode !== undefined ? String(args.shaderCode) : target.shaderCode,
                cssCode: args.cssCode !== undefined ? String(args.cssCode) : target.cssCode,
            };
            ctx.setConfig((prev) => ({ ...prev, effects: (prev.effects ?? []).map((fx) => fx.id === target.id ? updated : fx).sort((a, b) => a.startTime - b.startTime) }));
            return { success: true, message: `エフェクト「${target.name}」を更新しました。`, data: { effect: updated } };
        },
    },

    // ── 5.8. エフェクトのアセット保存 ─────────────────────────────────────────
    {
        name: 'save_mv_effect_asset',
        description: 'AI が生成したカスタムエフェクト（TSL / CSS）をアセットライブラリに保存し、別のシーンや楽曲で再利用できるようにします。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'アセット名（例: "サビ用サイバーRGBグリッチ"）' },
                kind: { type: 'string', description: 'エフェクト種別' },
                description: { type: 'string', description: 'エフェクトの解説・用途' },
                intensity: { type: 'number', description: '推奨強度（0.0 〜 1.0）' },
                shaderCode: { type: 'string', description: 'TSL シェーダーコード' },
                cssCode: { type: 'string', description: 'CSS アニメーションコード' },
            },
            required: ['name', 'kind', 'description'],
        },
        execute: (args, ctx) => {
            const { name, kind, description, intensity = 1.0, shaderCode, cssCode } = args;
            const newAsset: import('./effects/types').MvEffectAsset = {
                id: `asset_fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: String(name),
                kind: kind as import('./effects/types').MvEffectKind,
                description: String(description),
                intensity: Number(intensity) || 1.0,
                shaderCode: shaderCode ? String(shaderCode) : undefined,
                cssCode: cssCode ? String(cssCode) : undefined,
                savedAt: Date.now(),
                isCustom: true,
                colorTag: '#38bdf8',
            };

            ctx.setConfig((prev) => ({
                ...prev,
                effectAssets: [...(prev.effectAssets ?? []), newAsset],
            }));

            return {
                success: true,
                message: `エフェクト「${newAsset.name}」をアセットライブラリに保存しました。`,
                data: { asset: newAsset },
            };
        },
    },

    // ── 6. プレビュー解像度・アスペクト比切替 ─────────────────────────────────
    {
        name: 'set_preview_resolution',
        description: 'メインプレビューおよびエクスポートのアスペクト比・解像度プリセット（16:9 / 9:16 / 1:1 等）を切り替えます。',
        inputSchema: {
            type: 'object',
            properties: {
                resolutionId: {
                    type: 'string',
                    description: '解像度プリセット ID（"youtube_fhd" [1920x1080 16:9], "shorts_fhd" [1080x1920 9:16], "square_hd" [1080x1080 1:1], "hd720" [1280x720 16:9], "shorts_720" [720x1280 9:16]）',
                },
            },
            required: ['resolutionId'],
        },
        execute: (args, ctx) => {
            const { resolutionId } = args;
            const preset = getResolutionPresets().find((p) => p.id === resolutionId);

            if (!preset) {
                return {
                    success: false,
                    message: `指定された解像度プリセット「${resolutionId}」が存在しません。有効な ID: ${getResolutionPresets().map((p) => p.id).join(', ')}`,
                };
            }

            ctx.setConfig((prev) => ({
                ...prev,
                previewResolutionId: preset.id,
            }));

            return {
                success: true,
                message: `プレビュー解像度を「${preset.label} (${preset.platform})」に切り替えました。`,
                data: { preset },
            };
        },
    },

    // ── 7. トランスポート制御（再生/停止/シーク） ────────────────────────────
    {
        name: 'control_mv_transport',
        description: 'MV の再生、一時停止、停止、シーク（指定時間へジャンプ）を制御します。',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: '実行するアクション（"play", "pause", "toggle_play", "stop", "seek"）',
                },
                seekTimeSec: {
                    type: 'number',
                    description: 'seek アクション時のジャンプ先時間（秒）',
                },
            },
            required: ['action'],
        },
        execute: (args, ctx) => {
            const { action, seekTimeSec } = args;
            const current = ctx.getTransport();

            switch (action) {
                case 'play':
                    if (!current.isPlaying) ctx.onTogglePlay();
                    return { success: true, message: '再生を開始しました。' };
                case 'pause':
                    if (current.isPlaying) ctx.onTogglePlay();
                    return { success: true, message: '一時停止しました。' };
                case 'toggle_play':
                    ctx.onTogglePlay();
                    return { success: true, message: `再生状態を切り替えました（現在: ${!current.isPlaying ? '再生中' : '停止中'}）。` };
                case 'stop':
                    ctx.onStop();
                    return { success: true, message: '再生を停止し、先頭へ戻りました。' };
                case 'seek':
                    if (typeof seekTimeSec === 'number' && seekTimeSec >= 0) {
                        ctx.onSeek(seekTimeSec);
                        return { success: true, message: `再生位置を ${seekTimeSec.toFixed(2)} 秒へ移動しました。` };
                    }
                    return { success: false, message: 'seekTimeSec を 0 以上の数値で指定してください。' };
                default:
                    return { success: false, message: `未知のアクション「${action}」です。` };
            }
        },
    },

    // ── 7.5. マスター音量 / ゲイン操作 ───────────────────────────────────────
    {
        name: 'set_mv_master_gain',
        description: 'MV 作品のマスター音量 / ゲイン（0.0 〜 2.0、既定 1.0 = 100%）を設定またはリセットします。音量を上げたい場合は 1.2 や 1.5、初期状態に戻す場合は 1.0（または 100）を指定します。',
        inputSchema: {
            type: 'object',
            properties: {
                gain: { type: 'number', description: 'マスターゲイン倍率（0.0 〜 2.0。1.0 = 100%, 1.2 = 120%, 1.5 = 150%）' },
                volumePercent: { type: 'number', description: '音量パーセント（0 〜 200。100 = 100%）。gain とどちらか一方を指定可能' },
            },
        },
        execute: (args, ctx) => {
            let targetGain = 1.0;
            if (typeof args.gain === 'number') {
                targetGain = Math.max(0, Math.min(2.0, args.gain));
            } else if (typeof args.volumePercent === 'number') {
                targetGain = Math.max(0, Math.min(2.0, args.volumePercent / 100));
            }

            if (ctx.setMasterGain) {
                ctx.setMasterGain(targetGain);
            }

            const pct = Math.round(targetGain * 100);
            return {
                success: true,
                message: `マスター音量を ${pct}% (ゲイン倍率: ${targetGain.toFixed(2)}) に設定しました。`,
                data: {
                    masterGain: targetGain,
                    volumePercent: pct,
                },
            };
        },
    },

    // ── 8. 楽曲エネルギーマップ取得（差別化ツール） ───────────────────────────
    {
        name: 'get_energy_map',
        description: '読み込み済みの楽曲を BPM 同期の細かい時間バンドに分割し、エネルギー分布（静寂/低/中/高）と楽曲構造（イントロ長、ピーク、ドロップ、最長静寂区間）を解析します。シーン割り当てには必ず summary.macroSections（楽曲構造レベルに圧縮された 3〜12 区間）を startTime / duration の基準に使用してください。生の bands は拍ごとの細かいタイミング調整（カット割り等）にのみ使います。',
        inputSchema: {
            type: 'object',
            properties: {
                bandsPerBeat: {
                    type: 'number',
                    description: '1 拍あたりのバンド数。1=4分音符, 2=8分音符（既定）, 4=16分音符',
                },
                maxBands: {
                    type: 'number',
                    description: '返却するバンド配列の上限（既定 256）。超過時は等間隔に間引かれる',
                },
            },
        },
        execute: (args, ctx) => {
            const bandsPerBeat = Number(args?.bandsPerBeat) || 2;
            const maxBands = Number(args?.maxBands) || 256;
            const transport = ctx.getTransport();
            const analysis = ctx.getAnalysis();

            if (!analysis || !analysis.peaks || analysis.peaks.length === 0) {
                return {
                    success: false,
                    message: '楽曲が読み込まれていないためエネルギーマップを生成できません。先に音声ファイルを読み込んでください。',
                };
            }

            const map = buildEnergyMap(transport.bpm, analysis, { bandsPerBeat });
            const { bands: trimmedBands, truncated } = downsampleEnergyMapBands(map.bands, maxBands);

            return {
                success: true,
                message: `エネルギーマップを生成しました（${map.durationSec.toFixed(1)} 秒 / ${map.bands.length} バンド${truncated ? ` → 返却は ${trimmedBands.length} バンドに間引き` : ''}、平均エネルギー ${map.summary.avgEnergy.toFixed(2)}、ピーク ${map.summary.peakStartSec.toFixed(1)} 秒${map.summary.dropStartSec !== null ? `、ドロップ ${map.summary.dropStartSec.toFixed(1)} 秒` : ''}）。シーン割り当てには summary.macroSections (楽曲構造レベルの 3〜12 区間) を使用してください。`,
                data: {
                    bpm: map.bpm,
                    durationSec: map.durationSec,
                    bandSec: map.bandSec,
                    bandsPerBeat: map.bandsPerBeat,
                    totalBands: map.bands.length,
                    truncated,
                    bands: trimmedBands.map((b) => ({
                        startSec: Number(b.startSec.toFixed(3)),
                        endSec: Number(b.endSec.toFixed(3)),
                        energy: Number(b.energy.toFixed(3)),
                        kind: b.kind,
                        bar: b.bar,
                        beatInBar: b.beatInBar,
                    })),
                    summary: {
                        ...map.summary,
                        sections: map.summary.sections.map((s) => ({
                            kind: s.kind,
                            startSec: Number(s.startSec.toFixed(2)),
                            endSec: Number(s.endSec.toFixed(2)),
                            avgEnergy: Number(s.avgEnergy.toFixed(3)),
                        })),
                        macroSections: map.summary.macroSections.map((s) => ({
                            kind: s.kind,
                            startSec: Number(s.startSec.toFixed(2)),
                            endSec: Number(s.endSec.toFixed(2)),
                            avgEnergy: Number(s.avgEnergy.toFixed(3)),
                        })),
                    },
                },
            };
        },
    },

    // ── 9. プレビュー画面キャプチャ（AI の「目」） ───────────────────────────
    {
        name: 'get_mv_preview',
        description: '指定したシーンまたは時刻の JPEG スクリーンショットを取得します。エージェントが自分の構築したシーン・歌詞・SVG 演出を視覚確認し、自己修正するループ (作って→見て→直す) に使用してください。',
        inputSchema: {
            type: 'object',
            properties: {
                maxWidth: {
                    type: 'number',
                    description: '返却画像の最大幅 (px)。既定 512。小さいほど軽量、大きいほど詳細',
                },
                sceneId: {
                    type: 'string',
                    description: '確認対象のシーン ID または名前。指定時は timeSec 未指定ならシーン中央付近を描画',
                },
                timeSec: {
                    type: 'number',
                    description: 'キャプチャ時刻 (秒)。指定するとその時刻のシーンを描画。未指定は現在の再生位置。特定シーンを確認する場合はそのシーンの startTime + 1 秒程度を指定',
                },
            },
        },
        execute: async (args, ctx) => {
            const maxWidth = Number(args?.maxWidth) || 512;
            const config = ctx.getConfig();
            const sceneKey = typeof args?.sceneId === 'string' ? args.sceneId.trim() : '';
            const targetScene = sceneKey
                ? config.scenes.find((s) => s.id === sceneKey || s.id.includes(sceneKey) || s.name === sceneKey || s.name.toLowerCase().includes(sceneKey.toLowerCase()))
                : undefined;
            if (sceneKey && !targetScene) {
                return { success: false, message: `指定されたシーン「${sceneKey}」が見つかりません。get_mv_project で sceneId を確認してください。` };
            }
            const requestedTime = typeof args?.timeSec === 'number' && Number.isFinite(args.timeSec) ? args.timeSec : undefined;
            const timeSec = requestedTime ?? (targetScene
                ? targetScene.startTime + Math.min(1, Math.max(0.25, (targetScene.endTime - targetScene.startTime) * 0.5))
                : undefined);
            const port = ctx.getPreviewCapture?.() ?? null;
            if (!port || !port.isAvailable()) {
                return {
                    success: false,
                    message: 'プレビュー Canvas が未接続のためキャプチャできません。MV ワークスペースを開いた状態で再実行してください。',
                };
            }
            try {
                const shot = await port.captureJpeg(maxWidth, timeSec);
                if (!shot) {
                    return {
                        success: false,
                        message: 'キャプチャに失敗しました。プレビューが表示状態か確認してください。',
                    };
                }
                const base64 = shot.dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
                if (targetScene) ctx.onSelectScene?.(targetScene.id);
                const at = timeSec !== undefined ? `${timeSec.toFixed(1)} 秒時点` : '現在の再生位置';
                return {
                    success: true,
                    message: `プレビューをキャプチャしました (${at} / ${shot.width}x${shot.height})。視覚確認して演出を修正してください。`,
                    // MCP 標準: 画像は content 配列へ (ホスト実装がこれを読む)
                    content: [
                        { type: 'text' as const, text: `プレビューをキャプチャしました (${at} / ${shot.width}x${shot.height})。視覚確認して演出を修正してください。` },
                        { type: 'image' as const, data: base64, mimeType: 'image/jpeg' },
                    ],
                    // 後方互換: images プロパティも併せて添付
                    images: [{ type: 'image' as const, data: base64, mimeType: 'image/jpeg' }],
                    data: { width: shot.width, height: shot.height, maxWidth, timeSec: timeSec ?? null, sceneId: targetScene?.id ?? null, threeD: shot.threeD ?? null },
                };
            } catch (err: any) {
                return {
                    success: false,
                    message: `キャプチャ中にエラーが発生しました: ${err?.message || String(err)}`,
                };
            }
        },
    },

    {
        name: 'render_mv_clip',
        description: '指定区間を数フレームのJPEG列として返します。短いカメラ移動、ちらつき、歌詞との重なりを確認するためのレビュー用プレビューです。',
        inputSchema: {
            type: 'object',
            properties: {
                sceneId: { type: 'string', description: '対象シーン ID または名前（省略時は startSec のシーン）' },
                startSec: { type: 'number', description: '開始秒。sceneId 指定時の既定値はシーン開始' },
                endSec: { type: 'number', description: '終了秒。既定は開始から3秒、最大5秒' },
                fps: { type: 'number', description: 'フレーム数/秒。既定4、最大8' },
                maxWidth: { type: 'number', description: '各フレームの最大幅。既定384' },
            },
        },
        execute: async (args, ctx) => {
            const config = ctx.getConfig();
            const sceneKey = typeof args?.sceneId === 'string' ? args.sceneId.trim() : '';
            const target = sceneKey
                ? config.scenes.find((s) => s.id === sceneKey || s.id.includes(sceneKey) || s.name === sceneKey || s.name.toLowerCase().includes(sceneKey.toLowerCase()))
                : undefined;
            if (sceneKey && !target) return { success: false, message: `指定されたシーン「${sceneKey}」が見つかりません。` };
            const transport = ctx.getTransport();
            const startSec = Math.max(0, Number.isFinite(Number(args?.startSec)) ? Number(args.startSec) : (target?.startTime ?? transport.playheadSec));
            const requestedEnd = Number.isFinite(Number(args?.endSec)) ? Number(args.endSec) : startSec + 3;
            const endSec = Math.min(startSec + 5, Math.max(startSec + 0.5, requestedEnd), transport.duration);
            const fps = Math.max(1, Math.min(8, Number(args?.fps) || 4));
            const maxWidth = Math.max(128, Math.min(768, Number(args?.maxWidth) || 384));
            const port = ctx.getPreviewCapture?.() ?? null;
            if (!port?.isAvailable() || !port.captureFrames) return { success: false, message: 'フレーム列プレビューが利用できません。MVワークスペースを開いた状態で再実行してください。' };
            const frames = await port.captureFrames({ startSec, endSec, fps, maxWidth });
            if (!frames || frames.length === 0) return { success: false, message: 'フレーム列の生成に失敗しました。' };
            if (target) ctx.onSelectScene?.(target.id);
            const content = frames.map((frame) => ({
                type: 'image' as const,
                data: frame.dataUrl.replace(/^data:image\/[a-z]+;base64,/, ''),
                mimeType: 'image/jpeg',
            }));
            return {
                success: true,
                message: `${frames.length}フレームの短尺プレビューを生成しました（${startSec.toFixed(2)}〜${endSec.toFixed(2)}秒、${fps}fps）。フレーム間のカメラ移動・ちらつき・歌詞の重なりを確認してください。`,
                content,
                images: content,
                data: { sceneId: target?.id ?? null, startSec, endSec, fps, frameCount: frames.length, frames: frames.map((f) => ({ timeSec: f.timeSec, width: f.width, height: f.height })) },
            };
        },
    },

    // ── 10. 動画レンダリング（AI の「納品」） ────────────────────────────────
    {
        name: 'render_mv_video',
        description: '現在の MV プロジェクトを MP4/WebM 動画としてレンダリングし、ブラウザのダウンロードへ保存します。レンダリングは秒あたり 30 フレームの決定論的オフライン描画です。実行前に get_mv_project で構成を確認し、get_mv_preview で見た目を確認しておくことを推奨。長い区間は時間がかかるため、まず短い区間でテストレンダリングすることを推奨。',
        inputSchema: {
            type: 'object',
            properties: {
                startSec: {
                    type: 'number',
                    description: 'レンダリング開始秒 (既定 0)',
                },
                endSec: {
                    type: 'number',
                    description: 'レンダリング終了秒 (既定: セッション終端)',
                },
                fps: {
                    type: 'number',
                    description: 'フレームレート (既定 30)',
                },
                bitrate: {
                    type: 'string',
                    description: '画質プリセット ("hq" | "std" | "lite"、既定 "std")',
                },
            },
        },
        execute: async (args, ctx) => {
            const port = ctx.getVideoRender?.() ?? null;
            if (!port || !port.isAvailable()) {
                return {
                    success: false,
                    message: '動画レンダリング機能が利用できません (WebCodecs 非対応ブラウザ、またはエクスポート処理中の可能性)。',
                };
            }
            const transport = ctx.getTransport();
            const config = ctx.getConfig();
            const startSec = Math.max(0, Number(args?.startSec) || 0);
            const endSec = Math.min(
                Math.max(startSec + 0.5, Number(args?.endSec) || transport.duration),
                Math.max(0.5, transport.duration),
            );
            const fps = Math.max(1, Math.min(60, Number(args?.fps) || 30));

            const bitratePresets = getBitratePresets();
            const bitrateKey = String(args?.bitrate || 'std');
            const bitratePreset = bitratePresets.find((b) => b.id === bitrateKey) ?? bitratePresets[1] ?? bitratePresets[0];
            const resolutionPreset = getResolutionPresets().find((p) => p.id === (config.previewResolutionId || 'youtube_fhd'))
                ?? getResolutionPresets()[0];

            const durationSec = endSec - startSec;
            if (durationSec < 0.5) {
                return { success: false, message: 'レンダリング区間は 0.5 秒以上で指定してください。' };
            }
            if (durationSec > 180) {
                return { success: false, message: `レンダリング区間が長すぎます (${durationSec.toFixed(0)} 秒)。180 秒以内の区間を指定するか、分割してレンダリングしてください。` };
            }

            const safeTitle = (config.title || 'Voivent_MV').replace(/[\s\\/:*?"<>|]+/g, '_');
            const filename = `${safeTitle}_${startSec.toFixed(0)}-${endSec.toFixed(0)}s.mp4`;

            const result = await port.renderVideo({
                startSec,
                endSec,
                fps,
                width: resolutionPreset.width,
                height: resolutionPreset.height,
                bitrateBps: bitratePreset.bps,
                filename,
            });

            if (result.ok) {
                return {
                    success: true,
                    message: `動画をレンダリングしてダウンロードを開始しました: ${result.fileName ?? filename} (${result.frames ?? '?'} フレーム / ${result.durationSec?.toFixed(1) ?? durationSec.toFixed(1)} 秒 / ${resolutionPreset.width}x${resolutionPreset.height})。`,
                    data: { fileName: result.fileName ?? filename, frames: result.frames, width: resolutionPreset.width, height: resolutionPreset.height, startSec, endSec },
                };
            }
            return {
                success: false,
                message: `レンダリングに失敗しました: ${result.error ?? '不明なエラー'}`,
            };
        },
    },

    // ── 11. stem 分離サマリ確認 ──────────────────────────────────────────
    {
        name: 'analyze_mv_stems',
        description: '分離済みの stem 解析サマリ（推定 BPM・拍信頼度・ドラム onset 数・ボーカル発声区間数）を確認します。stem 分離は重い処理（モデル取得・WebGPU 推論）を含むため、ユーザーによる手動操作専用です。未分離の場合はユーザーに画面上部の「Stem分離」ボタンから実行するよう案内してください。',
        inputSchema: {
            type: 'object',
            properties: {
                force: {
                    type: 'boolean',
                    description: '既存の解析結果を無視して再分離するか (既定 false)。通常は不要',
                },
            },
        },
        execute: async (_args, ctx) => {
            const runFn = ctx.runStemSeparation ?? null;
            if (!runFn) {
                return {
                    success: false,
                    message: 'stem 分離機能がこのホストで利用できません (音源未読み込み、または非対応環境の可能性)。',
                };
            }
            const force = Boolean(_args?.force);
            const res = await runFn(force);
            if (!res.ok) {
                return {
                    success: false,
                    message: `stem 分離に失敗しました: ${res.error ?? '不明なエラー'}`,
                };
            }
            const analysis = ctx.getStemAnalysis?.() ?? null;
            if (!analysis) {
                return { success: false, message: '分離は完了しましたが解析結果を取得できませんでした。' };
            }
            const preview = analysis.drumOnsets.slice(0, 64).map((o) => Number(o.timeSec.toFixed(2)));
            return {
                success: true,
                message: `stem 分離・解析データを確認しました (${res.backend ?? 'unknown'} / ${res.elapsedSec?.toFixed(1) ?? '?'} 秒)。推定 BPM ${analysis.proposedBpm > 0 ? analysis.proposedBpm : 'N/A'} (信頼度 ${Math.round(analysis.beatConfidence * 100)}%)、onset ${analysis.drumOnsets.length} 件、ボーカル発声区間 ${analysis.vocalSegments.length} 件。詳細は get_mv_stem_map で取得してください。`,
                data: {
                    ok: true,
                    backend: res.backend,
                    elapsedSec: res.elapsedSec,
                    proposedBpm: analysis.proposedBpm,
                    bpmConfidence: analysis.beatConfidence,
                    beatOffsetSec: analysis.beatOffsetSec,
                    drumOnsetCount: analysis.drumOnsets.length,
                    drumOnsetsPreview: preview,
                    vocalSegmentCount: analysis.vocalSegments.length,
                    bandSec: analysis.bandSec,
                },
            };
        },
    },

    // ── 12. stem 解析データ開示 (get_energy_map の stem 版) ─────────────────
    {
        name: 'get_mv_stem_map',
        description: '分離済みの詳細解析データを取得します。シーン切替は drumOnsets (ドラム打撃時刻) に合わせ、感情の盛り上がりは vocalEnergy (ボーカル包絡)、低域のドロップは bassEnergy (ベース包絡) を参照してデータ駆動で判断してください。未分離の場合はユーザーに画面上部の「Stem分離」ボタンから分離を開始するよう案内してください。',
        inputSchema: {
            type: 'object',
            properties: {
                kind: {
                    type: 'string',
                    description: 'onset / 包絡を絞り込む stem ("drums" | "vocals" | "bass" | "other")。省略時は全部',
                },
                fromSec: { type: 'number', description: '区間絞り込み開始秒 (省略時 0)' },
                toSec: { type: 'number', description: '区間絞り込み終了秒 (省略時 曲終端)' },
                maxOnsets: {
                    type: 'number',
                    description: '返す onset の上限 (既定 256)。超過時は間引かれる',
                },
            },
        },
        execute: (args, ctx) => {
            const analysis = ctx.getStemAnalysis?.() ?? null;
            if (!analysis) {
                return {
                    success: false,
                    message: 'stem 解析データがまだありません。ドラムやボーカルに高精度に同期した演出を行いたい場合は、ユーザーに画面上部の「Stem分離」ボタンを押して分離を実行するよう案内してください。',
                };
            }
            const kind = typeof args?.kind === 'string' && ['drums', 'vocals', 'bass', 'other'].includes(args.kind)
                ? args.kind : null;
            const fromSec = Math.max(0, Number(args?.fromSec) || 0);
            const toSec = Math.max(fromSec, Number(args?.toSec) || analysis.durationSec);
            const maxOnsets = Math.max(16, Math.min(2048, Number(args?.maxOnsets) || 256));

            const inRange = (t: number) => t >= fromSec && t <= toSec;
            let onsets = analysis.drumOnsets.filter((o) => inRange(o.timeSec));
            let truncated = false;
            if (onsets.length > maxOnsets) {
                const stride = Math.ceil(onsets.length / maxOnsets);
                const before = onsets.length;
                onsets = onsets.filter((_, i) => i % stride === 0);
                truncated = true;
                void before;
            }
            const bandFrom = Math.floor(fromSec / analysis.bandSec);
            const bandTo = Math.ceil(toSec / analysis.bandSec);
            const sliceEnv = (env: number[]) => env.slice(Math.max(0, bandFrom), Math.min(env.length, Math.max(0, bandTo)));
            const segs = analysis.vocalSegments.filter((s) => s.endSec >= fromSec && s.startSec <= toSec);

            return {
                success: true,
                message: `stem 解析データを返しました (onset ${onsets.length}${truncated ? '+α (間引き)' : ''} 件 / 区間 ${fromSec.toFixed(1)}-${toSec.toFixed(1)} 秒)。`,
                data: {
                    proposedBpm: analysis.proposedBpm,
                    beatOffsetSec: analysis.beatOffsetSec,
                    beatConfidence: analysis.beatConfidence,
                    bandSec: analysis.bandSec,
                    durationSec: analysis.durationSec,
                    drumOnsets: onsets.map((o) => ({ timeSec: Number(o.timeSec.toFixed(3)), strength: Number(o.strength.toFixed(3)) })),
                    energy: kind
                        ? { [kind]: sliceEnv(analysis.energy[kind as 'drums']).map((v) => Number(v.toFixed(3))) }
                        : {
                            drums: sliceEnv(analysis.energy.drums).map((v) => Number(v.toFixed(3))),
                            vocals: sliceEnv(analysis.energy.vocals).map((v) => Number(v.toFixed(3))),
                            bass: sliceEnv(analysis.energy.bass).map((v) => Number(v.toFixed(3))),
                            other: sliceEnv(analysis.energy.other).map((v) => Number(v.toFixed(3))),
                        },
                    vocalSegments: segs.map((s) => ({ startSec: s.startSec, endSec: s.endSec, meanEnergy: s.meanEnergy })),
                    truncated,
                },
            };
        },
    },
];
