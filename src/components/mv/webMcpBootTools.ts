//==============================================================================
// WebMCP ブートツール (ウェルカム画面 = 楽曲ロード前 に先行登録するツール群)。
//
// 背景:
//  - 本編 16 ツールは MvWorkspace マウント後 (楽曲ロード後) に登録されるため、
//    ChatGPT 内蔵ブラウザでサイトを開いた直後のエージェントは「ツール 0 本」の
//    サイトを見ている。審査 / デモの最初の 30 秒が静寂になってしまう。
//  - 本モジュールは楽曲ロード前でも成立する操作 (デモ曲ロード / スタジオ状態取得)
//    を先行登録し、エージェントが「曲のロードから全部やる」デモを可能にする。
//
// ライフサイクル:
//  - useWebMcpBoot フックが active の間のみ登録し、エディタ起動 (本編ツール登録)
//    と入れ替わる。ツール名は本編と衝突しない。
//==============================================================================
import type { WebMcpToolDefinition, WebMcpResult } from './webMcpTools';

/** デモ曲の公開パス (public-web/demo/ から静的配信される) */
export const DEMO_TRACK_PATH = 'demo/demo-track.wav';
export const DEMO_TRACK_META = {
    name: 'Voivent Demo Track',
    durationSec: 36,
    bpm: 120,
    structure: 'intro → build → drop → break → final → outro',
};

/** ホスト側からブートツールへ渡すポート */
export interface WebMcpBootContext {
    /** 楽曲がロード済みか (エディタが起動しているか) */
    isAudioLoaded: () => boolean;
    /** デモ曲ファイルのロード要求 (WebMvStudio の loadFile へ委譲) */
    onLoadFile: (file: File) => Promise<boolean>;
}

/**
 * ブートツール定義一覧を生成する (純粋関数: テスト容易性のため ctx を注入)。
 */
export function createBootToolDefinitions(ctx: WebMcpBootContext): WebMcpToolDefinition[] {
    return [
        {
            name: 'load_demo_track',
            description: `スタジオに同梱されたデモ曲 (${DEMO_TRACK_META.name}: ${DEMO_TRACK_META.durationSec} 秒 / ${DEMO_TRACK_META.bpm} BPM / 構成 ${DEMO_TRACK_META.structure}) を読み込み、MV エディタを起動します。ユーザーが音源を持っていない場合や、まずデモで MV 生成を試したい場合に最初に実行してください。ロード後は get_energy_map → create_full_mv_scenes → get_mv_preview の順で MV を構築できます。`,
            inputSchema: {
                type: 'object',
                properties: {},
            },
            execute: async () => {
                if (ctx.isAudioLoaded()) {
                    return {
                        success: true,
                        message: 'すでに楽曲が読み込まれています。get_mv_project で現在のプロジェクトを確認してください。',
                    } satisfies WebMcpResult;
                }
                try {
                    const url = new URL(DEMO_TRACK_PATH, globalThis.location?.href ?? 'file:///');
                    const res = await fetch(url);
                    if (!res.ok) {
                        return { success: false, message: `デモ曲の取得に失敗しました (HTTP ${res.status})。` };
                    }
                    const buf = await res.arrayBuffer();
                    const file = new File([buf], 'voivent-demo-track.wav', { type: 'audio/wav' });
                    const ok = await ctx.onLoadFile(file);
                    if (!ok) {
                        return { success: false, message: 'デモ曲の読み込みに失敗しました。' };
                    }
                    return {
                        success: true,
                        message: `デモ曲「${DEMO_TRACK_META.name}」(${DEMO_TRACK_META.durationSec} 秒 / ${DEMO_TRACK_META.bpm} BPM) を読み込み、MV エディタを起動しました。続いて get_energy_map で楽曲構造を解析し、create_full_mv_scenes でシーンを生成してください。`,
                    } satisfies WebMcpResult;
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    return { success: false, message: `デモ曲のロード中にエラーが発生しました: ${msg}` };
                }
            },
        },
        {
            name: 'get_studio_status',
            description: 'MV スタジオの現在の状態 (楽曲ロード済みか、デモ曲が利用可能か、利用できるツール群) を取得します。最初に呼んで作業計画を立ててください。',
            inputSchema: {
                type: 'object',
                properties: {},
            },
            execute: () => {
                const loaded = ctx.isAudioLoaded();
                return {
                    success: true,
                    message: loaded
                        ? '楽曲ロード済み。MV 編集ツール群 (get_mv_project / create_full_mv_scenes / get_mv_preview / render_mv_video 等) が利用できます。'
                        : `楽曲未ロード。ユーザーの音源を待つか、load_demo_track で同梱デモ曲 (${DEMO_TRACK_META.durationSec} 秒 / ${DEMO_TRACK_META.bpm} BPM) を読み込んでください。`,
                    data: {
                        audioLoaded: loaded,
                        demoTrack: { ...DEMO_TRACK_META, path: DEMO_TRACK_PATH, available: true },
                        editorTools: loaded
                            ? ['get_mv_project', 'get_energy_map', 'create_full_mv_scenes', 'create_3d_scene', 'create_3d_mv_scene', 'get_3d_scene_graph', 'patch_3d_scene_graph', 'inspect_3d_scene', 'render_3d_scene_clip', 'add_mv_scene', 'update_mv_scene', 'set_mv_lyrics', 'get_mv_preview', 'render_mv_clip', 'validate_mv_timeline', 'render_mv_video', 'control_mv_transport']
                            : [],
                        recommendedFlow: loaded
                            ? ['get_energy_map', 'create_full_mv_scenes', 'create_3d_scene', 'get_mv_preview', 'render_3d_scene_clip', 'render_mv_clip', 'validate_mv_timeline', 'render_mv_video']
                            : ['load_demo_track', 'get_energy_map', 'create_full_mv_scenes', 'get_mv_preview', 'render_mv_clip', 'render_mv_video'],
                    },
                } satisfies WebMcpResult;
            },
        },
    ];
}
