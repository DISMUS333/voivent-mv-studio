//==============================================================================
// MV ワークスペース中央ペイン。
// 大画面 AudioReactiveSandbox プレビュー（解像度プリセット連動の
// レターボックスフレーム ＋ クイック解像度切替）、トランスポートバー、
// シーンタイムラインを縦に積んだメイン作業領域。
//==============================================================================
import React, { memo } from 'react';
import {
    IconPlay,
    IconReturnToStart,
    IconStop,
} from '../Icons';
import { AudioReactiveSandbox } from './AudioReactiveSandbox';
import { SceneTimeline } from './SceneTimeline';
import { useTheme } from '../../hooks/useTheme';
import { getResolutionPresets, aspectLabel, computeLetterboxFrame } from './mvExportPresets';
import { useElementSize } from './useElementSize';
import { useI18n } from '../../i18n';
import type { AudioSignals, LyricItem, MvImageAsset, MvProjectConfig, MvScene } from './types';
import type { Analysis } from '../../types';

//==============================================================================
// クイック解像度切替（memo 隔離コンポーネント）。
// 親 (MvCenterPane) は 30fps のオーディオシグナルで毎フレーム再レンダリングされる。
// このコンポーネントを memo 化して props (解像度 ID / 変更ハンドラ) が
// 不変の間はスキップすることで、ネイティブ <select> ポップアップ展開中の
// 不要な DOM 更新を排除し、選択確定が失われる競合を防ぐ。
//==============================================================================
const QuickResolutionSwitchInner: React.FC<{
    previewResolutionId: string;
    onChangePreviewResolution: (id: string) => void;
}> = ({ previewResolutionId, onChangePreviewResolution }) => {
    const { t } = useI18n();
    const preset = getResolutionPresets().find((p) => p.id === previewResolutionId) ?? getResolutionPresets()[0];
    return (
        <select
            value={preset.id}
            onChange={(e) => onChangePreviewResolution(e.target.value)}
            title={t.quickResolutionTitle}
            style={{
                background: '#0a0e18',
                color: '#c5ceff',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 5,
                fontSize: 10,
                fontWeight: 800,
                padding: '3px 5px',
                outline: 'none',
                cursor: 'pointer',
            }}
        >
            {getResolutionPresets().map((p) => (
                <option key={p.id} value={p.id}>
                    {aspectLabel(p.width, p.height)} · {p.label}
                </option>
            ))}
        </select>
    );
};

const QuickResolutionSwitch = memo(QuickResolutionSwitchInner);

interface MvCenterPaneProps {
    config: MvProjectConfig;
    signals: AudioSignals;
    sessionDuration: number;
    bpm: number;
    playheadSec: number;
    isPlaying: boolean;
    currentTimeSec: number;
    onSeek: (sec: number) => void;
    onTogglePlay: () => void;
    onStop: () => void;
    /** シーンタイムラインでのドラッグ編集結果を反映 */
    onUpdateScenes: (scenes: MvScene[]) => void;
    /** シーンタイムラインで選択したシーンを右ペインへ反映 */
    onSelectScene?: (id: string | null) => void;
    /** シーンタイムラインで選択中のシーン */
    selectedSceneId?: string | null;
    /** 歌詞タイムラインでのドラッグ編集結果を反映 */
    onUpdateLyrics?: (lyrics: LyricItem[]) => void;
    /** 素材ライブラリ（アセット）の更新 */
    onUpdateAssets?: (assets: MvImageAsset[]) => void;
    /** エフェクトクリップの更新 */
    onUpdateEffects?: (effects: import('./effects/types').MvEffectClip[]) => void;
    /** 選択中のエフェクト ID */
    selectedEffectId?: string | null;
    /** エフェクト選択ハンドラ */
    onSelectEffect?: (id: string | null) => void;
    /** FX アセットライブラリモーダルを開く */
    onOpenEffectAssetLibrary?: () => void;
    /** GIF/動画エクスポートのラスタライズ対象ホスト */
    sandboxHostRef: React.MutableRefObject<HTMLDivElement | null>;
    /**
     * Phaser 4 WebGL canvas ノードを forward するための ref。
     * MV 動画エクスポートで `preserveDrawingBuffer: true` 経由の
     * フレーム直接 drawImage キャプチャに使用する。
     */
    phaserCanvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
    /** オフライン描画中のみ非 null（GIF 出力時の決定的再描画用） */
    offlineSignals?: AudioSignals | null;
    /** プレビューフレームの解像度プリセット ID（エクスポートモーダルと双方向同期） */
    previewResolutionId: string;
    /** 解像度プリセット変更（モーダル・クイック切替の合流口） */
    onChangePreviewResolution: (id: string) => void;
    /** 楽曲解析データ（波形描画用） */
    analysis?: Analysis | null;
    /** Undo コールバック */
    onUndo?: () => void;
    /** Redo コールバック */
    onRedo?: () => void;
    /** Undo 可能フラグ */
    canUndo?: boolean;
    /** Redo 可能フラグ */
    canRedo?: boolean;
}

export const MvCenterPane: React.FC<MvCenterPaneProps> = ({
    config,
    signals,
    sessionDuration,
    bpm,
    playheadSec,
    isPlaying,
    currentTimeSec,
    onSeek,
    onTogglePlay,
    onStop,
    onUpdateScenes,
    onSelectScene,
    selectedSceneId = null,
    onUpdateLyrics,
    onUpdateAssets,
    onUpdateEffects,
    selectedEffectId = null,
    onSelectEffect,
    onOpenEffectAssetLibrary,
    sandboxHostRef,
    phaserCanvasRef,
    offlineSignals,
    previewResolutionId,
    onChangePreviewResolution,
    analysis,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
}) => {
    const { theme } = useTheme();
    const { t } = useI18n();
    const [previewAreaRef, previewAreaSize] = useElementSize<HTMLDivElement>();
    const mmss = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    // 選択解像度（未知 ID は既定へフォールバック）
    const preset = getResolutionPresets().find((p) => p.id === previewResolutionId) ?? getResolutionPresets()[0];
    // 外側コンテナ実寸からターゲット解像度比のフレーム矩形を算出。
    // ⚠️ 計測対象は必ず「外側コンテナ」。フレーム div 自身を計測すると
    // 「計測値 → フレームサイズ → 計測値」の自己参照ループに陥り、
    // 初期 1x1 のまま成長しない（プレビューが真っ黒になる）事故になる。
    const frame = computeLetterboxFrame(previewAreaSize.width, previewAreaSize.height, preset.width, preset.height);

    /** sandboxHostRef（GIF/動画エクスポートのラスタライズ対象）をフレーム div へ接続 */
    const setHostRef = (el: HTMLDivElement | null) => {
        sandboxHostRef.current = el;
    };

    return (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: theme.bgInset }}>

            {/* MVに重ならない専用の黒い操作帯 */}
            <div
                style={{
                    height: 34,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    padding: '0 8px',
                    background: '#000000',
                    borderBottom: `1px solid ${theme.borderSubtle}`,
                }}
            >
                <QuickResolutionSwitch
                    previewResolutionId={previewResolutionId}
                    onChangePreviewResolution={onChangePreviewResolution}
                />
            </div>

            {/* 大画面プレビュー（選択解像度のアスペクト比フレームにレターボックス表示） */}
            <div
                ref={previewAreaRef}
                style={{ flex: 1, minHeight: 120, position: 'relative', background: '#000000', overflow: 'hidden' }}
            >
                {/* 解像度プリセット連動のレターボックスフレーム。
                    ⚠️ 外側コンテナの計測が完了するまで描画しない（0/極小サイズで
                    Phaser やシーン SVG を起動させない防御。未描画時は従来同様
                    全面 black のみで、計測は 1 フレーム以内に完了する） */}
                {previewAreaSize.width > 0 && previewAreaSize.height > 0 && (
                    <div
                        ref={setHostRef}
                        style={{
                            position: 'absolute',
                            left: frame.offsetX,
                            top: frame.offsetY,
                            width: frame.width,
                            height: frame.height,
                            overflow: 'hidden',
                            boxShadow: '0 0 0 1px rgba(255,255,255,0.08)',
                            background: '#000000',
                        }}
                    >
                        <AudioReactiveSandbox
                            key={previewResolutionId}
                            scenes={config.scenes}
                            lyrics={config.lyrics}
                            effects={config.effects ?? []}
                            globalCss={config.globalCss}
                            signals={offlineSignals ?? signals}
                            assets={config.assets}
                            lyricStyle={config.lyricStyle}
                            phaserCanvasRef={phaserCanvasRef}
                        />
                    </div>
                )}

            </div>

            {/* トランスポートバー */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 12px',
                    background: theme.bgDeep,
                    borderTop: `1px solid ${theme.borderSubtle}`,
                    borderBottom: `1px solid ${theme.borderSubtle}`,
                    flexShrink: 0,
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                }}
            >
                {/* 再生コントロール */}
                <button
                    onClick={onTogglePlay}
                    title={isPlaying ? t.stopTitle : t.playTitle}
                    style={{
                        width: 30, height: 26,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: isPlaying ? theme.danger : theme.success,
                        color: theme.bgApp,
                        border: `1px solid ${isPlaying ? theme.danger : theme.success}`,
                        borderRadius: 5,
                        cursor: 'pointer',
                    }}
                >
                    {isPlaying ? <IconStop size={12} color={theme.bgApp} /> : <IconPlay size={12} color={theme.bgApp} />}
                </button>
                <button
                    onClick={onStop}
                    title={t.returnToStartTitle}
                    style={{
                        width: 28, height: 26,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: theme.bgControl,
                        color: theme.textSubtle,
                        border: `1px solid ${theme.borderLight}`,
                        borderRadius: 5,
                        cursor: 'pointer',
                    }}
                >
                    <IconReturnToStart size={12} color={theme.textSubtle} />
                </button>

                {/* 時間表示 */}
                <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', color: theme.textMain, letterSpacing: '0.04em', userSelect: 'none', WebkitUserSelect: 'none' }}>
                    {mmss(currentTimeSec)} / {mmss(sessionDuration)}
                </span>

                {/* BPM 表示 */}
                <span style={{ fontSize: 10, fontWeight: 800, color: theme.textSubtle, background: theme.bgControl, border: `1px solid ${theme.border}`, borderRadius: 4, padding: '2px 8px', userSelect: 'none', WebkitUserSelect: 'none' }}>
                    BPM {bpm}
                </span>

                {/* シークスライダー */}
                <input
                    type="range"
                    min={0}
                    max={Math.max(1, sessionDuration)}
                    step={0.05}
                    value={Math.min(currentTimeSec, sessionDuration)}
                    onChange={(e) => onSeek(Number(e.target.value))}
                    title={t.seekTitle}
                    style={{ flex: 1, accentColor: theme.accentInfo, height: 4, cursor: 'pointer' }}
                />

                {/* 現在シーン表示 */}
                <span style={{ fontSize: 9.5, fontWeight: 800, color: theme.accentInfo, whiteSpace: 'nowrap' }}>
                    {(() => {
                        const cur = [...config.scenes]
                            .sort((a, b) => a.startTime - b.startTime)
                            .find((s) => currentTimeSec >= s.startTime && currentTimeSec < s.endTime);
                        return cur ? cur.name : '—';
                    })()}
                </span>
            </div>

            {/* シーン＆歌詞タイムライン */}
            <div style={{ flexShrink: 0, padding: '8px 12px 10px', background: theme.bgDeep, userSelect: 'none', WebkitUserSelect: 'none' }}>
                <SceneTimeline
                    scenes={config.scenes}
                    lyrics={config.lyrics}
                    assets={config.assets}
                    effects={config.effects ?? []}
                    selectedEffectId={selectedEffectId}
                    onSelectEffect={onSelectEffect}
                    onUpdateEffects={onUpdateEffects}
                    onOpenEffectAssetLibrary={onOpenEffectAssetLibrary}
                    totalDuration={sessionDuration}
                    bpm={bpm}
                    selectedSceneId={selectedSceneId}
                    onSelectScene={onSelectScene ?? (() => { })}
                    onUpdateScenes={onUpdateScenes}
                    onUpdateLyrics={onUpdateLyrics}
                    onUpdateAssets={onUpdateAssets}
                    playheadSec={playheadSec}
                    onSeek={onSeek}
                    onTogglePlay={onTogglePlay}
                    analysis={analysis}
                    isPlaying={isPlaying}
                    onUndo={onUndo}
                    onRedo={onRedo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                />
            </div>
        </div>
    );
};
