//==============================================================================
// MV ワークスペース右ペイン（インスペクター）。
// 選択中シーンの全プロパティをアコーディオン形式で編集する。
// 基本設定 / 背景 / キーフレーム / コード(SVG・CSS・JS) / 歌詞スタイル /
// 解析トラック選択 を統合。幅 320px 固定。
//==============================================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    IconAlertTriangle,
    IconCode,
    IconCopy,
    IconDownload,
    IconFolder,
    IconMerge,
    IconMic,
    IconPlay,
    IconPlus,
    IconScissors,
    IconSliders,
    IconSparkles,
    IconStop,
    IconTimer,
    IconTrash,
    IconUndo,
    IconWaveform,
} from '../Icons';
import type { Analysis, SessionState } from '../../types';
import type {
    LyricAnimationKind,
    LyricGlobalStyle,
    LyricItem,
    LyricPositionKind,
    MvProjectConfig,
    MvScene,
    MvTransitionKind,
} from './types';
import { KeyframeEditor } from './KeyframeEditor';
import { WEB_MCP_TOOLS } from './webMcpTools';
import { useTheme } from '../../hooks/useTheme';
import { compileSceneScript } from './mvScriptRuntime';
import { LivePreviewPlayer } from './LivePreviewPlayer';
import { computeInsertionTiming, computePhrasePreviewWindow, createLyricId, getOverlappingLyricIds, LYRIC_DEFAULT_DURATION, mergeWithNextLyric, parseLrc, shiftAllLyricTimes, sortLyrics, splitLyricAtPosition, toLrc } from './mvSceneUtils';
import { NumberField } from './NumberField';
import { generateLyricTimings } from './mvAnimation';
import { ensureLyricIds } from './types';
import { getDict, useI18n } from '../../i18n';

interface MvRightPanelProps {
    config: MvProjectConfig;
    currentScene: MvScene | null;
    onUpdateCurrentScene: (patch: Partial<MvScene>) => void;
    session?: SessionState | null;
    analysis?: Analysis | null;
    bpm?: number;
    playheadSec?: number | null;
    onSeek?: (sec: number) => void;
    /** セッション再生中フラグ（フレーズプレビュー自動停止の監視用） */
    isPlaying?: boolean;
    /** フレーズプレビュー再生中のフレーズ id */
    previewingLyricId?: string | null;
    /** フレーズ区間プレビュー再生（シーク → 再生 → 終端で自動停止） */
    onPhrasePreview?: (startSec: number, endSec: number, lyricId: string) => void;
    /** 解析対象ボーカルトラック選択状態 */
    selectedTrackIndices: number[];
    onChangeSelectedTracks: (indices: number[]) => void;
    onAddScene: () => void;
    onDuplicateScene: () => void;
    onDeleteScene: () => void;
    /** 全シーン共通 CSS の更新 */
    onUpdateGlobalCss?: (css: string) => void;
    /** 歌詞リスト更新ハンドラ */
    onUpdateLyrics?: (lyrics: LyricItem[]) => void;
    /** 歌詞スタイル更新ハンドラ */
    onUpdateLyricStyle?: (style: LyricGlobalStyle) => void;
    /** AIボーカル解析モーダル起動ハンドラ */
    onOpenVocalAnalysisModal?: () => void;
}

/** アコーディオンセクション */
const Section: React.FC<{
    title: string;
    color: string;
    icon?: React.ReactNode;
    defaultOpen?: boolean;
    sectionId?: string;
    children: React.ReactNode;
}> = ({ title, color, icon, defaultOpen = false, sectionId, children }) => {
    const [open, setOpen] = useState(defaultOpen);
    const { theme } = useTheme();

    useEffect(() => {
        if (!sectionId) return;
        const handleOpen = (e: Event) => {
            const custom = e as CustomEvent<{ sectionId?: string; id?: string }>;
            if (
                custom.detail?.sectionId === sectionId ||
                (sectionId === 'lyrics' && (custom.type === 'voivent:focus-lyric' || custom.detail?.id != null))
            ) {
                setOpen(true);
            }
        };
        window.addEventListener('voivent:open-section', handleOpen);
        window.addEventListener('voivent:focus-lyric', handleOpen);
        return () => {
            window.removeEventListener('voivent:open-section', handleOpen);
            window.removeEventListener('voivent:focus-lyric', handleOpen);
        };
    }, [sectionId]);

    return (
        <div style={{ borderBottom: `1px solid ${theme.borderSubtle}` }}>
            <button
                onClick={() => setOpen((v) => !v)}
                style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'transparent',
                    border: 'none',
                    padding: '8px 12px',
                    cursor: 'pointer',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {icon}
                    <span style={{ fontSize: 10.5, fontWeight: 900, color, letterSpacing: '0.04em' }}>{title}</span>
                </div>
                <span style={{ fontSize: 9, color: '#64748b' }}>{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {children}
                </div>
            )}
        </div>
    );
};

/** 遷移エフェクト選択肢（言語切替対応で毎回生成） */
const getTransitionOptions = (): Array<{ id: MvTransitionKind; label: string }> => {
    const d = getDict();
    return [
        { id: 'none', label: d.trNone },
        { id: 'fade', label: d.trFade },
        { id: 'slideLeft', label: d.trSlideLeft },
        { id: 'slideRight', label: d.trSlideRight },
        { id: 'wipe', label: d.trWipe },
        { id: 'zoom', label: d.trZoom },
    ];
};

const inputStyle: React.CSSProperties = {
    background: '#0a0d14',
    border: '1px solid #334155',
    color: '#e2e8f0',
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 11,
    outline: 'none',
};

export const MvRightPanel: React.FC<MvRightPanelProps> = ({
    config,
    currentScene,
    onUpdateCurrentScene,
    session,
    analysis,
    bpm = 120,
    playheadSec = null,
    isPlaying,
    previewingLyricId,
    onPhrasePreview,
    selectedTrackIndices,
    onChangeSelectedTracks,
    onAddScene,
    onDuplicateScene,
    onDeleteScene,
    onUpdateGlobalCss,
    onUpdateLyrics,
    onUpdateLyricStyle,
    onOpenVocalAnalysisModal,
}) => {
    const { theme } = useTheme();
    const { t } = useI18n();
    const transitionOptions = useMemo(() => getTransitionOptions(), [t]);
    // コードエディタタブ（Shader / SVG / CSS / JS で高さを共有）
    const [codeTab, setCodeTab] = useState<'shader' | 'svg' | 'css' | 'js'>(
        currentScene?.shaderCode ? 'shader' : 'svg'
    );
    const [previewEnabled, setPreviewEnabled] = useState(true);

    // カスタムスクリプト構文チェック
    const scriptCheck = useMemo(() => {
        const src = currentScene?.customScript;
        if (!src) return null;
        return compileSceneScript(src)
            ? { ok: true as const, message: t.syntaxOk }
            : { ok: false as const, message: t.syntaxError };
    }, [currentScene?.customScript]);

    return (
        <div style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${theme.borderSubtle}`, background: theme.bgDeep, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {/* シーン操作ヘッダー */}
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.borderSubtle}`, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: '#f1f5f9' }}>
                        {currentScene ? currentScene.name : t.noScene}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={onAddScene} title={t.addSceneTitle} style={{ background: theme.accentSecondary, color: theme.bgApp, border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <IconPlus size={10} color={theme.bgApp} />
                            <span>{t.add}</span>
                        </button>
                        <button onClick={onDuplicateScene} disabled={!currentScene} title={t.duplicateTitle} style={{ background: theme.bgControl, color: theme.accentSecondary, border: `1px solid ${theme.borderLight}`, borderRadius: 4, padding: '3px 7px', fontSize: 10, fontWeight: 800, cursor: currentScene ? 'pointer' : 'not-allowed', opacity: currentScene ? 1 : 0.5 }}>
                            <IconCopy size={11} color={theme.accentSecondary} />
                        </button>
                        <button onClick={onDeleteScene} disabled={!currentScene || config.scenes.length <= 1} title={t.deleteTitle} style={{ background: theme.bgControl, color: theme.danger, border: `1px solid ${theme.borderLight}`, borderRadius: 4, padding: '3px 7px', fontSize: 10, fontWeight: 800, cursor: currentScene && config.scenes.length > 1 ? 'pointer' : 'not-allowed', opacity: currentScene && config.scenes.length > 1 ? 1 : 0.5 }}>
                            <IconTrash size={11} color={theme.danger} />
                        </button>
                    </div>
                </div>

                {/* ライブプレビュー（常時表示・折りたたみ可） */}
                <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', maxHeight: 150, background: '#000', borderRadius: 6, overflow: 'hidden', border: `1px solid ${theme.border}` }}>
                    {previewEnabled && currentScene && (
                        <LivePreviewPlayer config={config} scene={currentScene} bpm={bpm} />
                    )}
                </div>
            </div>

            {/* 基本設定 */}
            <Section title={t.secBasic} color="#38bdf8" icon={<IconSliders size={12} color="#38bdf8" />} defaultOpen>
                {currentScene && (
                    <>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', width: 42 }}>{t.labelName}</span>
                            <input type="text" value={currentScene.name} onChange={(e) => onUpdateCurrentScene({ name: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8' }}>{t.labelStart}</span>
                                <NumberField value={currentScene.startTime} onCommit={(v) => onUpdateCurrentScene({ startTime: v })} min={0} style={{ ...inputStyle, width: 60, textAlign: 'right' }} title={t.titleSceneStart} />
                                <span style={{ fontSize: 9, color: '#64748b' }}>{t.unitSec}</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8' }}>{t.labelEnd}</span>
                                <NumberField value={currentScene.endTime} onCommit={(v) => onUpdateCurrentScene({ endTime: v })} min={currentScene.startTime + 0.5} style={{ ...inputStyle, width: 60, textAlign: 'right' }} title={t.titleSceneEnd} />
                                <span style={{ fontSize: 9, color: '#64748b' }}>{t.unitSec}</span>
                            </label>
                        </div>
                        {/* ビート同期方式 */}
                        <div>
                            <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t.beatSyncMode}</span>
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                {[
                                    { id: 'daw_realtime', label: t.syncDaw },
                                    { id: 'bpm_auto', label: t.syncBpm },
                                ].map((sync) => {
                                    const active = (currentScene.audioSyncMode ?? 'daw_realtime') === sync.id;
                                    return (
                                        <button
                                            key={sync.id}
                                            onClick={() => onUpdateCurrentScene({ audioSyncMode: sync.id as never })}
                                            title={t.titleBeatSync(sync.label)}
                                            style={{
                                                background: active ? 'rgba(56, 189, 248, 0.25)' : '#161c28',
                                                color: active ? '#38bdf8' : '#94a3b8',
                                                border: `1px solid ${active ? '#38bdf8' : '#283548'}`,
                                                borderRadius: 4,
                                                padding: '2px 7px',
                                                fontSize: 9,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {sync.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 遷移 */}
                        <div>
                            <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t.transitionFx}</span>
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                {transitionOptions.map((opt) => {
                                    const active = (currentScene.transition ?? 'none') === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            onClick={() => onUpdateCurrentScene({ transition: opt.id === 'none' ? undefined : opt.id })}
                                            title={t.titleTransition(opt.label)}
                                            style={{
                                                background: active ? 'rgba(56, 189, 248, 0.2)' : '#161c28',
                                                color: active ? '#7dd3fc' : '#94a3b8',
                                                border: `1px solid ${active ? '#38bdf8' : '#283548'}`,
                                                borderRadius: 4,
                                                padding: '2px 7px',
                                                fontSize: 9.5,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                            {(currentScene.transition ?? 'none') !== 'none' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
                                    <NumberField
                                        value={currentScene.transitionDurationSec ?? 0.6}
                                        onCommit={(v) => onUpdateCurrentScene({ transitionDurationSec: v })}
                                        min={0.1}
                                        max={5}
                                        fallback={0.6}
                                        style={{ ...inputStyle, width: 52, textAlign: 'right' }}
                                        title={t.titleTransitionSec}
                                    />
                                    <span style={{ fontSize: 9, color: '#64748b' }}>{t.unitSec}</span>
                                </div>
                            )}
                        </div>

                        {/* WebGL ビジュアルテーマ */}
                        <div>
                            <span style={{ fontSize: 10, fontWeight: 800, color: '#a855f7', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                <IconSparkles size={11} color="#a855f7" />
                                <span>{t.bgFx}</span>
                            </span>
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                {[
                                    { id: 'oscilloscope', label: t.bgOscilloscope },
                                    { id: 'fluid_aurora', label: t.bgFluidAurora },
                                    { id: 'ambient_bokeh', label: t.bgAmbientBokeh },
                                    { id: 'spectrum_bars', label: t.bgSpectrumBars },
                                    { id: 'none', label: t.bgNone },
                                ].map((thm) => {
                                    const active = (currentScene.phaserTheme ?? 'oscilloscope') === thm.id;
                                    return (
                                        <button
                                            key={thm.id}
                                            onClick={() => onUpdateCurrentScene({ phaserTheme: thm.id as never })}
                                            title={t.titleBgFx(thm.label)}
                                            style={{
                                                background: active ? 'rgba(168, 85, 247, 0.25)' : '#161c28',
                                                color: active ? '#c084fc' : '#94a3b8',
                                                border: `1px solid ${active ? '#a855f7' : '#283548'}`,
                                                borderRadius: 4,
                                                padding: '2px 7px',
                                                fontSize: 9,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {thm.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 歌詞の表示レイヤー選択 */}
                        <div style={{ marginTop: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                <IconSparkles size={11} color="#38bdf8" />
                                <span>{t.lyrDisplayStyle}</span>
                            </span>
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                {[
                                    { id: 'preset_box', label: t.lyrPresetBox },
                                    { id: 'phaser_pixel', label: t.lyrPhaserPixel },
                                    { id: 'top_telop', label: t.lyrTopTelop },
                                    { id: 'none', label: t.lyrHidden },
                                ].map((disp) => {
                                    const active = (currentScene.lyricDisplayMode ?? (currentScene.lyricEffect && currentScene.lyricEffect !== 'none' ? 'phaser_pixel' : 'preset_box')) === disp.id;
                                    return (
                                        <button
                                            key={disp.id}
                                            onClick={() => onUpdateCurrentScene({ lyricDisplayMode: disp.id as never })}
                                            title={t.titleLyrDisplay(disp.label)}
                                            style={{
                                                background: active ? 'rgba(56, 189, 248, 0.25)' : '#161c28',
                                                color: active ? '#38bdf8' : '#94a3b8',
                                                border: `1px solid ${active ? '#38bdf8' : '#283548'}`,
                                                borderRadius: 4,
                                                padding: '2px 7px',
                                                fontSize: 9,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {disp.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ピクセル物理演出スタイル */}
                        {(currentScene.lyricDisplayMode === 'phaser_pixel' || (!currentScene.lyricDisplayMode && currentScene.lyricEffect && currentScene.lyricEffect !== 'none')) && (
                            <div style={{ marginTop: 6 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                    <IconSparkles size={11} color="#f59e0b" />
                                    <span>{t.fxParticleStyle}</span>
                                </span>
                                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                    {[
                                        { id: 'particle_disintegrate', label: t.fxParticle },
                                        { id: 'kinetic_assembly', label: t.fxAssembly },
                                        { id: 'liquid_morph', label: t.fxLiquid },
                                        { id: 'impact_reactive', label: t.fxImpact },
                                        { id: 'glitch_neon', label: t.fxGlitch },
                                        { id: 'camera_warp', label: t.fxCamera },
                                    ].map((eff) => {
                                        const active = (currentScene.lyricEffect ?? 'particle_disintegrate') === eff.id;
                                        return (
                                            <button
                                                key={eff.id}
                                                onClick={() => onUpdateCurrentScene({ lyricEffect: eff.id as never })}
                                                title={t.titleFxParticle(eff.label)}
                                                style={{
                                                    background: active ? 'rgba(245, 158, 11, 0.25)' : '#161c28',
                                                    color: active ? '#fbbf24' : '#94a3b8',
                                                    border: `1px solid ${active ? '#f59e0b' : '#283548'}`,
                                                    borderRadius: 4,
                                                    padding: '2px 7px',
                                                    fontSize: 9,
                                                    fontWeight: 800,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {eff.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </Section>

            {/* 背景設定 */}
            <Section title={t.secBackground} color="#34d399" icon={<IconFolder size={12} color="#34d399" />}>
                {currentScene && (
                    <>
                        <select
                            value={currentScene.backgroundImageId ?? ''}
                            onChange={(e) => onUpdateCurrentScene({ backgroundImageId: e.target.value || undefined })}
                            title={t.titlePickBg}
                            style={{ ...inputStyle, width: '100%' }}
                        >
                            <option value="">{t.bgImageNone}</option>
                            {(config.assets ?? []).map((a) => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                        {(config.assets ?? []).length === 0 && (
                            <span style={{ fontSize: 9, color: '#64748b' }}>{t.bgImageHint}</span>
                        )}
                    </>
                )}
            </Section>

            {/* キーフレーム */}
            <Section title={t.secKeyframe} color="#38bdf8" icon={<IconTimer size={12} color="#38bdf8" />}>
                {currentScene && (
                    <KeyframeEditor
                        keyframes={currentScene.keyframes}
                        onChange={(next) => onUpdateCurrentScene({ keyframes: next })}
                    />
                )}
            </Section>

            {/* コードエディタ（SVG / CSS / JS タブ） */}
            <Section title={t.secCode} color="#c084fc" icon={<IconCode size={12} color="#c084fc" />}>
                {currentScene && (
                    <>
                        <div style={{ display: 'flex', gap: 3 }}>
                            {([
                                ['shader', 'Three.js 3D'],
                                ['svg', 'SVG/HTML'],
                                ['css', 'CSS'],
                                ['js', t.tabScript],
                            ] as Array<[typeof codeTab, string]>).map(([id, label]) => (
                                <button
                                    key={id}
                                    onClick={() => setCodeTab(id)}
                                    style={{
                                        flex: 1,
                                        background: codeTab === id ? 'rgba(192, 132, 252, 0.18)' : '#161c28',
                                        color: codeTab === id ? '#d8b4fe' : '#94a3b8',
                                        border: `1px solid ${codeTab === id ? '#c084fc' : '#283548'}`,
                                        borderRadius: 4,
                                        padding: '3px 0',
                                        fontSize: 9.5,
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {codeTab === 'shader' && (
                            <div>
                                <div style={{ fontSize: 8.5, color: '#94a3b8', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Three.js TSL 3D背景 (u.uBeat, u.uLow, u.uTimeSec)</span>
                                    {currentScene.shaderCode && (
                                        <button
                                            onClick={() => onUpdateCurrentScene({ shaderCode: undefined })}
                                            style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 8.5, cursor: 'pointer', padding: 0 }}
                                        >
                                            クリア
                                        </button>
                                    )}
                                </div>
                                <textarea
                                    value={currentScene.shaderCode || ''}
                                    onChange={(e) => onUpdateCurrentScene({ shaderCode: e.target.value || undefined })}
                                    rows={10}
                                    spellCheck={false}
                                    placeholder="// Three.js WebGPU 3D 背景コード (tsl, u) => tsl.vec4(...)"
                                    style={{ ...codeAreaStyle }}
                                />
                            </div>
                        )}

                        {codeTab === 'js' && scriptCheck && (
                            <span style={{ fontSize: 9, fontWeight: 800, color: scriptCheck.ok ? '#34d399' : '#ef4444' }}>
                                {scriptCheck.message}
                            </span>
                        )}

                        {codeTab === 'svg' && (
                            <textarea
                                value={currentScene.svgCode}
                                onChange={(e) => onUpdateCurrentScene({ svgCode: e.target.value })}
                                rows={10}
                                spellCheck={false}
                                placeholder={t.phSvg}
                                style={{ ...codeAreaStyle }}
                            />
                        )}
                        {codeTab === 'css' && (
                            <textarea
                                value={currentScene.cssCode || ''}
                                onChange={(e) => onUpdateCurrentScene({ cssCode: e.target.value })}
                                rows={10}
                                spellCheck={false}
                                placeholder={t.phSceneCss}
                                style={{ ...codeAreaStyle }}
                            />
                        )}
                        {codeTab === 'js' && (
                            <textarea
                                value={currentScene.customScript || ''}
                                onChange={(e) => onUpdateCurrentScene({ customScript: e.target.value || undefined })}
                                rows={10}
                                spellCheck={false}
                                placeholder={t.phJsApi}
                                style={{ ...codeAreaStyle }}
                            />
                        )}

                        {/* SVG 書き出し／読み込み */}
                        <div style={{ display: 'flex', gap: 5 }}>
                            <button
                                onClick={() => {
                                    const blob = new Blob([currentScene.svgCode ?? ''], { type: 'image/svg+xml' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `mv_scene_${currentScene.id || 'custom'}.svg`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#1e293b', color: '#38bdf8', border: '1px solid #334155', borderRadius: 4, padding: '3px 8px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}
                            >
                                <IconDownload size={10} color="#38bdf8" />
                                <span>{t.exportSvg}</span>
                            </button>
                            <label
                                style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#1e293b', color: '#c084fc', border: '1px solid #334155', borderRadius: 4, padding: '3px 8px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}
                            >
                                <IconFolder size={10} color="#c084fc" />
                                <span>{t.loadFile}</span>
                                <input
                                    type="file"
                                    accept=".svg,.html,.txt"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            const reader = new FileReader();
                                            reader.onload = (evt) => {
                                                const text = evt.target?.result as string;
                                                if (text) onUpdateCurrentScene({ svgCode: text });
                                            };
                                            reader.readAsText(file);
                                        }
                                        e.target.value = '';
                                    }}
                                />
                            </label>
                        </div>
                    </>
                )}
            </Section>

            {/* 歌詞 ＆ ボーカルAI解析 */}
            {onUpdateLyrics && (
                <LyricSection
                    lyrics={config.lyrics || []}
                    onUpdateLyrics={onUpdateLyrics}
                    lyricStyle={config.lyricStyle || {}}
                    onUpdateLyricStyle={onUpdateLyricStyle}
                    analysisPeaks={analysis?.peaks}
                    analysisDurationSec={session?.duration || 16}
                    selectedTrackIndices={selectedTrackIndices}
                    tracks={session?.tracks || []}
                    onOpenVocalAnalysisModal={onOpenVocalAnalysisModal}
                    playheadSec={playheadSec}
                    isPlaying={isPlaying}
                    previewingLyricId={previewingLyricId}
                    onPhrasePreview={onPhrasePreview}
                />
            )}

            {/* 全シーン共通 CSS */}
            {onUpdateGlobalCss && (
                <Section title={t.secGlobalCss} color="#c084fc" icon={<IconCode size={12} color="#c084fc" />}>
                    <textarea
                        value={config.globalCss || ''}
                        onChange={(e) => onUpdateGlobalCss(e.target.value)}
                        rows={6}
                        spellCheck={false}
                        placeholder={t.phGlobalCss}
                        style={{ ...codeAreaStyle }}
                    />
                </Section>
            )}

            {/* AI (MCP) 連携 */}
            <McpIntegrationSection
                config={config}
                currentScene={currentScene}
                bpm={bpm}
            />
        </div>
    );
};

/** 歌詞 ＆ ボーカルAI解析セクション */
const LyricSection: React.FC<{
    lyrics: LyricItem[];
    onUpdateLyrics: (lyrics: LyricItem[]) => void;
    lyricStyle?: LyricGlobalStyle;
    onUpdateLyricStyle?: (style: LyricGlobalStyle) => void;
    analysisPeaks?: Array<[number, number]>;
    analysisDurationSec?: number;
    selectedTrackIndices?: number[];
    tracks?: Array<{ name?: string }>;
    onOpenVocalAnalysisModal?: () => void;
    playheadSec?: number | null;
    isPlaying?: boolean;
    previewingLyricId?: string | null;
    onPhrasePreview?: (startSec: number, endSec: number, lyricId: string) => void;
}> = ({
    lyrics,
    onUpdateLyrics,
    lyricStyle = {},
    onUpdateLyricStyle,
    analysisPeaks,
    analysisDurationSec = 0,
    selectedTrackIndices = [],
    tracks = [],
    onOpenVocalAnalysisModal,
    playheadSec = null,
    isPlaying = false,
    previewingLyricId = null,
    onPhrasePreview,
}) => {
        const { t: dx } = useI18n();
        const [notice, setNotice] = useState<string | null>(null);
        const [bulkText, setBulkText] = useState('');
        const [showBulkInput, setShowBulkInput] = useState(false);
        const [styleOpen, setStyleOpen] = useState(false);
        // 一括貼付の登録モード（誤って既存歌詞を消さないため追記を既定に変更）
        const [bulkMode, setBulkMode] = useState<'append' | 'replace'>('append');
        // 全体タイミング補正（直前 1 回のシフト量を保持して取り消し可能に）
        const [lastShift, setLastShift] = useState(0);
        // 再生中フレーズへの自動スクロール追従
        const listRef = useRef<HTMLDivElement | null>(null);
        const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
        const followRef = useRef(true);
        const programmaticScrollUntilRef = useRef(0);
        const prevPlayingRef = useRef(false);

        const sorted = sortLyrics(lyrics);

        /**
         * 現在の再生時刻に最も近い歌詞の id（再生中のハイライト用）。
         * mvConfig に再生時刻が来ない場合は null。
         */
        const currentLyricId = useMemo<string | null>(() => {
            if (typeof playheadSec !== 'number' || !Number.isFinite(playheadSec)) return null;
            const t = playheadSec;
            for (const l of sorted) {
                if (!l.id) continue;
                if (t >= l.time && t < l.time + (l.duration ?? 4.0)) return l.id;
            }
            return null;
        }, [sorted, playheadSec]);

        // ⚠️ 重なり検知（表示のみの警告・データは変更しない）
        const overlappingIds = useMemo(() => new Set(getOverlappingLyricIds(lyrics)), [lyrics]);

        // 再生開始の瞬間に追従を再開（手動スクロールで一時停止しても再生し直せば復帰）
        useEffect(() => {
            if (isPlaying && !prevPlayingRef.current) followRef.current = true;
            prevPlayingRef.current = isPlaying;
        }, [isPlaying]);

        // 再生中フレーズの自動スクロール追従（リスト外に出たときだけ動く）
        useEffect(() => {
            if (!followRef.current || !currentLyricId) return;
            const el = rowRefs.current.get(currentLyricId);
            const list = listRef.current;
            if (!el || !list) return;
            const listRect = list.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            if (elRect.top < listRect.top || elRect.bottom > listRect.bottom) {
                programmaticScrollUntilRef.current = Date.now() + 300;
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, [currentLyricId]);

        // タイムライン上のフレーズクリック / 新規追加時に該当行のテキスト入力へフォーカス＆スクロール
        useEffect(() => {
            const handleFocusLyric = (e: Event) => {
                const custom = e as CustomEvent<{ id: string }>;
                const id = custom.detail?.id;
                if (!id) return;
                setTimeout(() => {
                    const targetInput =
                        document.querySelector<HTMLInputElement>(`input[data-lyric-id="${id}"]`) ||
                        document.querySelector<HTMLInputElement>(`[data-lyric-row="${id}"] input`);
                    if (targetInput) {
                        targetInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        targetInput.focus();
                        targetInput.select();
                        const row = targetInput.closest<HTMLDivElement>('[data-lyric-row]');
                        if (row) {
                            row.style.transition = 'box-shadow 0.2s ease, border-color 0.2s ease';
                            row.style.borderColor = '#f472b6';
                            row.style.boxShadow = '0 0 14px rgba(244, 114, 182, 0.6)';
                            setTimeout(() => {
                                row.style.boxShadow = '';
                                row.style.borderColor = '';
                            }, 1500);
                        }
                    }
                }, 100);
            };
            window.addEventListener('voivent:focus-lyric', handleFocusLyric);
            return () => window.removeEventListener('voivent:focus-lyric', handleFocusLyric);
        }, []);

        // 全体タイミング補正（AI 文字起こし後の全フレーズ一括ズレ調整）
        const applyGlobalOffset = (delta: number) => {
            const { shifted, clampedCount } = shiftAllLyricTimes(lyrics, delta);
            onUpdateLyrics(shifted);
            setLastShift(delta);
            const sign = delta > 0 ? '+' : '';
            setNotice(clampedCount > 0
                ? dx.noticeShiftClamped(`${sign}${delta}`, clampedCount)
                : dx.noticeShifted(`${sign}${delta}`));
            setTimeout(() => setNotice(null), 3000);
        };

        const undoGlobalOffset = () => {
            if (lastShift === 0) return;
            const { shifted } = shiftAllLyricTimes(lyrics, -lastShift);
            onUpdateLyrics(shifted);
            const sign = lastShift > 0 ? '+' : '';
            setNotice(dx.noticeShiftUndone(`${sign}${lastShift}`));
            setLastShift(0);
            setTimeout(() => setNotice(null), 3000);
        };

        /**
         * 「{dx.btnSetFromCurrent}」ボタン: その歌詞の開始秒を現在の再生位置にスナップ。
         */
        const setTimeFromCurrent = (id: string) => {
            if (typeof playheadSec !== 'number' || !Number.isFinite(playheadSec)) return;
            updateLyricTime(id, Math.max(0, Number(playheadSec.toFixed(2))));
        };

        /**
         * バグ修正: id ベースで参照する。旧実装は `lyrics.indexOf(l)` を使っており、
         * AI 文字起こしや LRC 読込で「同じ time・同じ text」が複数並ぶと
         * indexOf が常に最初の要素を返して、2 行目以降の編集が全部 1 行目に
         * かぶさる事故が起きていた。id は ensureLyricIds() で必ず付与。
         */
        const updateLyricText = (id: string, val: string) => {
            onUpdateLyrics(lyrics.map((l) => ((l.id === id || `ly_${l.time}` === id) ? { ...l, text: val } : l)));
        };
        const updateLyricTime = (id: string, val: number) => {
            onUpdateLyrics(lyrics.map((l) => ((l.id === id || `ly_${l.time}` === id) ? { ...l, time: val } : l)));
        };
        const updateLyricDuration = (id: string, val: number) => {
            onUpdateLyrics(lyrics.map((l) => ((l.id === id || `ly_${l.time}` === id) ? { ...l, duration: val } : l)));
        };

        /** 追加直後の新フレーズ入力欄へフォーカス（連続歌詞入力フロー用） */
        const addLyricAndFocus = () => {
            const newId = addLyric();
            if (!newId) return;
            setTimeout(() => {
                const el = document.querySelector<HTMLInputElement>(`input[data-lyric-id="${newId}"]`);
                if (!el) return;
                el.focus();
                el.select();
                const list = listRef.current;
                if (list) {
                    programmaticScrollUntilRef.current = Date.now() + 300;
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 50);
        };

        /** 指定フレーズ直後へ挿入し、新フレーズ入力欄へフォーカス（文節区切り修正フロー用） */
        const insertAfterAndFocus = (id: string) => {
            if (!id) return;
            const newId = insertLyricAfter(id);
            if (!newId) return;
            setTimeout(() => {
                const el = document.querySelector<HTMLInputElement>(`input[data-lyric-id="${newId}"]`);
                if (!el) return;
                el.focus();
                el.select();
                const list = listRef.current;
                if (list) {
                    programmaticScrollUntilRef.current = Date.now() + 300;
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 50);
        };

        /** src フレーズ直後へ新フレーズを挿入（AI 区切り修正・連続入力の両方で使用） */
        const insertLyricAfter = (srcId: string): string => {
            const idx = lyrics.findIndex((l) => l.id === srcId);
            const src = lyrics[idx];
            if (!src || !src.id) return '';

            // 挿入時刻は純粋関数で算出（前後フレーズの隙間中央・次フレーズ開始でクランプ）
            const sortedIdx = sorted.findIndex((l) => l.id === srcId);
            const nextStart = sortedIdx >= 0 && sortedIdx < sorted.length - 1
                ? sorted[sortedIdx + 1].time
                : undefined;
            const t = computeInsertionTiming(src.time, src.duration, nextStart);
            const newId = createLyricId();
            const ins: LyricItem = {
                id: newId,
                time: t.time,
                text: dx.newLyricPhrase,
                duration: t.duration,
            };
            const next = [...lyrics];
            next.splice(idx + 1, 0, ins);
            onUpdateLyrics(next);
            return newId;
        };

        const addLyric = (): string => {
            const last = sorted[sorted.length - 1];
            if (!last || !last.id) {
                // 空リストへのフォールバック（通常未到達）
                const fallbackId = createLyricId();
                onUpdateLyrics([{
                    id: fallbackId,
                    time: 0,
                    text: dx.newLyricPhrase,
                    duration: LYRIC_DEFAULT_DURATION,
                }]);
                return fallbackId;
            }
            return insertLyricAfter(last.id);
        };

        const duplicateLyric = (id: string) => {
            const src = lyrics.find((l) => l.id === id);
            if (!src || !src.id) return;
            const sortedIdx = sorted.findIndex((l) => l.id === id);
            const nextStart = sortedIdx >= 0 && sortedIdx < sorted.length - 1
                ? sorted[sortedIdx + 1].time
                : undefined;
            const gapToNext = nextStart !== undefined ? Math.max(0, nextStart - src.time) : (src.duration ?? LYRIC_DEFAULT_DURATION);
            // 賢い複製時刻: 元フレーズ終了と次フレーズ開始の中間に配置し、
            // 次フレーズと重ならないよう持続をクランプ
            const dupTime = Number((src.time + (gapToNext > 0.2 ? gapToNext / 2 : gapToNext)).toFixed(2));
            const dupDur = nextStart !== undefined
                ? Number(Math.max(0.5, Math.min(src.duration ?? LYRIC_DEFAULT_DURATION, nextStart - dupTime)).toFixed(2))
                : (src.duration ?? LYRIC_DEFAULT_DURATION);
            const dup: LyricItem = {
                ...src,
                id: createLyricId(),
                time: dupTime,
                duration: dupDur,
            };
            const idx = lyrics.findIndex((l) => l.id === id);
            const next = [...lyrics];
            next.splice(idx + 1, 0, dup);
            onUpdateLyrics(next);
        };

        /** 指定フレーズと次フレーズを 1 行に結合（AI の文節区切りミス修正用） */
        const mergeLyricWithNext = (id: string) => {
            if (!id) return;
            const merged = mergeWithNextLyric(lyrics, id);
            if (merged) onUpdateLyrics(merged);
        };

        /** 指定フレーズをカーソル位置で 2 分割（時間も文字比率で自動按分） */
        const splitLyricAtCursor = (id: string, cursorIndex?: number) => {
            if (!id) return;
            let splitPos = cursorIndex;
            if (splitPos === undefined) {
                const inputEl = document.querySelector(`input[data-lyric-id="${id}"]`) as HTMLInputElement | null;
                if (inputEl && inputEl.selectionStart !== null) {
                    splitPos = inputEl.selectionStart;
                }
            }
            if (splitPos === undefined || splitPos <= 0) {
                // カーソルが先頭にある、または取得できない場合は中間で分割
                const target = lyrics.find((l) => l.id === id);
                if (!target || !target.text) return;
                splitPos = Math.floor(target.text.length / 2);
            }
            const splitted = splitLyricAtPosition(lyrics, id, splitPos);
            if (splitted) {
                onUpdateLyrics(splitted);
            }
        };

        const deleteLyric = (id: string) => {
            onUpdateLyrics(lyrics.filter((l) => l.id !== id));
        };

        // 📝 複数行テキスト一括貼り付け（改行ごとにフレーズ化）
        // 登録モード: 追記（既存を保持・既定）/ 全置換（旧実装の無言全消しを明示化）
        const handleApplyBulkText = () => {
            const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
            if (lines.length === 0) return;

            const totalDur = Math.max(16, analysisDurationSec || 32);
            const step = totalDur / lines.length;
            const mkLines = (baseSec: number) => ensureLyricIds(lines.map((text, i) => ({
                time: Number((baseSec + i * step).toFixed(1)),
                duration: Number(Math.max(1, step * 0.9).toFixed(1)),
                text,
            })));

            if (bulkMode === 'replace') {
                onUpdateLyrics(mkLines(0));
                setNotice(dx.noticeBulkReplaced(lines.length, lyrics.length));
            } else {
                const startBase = sorted.length > 0
                    ? sorted[sorted.length - 1].time + (sorted[sorted.length - 1].duration ?? 4.0)
                    : 0;
                onUpdateLyrics([...lyrics, ...mkLines(startBase)]);
                setNotice(dx.noticeBulkAppended(lines.length, startBase.toFixed(1)));
            }
            setBulkText('');
            setShowBulkInput(false);
            setTimeout(() => setNotice(null), 3000);
        };

        // 📂 LRC 読み込み／書き出し
        const handleImportLrc = (file: File) => {
            const reader = new FileReader();
            reader.onload = (evt) => {
                const text = evt.target?.result as string;
                if (!text) return;
                const parsed = parseLrc(text);
                if (parsed.length === 0) {
                    setNotice(dx.noticeLrcNoStamps);
                } else {
                    // バグ修正: インポート時に id を採番してUI編集の安定参照を保証
                    onUpdateLyrics(ensureLyricIds(parsed));
                    setNotice(dx.noticeLrcLoaded(parsed.length));
                }
                setTimeout(() => setNotice(null), 3000);
            };
            reader.readAsText(file);
        };

        const handleExportLrc = () => {
            const blob = new Blob([toLrc(lyrics)], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'lyrics.lrc';
            a.click();
            URL.revokeObjectURL(url);
        };

        const updateStyleField = <K extends keyof LyricGlobalStyle>(key: K, val: LyricGlobalStyle[K]) => {
            onUpdateLyricStyle?.({ ...lyricStyle, [key]: val });
        };

        const animOptions: Array<{ id: LyricAnimationKind; label: string }> = [
            { id: 'none', label: dx.animNone },
            { id: 'fadeUp', label: dx.animFadeUp },
            { id: 'typewriter', label: dx.animTypewriter },
            { id: 'pop', label: dx.animPop },
            { id: 'slideIn', label: dx.animSlide },
        ];

        const posOptions: Array<{ id: LyricPositionKind; label: string }> = [
            { id: 'bottom', label: dx.posBottom },
            { id: 'center', label: dx.posCenter },
            { id: 'top', label: dx.posTop },
        ];

        return (
            <Section
                title={dx.secLyrics(lyrics.length)}
                color="#f472b6"
                icon={<IconMic size={12} color="#f472b6" />}
                sectionId="lyrics"
                defaultOpen={true}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* 🎤 AI文字起こし＆自動配置（設定モーダル起動）ボタン */}
                    <div style={{ padding: '8px 10px', background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.35)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 10, fontWeight: 900, color: '#818cf8', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <IconSparkles size={11} color="#818cf8" />
                                <span>{dx.aiTranscribe}</span>
                            </span>
                        </div>
                        <button
                            onClick={() => onOpenVocalAnalysisModal?.()}
                            title={dx.titleAiTranscribe}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'linear-gradient(135deg, #4338ca, #6366f1)', color: '#e7edf4', border: 'none', borderRadius: 4, padding: '6px 10px', fontSize: 10, fontWeight: 900, cursor: 'pointer', boxShadow: '0 2px 8px rgba(99, 102, 241, 0.35)' }}
                        >
                            <IconSparkles size={12} color="#e7edf4" />
                            <span>{dx.aiTranscribeLong}</span>
                        </button>
                    </div>

                    {/* ⏱ 全体タイミング補正（AI 文字起こし後のズレを一括補正） */}
                    <div style={{ padding: '6px 10px', background: 'rgba(148, 163, 184, 0.08)', border: '1px solid rgba(148, 163, 184, 0.25)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 800 }}>{dx.globalTimingFix}</span>
                        {([-0.1, 0.1] as const).map((d) => (
                            <button
                                key={d}
                                onClick={() => applyGlobalOffset(d)}
                                title={dx.titleShiftAll(d > 0 ? '+' : '−')}
                                style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: 3, padding: '2px 8px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}
                            >
                                {dx.btnShiftAll(d > 0 ? '+' : '−')}
                            </button>
                        ))}
                        {lastShift !== 0 && (
                            <button
                                onClick={undoGlobalOffset}
                                title={dx.titleUndoShift(`${lastShift > 0 ? '+' : ''}${lastShift}`)}
                                style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(148, 163, 184, 0.15)', color: '#cbd5e1', border: '1px solid #64748b', borderRadius: 3, padding: '2px 7px', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}
                            >
                                <IconUndo size={9} color="#cbd5e1" />
                                <span>{dx.btnUndoShift}</span>
                            </button>
                        )}
                    </div>

                    {/* ツールバー（一括貼り付け・LRC・追加・スタイル） */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button
                            onClick={() => setShowBulkInput((v) => !v)}
                            title={dx.titleBulkPaste}
                            style={{ background: showBulkInput ? '#be185d' : '#1e293b', color: '#fbcfe8', border: '1px solid #475569', borderRadius: 4, padding: '3px 7px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}
                        >
                            {dx.btnBulkPaste}
                        </button>
                        <button
                            onClick={addLyricAndFocus}
                            title={dx.titleAddPhrase}
                            style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#2563eb', color: '#e7edf4', border: 'none', borderRadius: 4, padding: '3px 7px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}
                        >
                            <IconPlus size={9} color="#e7edf4" />
                            <span>{dx.btnAddPhrase}</span>
                        </button>
                        <button
                            onClick={() => setStyleOpen((v) => !v)}
                            title={dx.titleStyleKaraoke}
                            style={{ background: styleOpen ? 'rgba(244,114,182,0.2)' : '#1e293b', color: '#f472b6', border: `1px solid ${styleOpen ? '#f472b6' : '#475569'}`, borderRadius: 4, padding: '3px 7px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}
                        >
                            {dx.btnStyleKaraoke}
                        </button>
                    </div>

                    {/* 一括テキスト入力エリア */}
                    {showBulkInput && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px', background: '#0a0d14', border: '1px solid #db2777', borderRadius: 6 }}>
                            <span style={{ fontSize: 9, color: '#f472b6', fontWeight: 800 }}>{dx.bulkPasteLabel}</span>
                            <textarea
                                value={bulkText}
                                onChange={(e) => setBulkText(e.target.value)}
                                rows={5}
                                placeholder={dx.phBulkPaste}
                                style={{ ...codeAreaStyle, fontSize: 10 }}
                            />
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 800 }}>{dx.bulkModeLabel}</span>
                                <button
                                    onClick={() => setBulkMode('append')}
                                    title={dx.titleBulkAppend}
                                    style={{ background: bulkMode === 'append' ? '#2563eb' : '#1e293b', color: '#e7edf4', border: '1px solid #475569', borderRadius: 3, padding: '2px 7px', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}
                                >
                                    {dx.bulkAppend}
                                </button>
                                <button
                                    onClick={() => setBulkMode('replace')}
                                    title={dx.titleBulkReplace}
                                    style={{ background: bulkMode === 'replace' ? '#dc2626' : '#1e293b', color: '#e7edf4', border: '1px solid #475569', borderRadius: 3, padding: '2px 7px', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}
                                >
                                    {dx.bulkReplace}
                                </button>
                            </div>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                <button onClick={() => setShowBulkInput(false)} style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 9.5, cursor: 'pointer' }}>{dx.btnCancel}</button>
                                <button onClick={handleApplyBulkText} style={{ background: bulkMode === 'replace' ? '#dc2626' : '#db2777', color: '#e7edf4', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 9.5, fontWeight: 800, cursor: 'pointer' }}>{bulkMode === 'replace' ? dx.btnApplyReplace : dx.btnApplyAppend}</button>
                            </div>
                        </div>
                    )}

                    {/* スタイル・カラオケ設定パネル */}
                    {styleOpen && (
                        <div style={{ padding: '8px 10px', background: '#111622', border: '1px solid #2a3650', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 800 }}>{dx.vPosLabel}</span>
                                <div style={{ display: 'flex', gap: 2 }}>
                                    {posOptions.map((p) => (
                                        <button
                                            key={p.id}
                                            onClick={() => updateStyleField('position', p.id)}
                                            style={{ background: (lyricStyle.position ?? 'bottom') === p.id ? '#db2777' : '#1e293b', color: '#e7edf4', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 9, cursor: 'pointer' }}
                                        >
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 800 }}>{dx.animationLabel}</span>
                                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                    {animOptions.map((a) => (
                                        <button
                                            key={a.id}
                                            onClick={() => updateStyleField('animation', a.id)}
                                            style={{ background: (lyricStyle.animation ?? 'fadeUp') === a.id ? '#db2777' : '#1e293b', color: '#e7edf4', border: 'none', borderRadius: 3, padding: '2px 5px', fontSize: 8.5, cursor: 'pointer' }}
                                        >
                                            {a.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <input
                                        type="checkbox"
                                        checked={lyricStyle.karaokeEnabled ?? false}
                                        onChange={(e) => updateStyleField('karaokeEnabled', e.target.checked)}
                                        style={{ accentColor: '#f472b6' }}
                                    />
                                    <span style={{ fontSize: 9.5, color: '#cbd5e1', fontWeight: 800 }}>{dx.karaokeFill}</span>
                                </label>
                                {(lyricStyle.karaokeEnabled ?? false) && (
                                    <input
                                        type="color"
                                        value={lyricStyle.karaokeColor ?? '#38bdf8'}
                                        onChange={(e) => updateStyleField('karaokeColor', e.target.value)}
                                        style={{ width: 26, height: 18, border: '1px solid #334155', borderRadius: 3, background: 'transparent', cursor: 'pointer' }}
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* 通知メッセージ */}
                    {notice && (
                        <div style={{ fontSize: 9, color: '#f472b6', background: 'rgba(244,114,182,0.1)', padding: '4px 6px', borderRadius: 4 }}>
                            {notice}
                        </div>
                    )}

                    {/* 歌詞リスト - カード型縦積み（横幅を最大限確保） */}
                    <div
                        ref={listRef}
                        onWheel={() => {
                            // 手動スクロール中は追従を一時停止（再生開始で自動復帰）
                            if (Date.now() > programmaticScrollUntilRef.current) followRef.current = false;
                        }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 520, overflowY: 'auto', paddingRight: 2 }}
                    >
                        {sorted.map((l, idx) => {
                            const stableKey = l.id ? l.id : `lyric_${idx}_${l.time}`;
                            const dur = l.duration ?? 4.0;
                            const lyricId = l.id || `ly_${l.time}`;
                            const isOverlapping = overlappingIds.has(lyricId) || (l.id != null && overlappingIds.has(l.id));
                            const isCurrent = currentLyricId === l.id || currentLyricId === lyricId;
                            const isPreviewRow = l.id != null && previewingLyricId === l.id;
                            return (
                                <div
                                    key={stableKey}
                                    data-lyric-row={lyricId}
                                    ref={(el) => {
                                        if (el) {
                                            rowRefs.current.set(lyricId, el);
                                            if (l.id) rowRefs.current.set(l.id, el);
                                        } else {
                                            rowRefs.current.delete(lyricId);
                                            if (l.id) rowRefs.current.delete(l.id);
                                        }
                                    }}
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 4,
                                        background: isCurrent ? 'rgba(244,114,182,0.08)' : '#12161f',
                                        border: `1px solid ${isCurrent ? '#f472b6' : '#232d3d'}`,
                                        borderRadius: 5,
                                        padding: '5px 7px',
                                        transition: 'border 0.2s ease, box-shadow 0.2s ease',
                                    }}
                                >
                                    {/* 上段: 歌詞テキスト全文（大きく編集しやすく） */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontSize: 8.5, color: '#64748b', fontWeight: 800, flex: '0 0 auto', minWidth: 18 }}>
                                            #{idx + 1}
                                        </span>
                                        {isOverlapping && (
                                            <span title={dx.warnOverlap} style={{ display: 'flex', flex: '0 0 auto' }}>
                                                <IconAlertTriangle size={11} color="#fbbf24" />
                                            </span>
                                        )}
                                        <input
                                            type="text"
                                            value={l.text}
                                            onChange={(e) => updateLyricText(lyricId, e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.nativeEvent.isComposing || (e as any).isComposing || e.keyCode === 229) {
                                                    return;
                                                }
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    const inputEl = e.target as HTMLInputElement;
                                                    const selStart = inputEl.selectionStart;
                                                    if (e.shiftKey && selStart !== null && selStart > 0 && selStart < (l.text || '').length) {
                                                        if (l.id) splitLyricAtCursor(l.id, selStart);
                                                    } else {
                                                        inputEl.blur();
                                                    }
                                                }
                                            }}
                                            data-lyric-id={l.id}
                                            style={{ flex: 1, minWidth: 0, background: '#0a0d14', border: '1px solid #334155', color: '#e7edf4', padding: '4px 6px', fontSize: 11, borderRadius: 3, outline: 'none' }}
                                            placeholder={dx.phLyricText}
                                        />
                                        <button onClick={() => l.id && splitLyricAtCursor(l.id)} title={dx.titleSplitAtCursor} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, flex: '0 0 auto', display: 'flex' }}>
                                            <IconScissors size={12} color="#38bdf8" />
                                        </button>
                                        <button onClick={() => l.id && mergeLyricWithNext(l.id)} disabled={idx >= sorted.length - 1} title={idx < sorted.length - 1 ? dx.titleMergeNext : dx.titleMergeDisabled} style={{ background: 'transparent', border: 'none', cursor: idx < sorted.length - 1 ? 'pointer' : 'default', padding: 3, flex: '0 0 auto', display: 'flex', opacity: idx < sorted.length - 1 ? 1 : 0.3 }}>
                                            <IconMerge size={12} color="#94a3b8" />
                                        </button>
                                        <button onClick={() => l.id && duplicateLyric(l.id)} title={dx.titleDuplicate} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, flex: '0 0 auto', display: 'flex' }}>
                                            <IconCopy size={12} color="#94a3b8" />
                                        </button>
                                        <button onClick={() => l.id && deleteLyric(l.id)} title={dx.titleDelete} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, flex: '0 0 auto', display: 'flex' }}>
                                            <IconTrash size={12} color="#ef4444" />
                                        </button>
                                    </div>

                                    {/* 下段: 開始 / 持続秒数 + 設定 + 区間ボタン */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                            <span style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 800 }}>{dx.labelStartShort}</span>
                                            <button
                                                onClick={() => l.id && updateLyricTime(l.id, Math.max(0, Number((l.time - 0.1).toFixed(2))))}
                                                title={dx.titleDecSec}
                                                style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 3, padding: '0 4px', fontSize: 10, fontWeight: 800, cursor: 'pointer', height: 18, lineHeight: '16px', flex: '0 0 auto' }}
                                            >−</button>
                                            <NumberField
                                                value={l.time}
                                                onCommit={(v) => l.id && updateLyricTime(l.id, v)}
                                                min={0}
                                                fallback={0}
                                                style={{ ...inputStyle, width: 48, padding: '2px 4px', textAlign: 'right' }}
                                                title={dx.titleStartInput}
                                            />
                                            <button
                                                onClick={() => l.id && updateLyricTime(l.id, Number((l.time + 0.1).toFixed(2)))}
                                                title={dx.titleIncSec}
                                                style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 3, padding: '0 4px', fontSize: 10, fontWeight: 800, cursor: 'pointer', height: 18, lineHeight: '16px', flex: '0 0 auto' }}
                                            >+</button>
                                            <span style={{ fontSize: 8, color: '#64748b' }}>s</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                            <span style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 800 }}>{dx.labelDurShort}</span>
                                            <button
                                                onClick={() => l.id && updateLyricDuration(l.id, Math.max(0.5, Number((dur - 0.1).toFixed(2))))}
                                                title={dx.titleDecSec}
                                                style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 3, padding: '0 4px', fontSize: 10, fontWeight: 800, cursor: 'pointer', height: 18, lineHeight: '16px', flex: '0 0 auto' }}
                                            >−</button>
                                            <NumberField
                                                value={dur}
                                                onCommit={(v) => l.id && updateLyricDuration(l.id, v)}
                                                min={0.5}
                                                fallback={4}
                                                style={{ ...inputStyle, width: 44, padding: '2px 4px', textAlign: 'right' }}
                                                title={dx.titleDurInput}
                                            />
                                            <button
                                                onClick={() => l.id && updateLyricDuration(l.id, Number((dur + 0.1).toFixed(2)))}
                                                title={dx.titleIncSec}
                                                style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 3, padding: '0 4px', fontSize: 10, fontWeight: 800, cursor: 'pointer', height: 18, lineHeight: '16px', flex: '0 0 auto' }}
                                            >+</button>
                                            <span style={{ fontSize: 8, color: '#64748b' }}>s</span>
                                        </div>
                                        {onPhrasePreview && lyricId && (
                                            <button
                                                onClick={() => {
                                                    // 直前フレーズ末尾との重なりを避けて前戻り開始位置を決定
                                                    const prevEnd = idx > 0
                                                        ? sorted[idx - 1].time + (sorted[idx - 1].duration ?? 4.0)
                                                        : undefined;
                                                    const win = computePhrasePreviewWindow(l.time, dur, undefined, undefined, prevEnd);
                                                    onPhrasePreview(win.startSec, win.endSec, lyricId);
                                                }}
                                                title={isPreviewRow ? dx.titlePreviewStop : dx.titlePreviewPlay}
                                                style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 3, padding: 0, width: 24, height: 20, cursor: 'pointer', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            >
                                                {isPreviewRow
                                                    ? <IconStop size={9} color="#f87171" />
                                                    : <IconPlay size={9} color="#4ade80" />}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => l.id && setTimeFromCurrent(l.id)}
                                            title={dx.titleSetFromPlayhead}
                                            style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 3, padding: '2px 6px', fontSize: 8.5, fontWeight: 800, cursor: 'pointer', flex: '0 0 auto' }}
                                        >
                                            {dx.btnSetFromCurrent}
                                        </button>
                                        <div style={{ flex: 1 }} />
                                        <span style={{ fontSize: 8, color: '#475569' }}>
                                            {dx.labelEndsAt((l.time + dur).toFixed(1))}
                                        </span>
                                    </div>

                                    {/* アクション行: 挿入 / カーソル位置で分割 / 隣接行の結合（AI 区切り修正用） */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                        <button onClick={() => l.id && insertAfterAndFocus(l.id)} title={dx.titleInsertAfter} style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 3, padding: '1px 6px', fontSize: 8.5, fontWeight: 800, cursor: 'pointer' }}>
                                            <IconPlus size={9} color="#4ade80" />
                                            <span>{dx.btnInsert}</span>
                                        </button>
                                        <button onClick={() => l.id && splitLyricAtCursor(l.id)} title={dx.titleSplitAtCursor} style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 3, padding: '1px 6px', fontSize: 8.5, fontWeight: 800, cursor: 'pointer' }}>
                                            <IconScissors size={9} color="#38bdf8" />
                                            <span>{dx.btnSplit}</span>
                                        </button>
                                        {idx < sorted.length - 1 && (
                                            <button onClick={() => l.id && mergeLyricWithNext(l.id)} title={dx.titleMergeAfter} style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 3, padding: '1px 6px', fontSize: 8.5, fontWeight: 800, cursor: 'pointer' }}>
                                                <IconMerge size={9} color="#fbbf24" />
                                                <span>{dx.btnMergeNext}</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {lyrics.length === 0 && (
                            <div style={{ fontSize: 9.5, color: '#64748b', textAlign: 'center', padding: '20px 0' }}>
                                {dx.emptyLyricsHint}
                            </div>
                        )}
                    </div>

                    {/* LRC 入出力 */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 4, padding: '2px 6px', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>
                            <IconFolder size={9} color="#cbd5e1" />
                            <span>{dx.btnLrcImport}</span>
                            <input type="file" accept=".lrc,.txt" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportLrc(f); e.target.value = ''; }} />
                        </label>
                        <button onClick={handleExportLrc} disabled={lyrics.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 4, padding: '2px 6px', fontSize: 9, fontWeight: 800, cursor: lyrics.length > 0 ? 'pointer' : 'not-allowed', opacity: lyrics.length > 0 ? 1 : 0.5 }}>
                            <IconDownload size={9} color="#cbd5e1" />
                            <span>{dx.btnLrcExport}</span>
                        </button>
                    </div>
                </div>
            </Section>
        );
    };

/** AI (MCP) 連携セクション */
const McpIntegrationSection: React.FC<{
    config: MvProjectConfig;
    currentScene: MvScene | null;
    bpm: number;
}> = ({ config, currentScene, bpm }) => {
    const { t } = useI18n();
    const [copied, setCopied] = useState(false);

    // AI エージェント向けの WebMCP 3D シーン生成プロンプト
    const generateAiPrompt = () => {
        return `Create a daytime Minecraft-inspired low-poly voxel world for my music video. Use a wide elevated landscape filled with stylized blocky green trees, dark teal terrain, soft blue fog, a pale blue sky, and a warm sun in the distance. Add a simple hilltop landmark with thin glowing orbital rings around it. Keep the scene spacious, cinematic, and layered from the foreground trees to the distant hills. Do not include water or dense buildings. Keep the bottom area dark and uncluttered for lyrics.  
Please actively use the available WebMCP tools. Render a real screenshot after creating the scene, inspect it visually, and adjust the camera, lighting, fog, tree placement, and composition until the result looks polished and cinematic. Do not stop at technical validation alone.`;
    };

    const handleCopyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(generateAiPrompt());
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch (e) {
            console.error('Failed to copy AI prompt:', e);
        }
    };

    return (
        <Section
            title={t.secMcp}
            color="#60a5fa"
            icon={<IconSparkles size={12} color="#60a5fa" />}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                {/* WebMCP (サイトツール) ステータスカード */}
                <div
                    style={{
                        padding: '8px 10px',
                        background: 'rgba(56, 189, 248, 0.10)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        borderRadius: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                                style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: '50%',
                                    background: '#38bdf8',
                                    boxShadow: '0 0 6px #38bdf8',
                                }}
                            />
                            <span style={{ fontSize: 10, fontWeight: 900, color: '#38bdf8' }}>
                                {t.webMcpBadge(WEB_MCP_TOOLS.length)}
                            </span>
                        </div>
                        <span style={{ fontSize: 8.5, fontWeight: 800, color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '2px 5px', borderRadius: 3 }}>
                            {t.webMcpNative}
                        </span>
                    </div>

                    <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.4 }}>
                        {t.webMcpDesc}
                    </div>

                    {/* 公開ツールバッジ一覧 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                        {WEB_MCP_TOOLS.map((tool) => (
                            <span
                                key={tool.name}
                                style={{
                                    fontSize: 8.5,
                                    fontFamily: 'monospace',
                                    color: '#bae6fd',
                                    background: 'rgba(14, 165, 233, 0.15)',
                                    border: '1px solid rgba(56, 189, 248, 0.25)',
                                    borderRadius: 3,
                                    padding: '1px 4px',
                                }}
                            >
                                {tool.name}
                            </span>
                        ))}
                    </div>
                </div>

                {/* AI プロンプトコピー */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 9.5, color: '#94a3b8', lineHeight: 1.4 }}>
                        {t.aiPromptDesc}
                    </span>
                    <button
                        onClick={() => { void handleCopyPrompt(); }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 5,
                            background: copied ? 'linear-gradient(135deg, #059669, #34d399)' : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                            color: '#e7edf4',
                            border: 'none',
                            borderRadius: 5,
                            padding: '6px 10px',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        <IconCopy size={11} color="#e7edf4" />
                        <span>{copied ? t.aiPromptCopied : t.aiPromptCopy}</span>
                    </button>
                </div>
            </div>
        </Section>
    );
};

/** コードエリア共通スタイル */
const codeAreaStyle: React.CSSProperties = {
    background: '#090b10',
    border: '1px solid #283548',
    borderRadius: 6,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: 10.5,
    padding: 8,
    outline: 'none',
    resize: 'vertical',
    width: '100%',
    boxSizing: 'border-box',
};
