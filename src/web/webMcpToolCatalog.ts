import type { Lang } from '../i18n';

export interface WebMcpToolCatalogItem {
    name: Record<Lang, string>;
    description: Record<Lang, string>;
}

export interface WebMcpToolCatalogGroup {
    title: Record<Lang, string>;
    items: WebMcpToolCatalogItem[];
}

/** WebMCPの内部ツール名を、ホーム画面で読める機能紹介へ変換する一覧。 */
export const WEB_MCP_TOOL_CATALOG: WebMcpToolCatalogGroup[] = [
    {
        title: { ja: 'スタジオの状態', en: 'Studio status' },
        items: [
            { name: { ja: 'プロジェクトを読む', en: 'Read the project' }, description: { ja: 'シーン・歌詞・設定をまとめて確認する', en: 'Read scenes, lyrics, and project settings' } },
        ],
    },
    {
        title: { ja: 'シーンをつくる', en: 'Build scenes' },
        items: [
            { name: { ja: 'シーンを追加する', en: 'Add a scene' }, description: { ja: '指定した時間に映像シーンを追加する', en: 'Add a visual scene at a chosen time' } },
            { name: { ja: 'MV全体を構成する', en: 'Build the full MV' }, description: { ja: '曲全体のシーンを一括で生成・配置する', en: 'Generate and arrange the full MV structure' } },
            { name: { ja: 'シーンを編集する', en: 'Edit a scene' }, description: { ja: '名前・時間・映像コードを更新する', en: 'Update names, timing, and visual code' } },
            { name: { ja: 'シーンを削除する', en: 'Delete a scene' }, description: { ja: '不要なシーンをタイムラインから削除する', en: 'Remove unwanted scenes from the timeline' } },
            { name: { ja: 'シーンを選ぶ', en: 'Select a scene' }, description: { ja: '確認・編集するシーンを切り替える', en: 'Select a scene to inspect or edit' } },
            { name: { ja: '3Dシーンを作る', en: 'Build a 3D scene' }, description: { ja: 'カメラ・メッシュ・ライトを使う立体背景を生成する', en: 'Create a spatial background with cameras, meshes, and lights' } },
            { name: { ja: '3D部品を組む', en: 'Compose 3D objects' }, description: { ja: '宣言したノード・素材・ライトだけで立体背景を構成する', en: 'Compose a spatial background from declared nodes, materials, and lights' } },
            { name: { ja: '3D部品を差分編集する', en: 'Patch 3D objects' }, description: { ja: 'ノードの追加・更新・削除を安全に適用する', en: 'Safely add, update, or remove scene nodes' } },
            { name: { ja: '3D構図を診断する', en: 'Diagnose 3D framing' }, description: { ja: 'カメラと天井・床・壁の距離を検査する', en: 'Inspect camera distance to ceiling, floor, and walls' } },
            { name: { ja: 'シーンを分割する', en: 'Split a scene' }, description: { ja: '指定時刻でシーンを安全に二分する', en: 'Split a scene at a chosen time' } },
            { name: { ja: 'シーンの尺を変える', en: 'Resize a scene' }, description: { ja: '後続シーンを連動させて時間を調整する', en: 'Adjust timing with optional ripple movement' } },
        ],
    },
    {
        title: { ja: '映像コードを整える', en: 'Refine visuals' },
        items: [
            { name: { ja: 'シェーダーを検証する', en: 'Validate a shader' }, description: { ja: '動的なGPU背景が安全に描画できるか確認する', en: 'Check whether a dynamic GPU background is safe to render' } },
            { name: { ja: 'シェーダー案を比較する', en: 'Compare shader concepts' }, description: { ja: '複数の映像案を検証して選びやすくする', en: 'Validate multiple visual concepts for easier selection' } },
            { name: { ja: '3Dシーンを検証する', en: 'Validate a 3D scene' }, description: { ja: '色・密度・音連動・描画負荷を事前確認する', en: 'Check colors, density, audio response, and render cost' } },
            { name: { ja: '3Dシーングラフを検証する', en: 'Validate a 3D graph' }, description: { ja: '描画ノード・未対応項目・三角形数を確認する', en: 'Check rendered nodes, ignored fields, and triangle count' } },
            { name: { ja: '3D機能一覧を見る', en: 'List 3D capabilities' }, description: { ja: '利用可能な形状・素材・ライト・操作を確認する', en: 'Inspect supported shapes, materials, lights, and operations' } },
            { name: { ja: 'タイムラインを検証する', en: 'Validate the timeline' }, description: { ja: '未カバー区間・重複・歌詞のはみ出しを探す', en: 'Find gaps, overlaps, and lyric overflow' } },
        ],
    },
    {
        title: { ja: '歌詞と演出', en: 'Lyrics and effects' },
        items: [
            { name: { ja: '歌詞を配置する', en: 'Place lyrics' }, description: { ja: '歌詞テキストをタイムラインへ追加・更新する', en: 'Add or update lyric text on the timeline' } },
            { name: { ja: '歌詞の見せ方を選ぶ', en: 'Choose lyric styling' }, description: { ja: '歌詞の表示スタイルを切り替える', en: 'Choose how lyrics appear in the video' } },
            { name: { ja: 'エフェクトを追加する', en: 'Add an effect' }, description: { ja: '映像に音連動エフェクトを追加する', en: 'Add audio-reactive effects to the visuals' } },
            { name: { ja: 'エフェクトを削除する', en: 'Delete an effect' }, description: { ja: '不要な演出を取り除く', en: 'Remove effects that are no longer needed' } },
            { name: { ja: 'エフェクトを調整する', en: 'Update an effect' }, description: { ja: '強度や有効状態をその場で修正する', en: 'Adjust intensity or enabled state in place' } },
            { name: { ja: '演出プリセットを保存する', en: 'Save an effect preset' }, description: { ja: '気に入ったエフェクトを再利用できる形で保存する', en: 'Save a favorite effect for reuse' } },
        ],
    },
    {
        title: { ja: '音を読み解く', en: 'Understand the song' },
        items: [
            { name: { ja: '曲のエネルギーを分析する', en: 'Analyze song energy' }, description: { ja: '盛り上がり・静かな区間・ドロップを調べる', en: 'Find energy, quiet sections, and drops' } },
            { name: { ja: 'パート分離を実行する', en: 'Separate music parts' }, description: { ja: 'ボーカル・ドラム・ベースなどを分けて分析する', en: 'Separate and analyze vocals, drums, bass, and more' } },
            { name: { ja: '分離データを読む', en: 'Read separation data' }, description: { ja: '発声・打音・低域のタイミングを取得する', en: 'Read vocal, drum, and low-end timing data' } },
        ],
    },
    {
        title: { ja: '確認・保存・出力', en: 'Review, save, and export' },
        items: [
            { name: { ja: 'プロジェクトを書き出す', en: 'Export the project' }, description: { ja: '編集内容をプロジェクトファイルとして保存する', en: 'Save the edited project as a project file' } },
            { name: { ja: 'プレビュー解像度を選ぶ', en: 'Set preview resolution' }, description: { ja: '映像の縦横サイズを設定する', en: 'Set the video dimensions' } },
            { name: { ja: '再生を操作する', en: 'Control playback' }, description: { ja: '再生・停止・一時停止・再生位置移動を行う', en: 'Play, stop, pause, and seek' } },
            { name: { ja: 'マスター音量を調整する', en: 'Adjust master volume' }, description: { ja: '作品全体の音量を設定する', en: 'Set the volume for the whole project' } },
            { name: { ja: 'プレビューを見る', en: 'View a preview' }, description: { ja: '指定時刻の映像を画像で確認する', en: 'Inspect a frame at a chosen time' } },
            { name: { ja: '短尺フレーム列を見る', en: 'Review a short clip' }, description: { ja: 'カメラ移動・ちらつき・歌詞の重なりを数コマで確認する', en: 'Review camera motion, flicker, and lyric overlap across frames' } },
            { name: { ja: '3D短尺を確認する', en: 'Review a 3D clip' }, description: { ja: '宣言的な立体シーンを数コマで目視確認する', en: 'Inspect a declarative 3D scene across several frames' } },
            { name: { ja: '3Dシーンを調べる', en: 'Inspect a 3D scene' }, description: { ja: 'カメラ・ノード・描画実績と静止画を取得する', en: 'Read camera, nodes, render facts, and a still frame' } },
            { name: { ja: 'MVをレンダリングする', en: 'Render the MV' }, description: { ja: '完成した映像を動画として書き出す', en: 'Render the finished MV as a video' } },
        ],
    },
];

export const WEB_MCP_TOOL_CATALOG_COUNT = WEB_MCP_TOOL_CATALOG.reduce((count, group) => count + group.items.length, 0);
