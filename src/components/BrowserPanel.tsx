import React, { useEffect, useState } from 'react';
import { native } from '../native';
import {
    IconClose,
    IconPiano,
    IconPlugin,
    IconSynth,
    IconZap,
    IconMicrophone,
    IconSearch,
    IconSliders,
    IconPlay,
    IconFolder,
    IconFolderOpen,
    IconFile,
    IconFileMusic,
    IconWaveform,
} from './Icons';
import { PluginScannerModal } from './PluginScannerModal';
import { useTheme } from '../hooks/useTheme';
import { withAlpha } from '../theme';

export interface ScannedPlugin {
    id: string;
    name: string;
    manufacturer: string;
    category: string;
    format: string;
}

interface BrowserPanelProps {
    width?: number;
    isOpen: boolean;
    onClose: () => void;
    onOpenVirtualAnalog: () => void;
    onAddVirtualAnalogTrack?: () => void;
    onOpenIntervalSequencer: () => void;
    onOpenVoiceChanger: () => void;
    voices?: Array<{ name: string; noteCount?: number }>;
    selectedVoiceIndex?: number;
    onSelectVoice?: (index: number) => void;
}

export const BrowserPanel: React.FC<BrowserPanelProps> = ({
    width = 290,
    isOpen,
    onClose,
    onOpenVirtualAnalog,
    onAddVirtualAnalogTrack,
    onOpenIntervalSequencer,
    onOpenVoiceChanger,
    voices = [],
    selectedVoiceIndex = 0,
    onSelectVoice,
}) => {
    const [category, setCategory] = useState<'instrument' | 'effect' | 'loop' | 'file'>('instrument');
    const [scannedPlugins, setScannedPlugins] = useState<ScannedPlugin[]>([]);
    const [showScanner, setShowScanner] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { theme } = useTheme();

    const refreshPlugins = async () => {
        try {
            const list = await native.getScannedPlugins();
            if (Array.isArray(list)) setScannedPlugins(list as ScannedPlugin[]);
        } catch { /* noop */ }
    };

    useEffect(() => {
        if (isOpen) {
            refreshPlugins();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const filteredPlugins = scannedPlugins.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.manufacturer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <aside
            style={{
                width: width,
                minWidth: 200,
                maxWidth: 560,
                height: '100%',
                background: theme.bgPanel,
                borderLeft: `1px solid ${theme.border}`,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                zIndex: 40,
                userSelect: 'none',
                flexShrink: 0,
                boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.4)',
                animation: 'browserSlideIn 0.12s ease-out',
            }}
            aria-label="ブラウザーパネル"
        >
            {/* 🏷️ パネルヘッダー */}
            <div
                style={{
                    height: 38,
                    minHeight: 38,
                    background: theme.bgHeader,
                    borderBottom: `1px solid ${theme.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 12px',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#f1f5f9', fontSize: 12, fontWeight: 900, letterSpacing: '0.3px' }}>
                    {category === 'effect' ? <IconPlugin size={14} color="#70a1ff" /> : <IconPiano size={14} color="#70a1ff" />}
                    <span>ブラウザー (BROWSE)</span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    title="ブラウザーを閉じる"
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#718096',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 3,
                        borderRadius: 4,
                    }}
                >
                    <IconClose size={14} color="#a0aec0" />
                </button>
            </div>

            {/* 📑 タブセレクター */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: `1px solid ${theme.border}`, background: theme.bgTimeline }}>
                {([
                    ['instrument', '音源'],
                    ['effect', 'エフェクト'],
                    ['loop', 'ループ'],
                    ['file', 'ファイル'],
                ] as const).map(([value, label]) => {
                    const active = category === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setCategory(value)}
                            style={{
                                border: 'none',
                                borderBottom: active ? `2px solid ${theme.accentSecondary}` : '2px solid transparent',
                                background: active ? theme.bgControl : 'transparent',
                                color: active ? theme.textMain : theme.textMuted,
                                padding: '8px 2px',
                                cursor: 'pointer',
                                fontSize: 10.5,
                                fontWeight: active ? 900 : 700,
                                transition: 'all 0.1s',
                            }}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>

            {/* 📦 タブコンテンツ領域 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* 🎹 音源タブ */}
                {category === 'instrument' && (
                    <>
                        <div style={{ color: '#829ab1', fontSize: 9.5, fontWeight: 900, letterSpacing: '1px' }}>
                            内蔵音源 ＆ シーケンサー
                        </div>

                        {/* ⚡️ インターバル・シーケンサー */}
                        <button
                            type="button"
                            onClick={onOpenIntervalSequencer}
                            title="クリックで開く。度数グリッドで耳からリフを作成。"
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '10px 9px',
                                textAlign: 'left',
                                color: '#f8fafc',
                                background: '#162231',
                                border: '1px solid #0284c7',
                                borderRadius: 6,
                                cursor: 'pointer',
                            }}
                        >
                            <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', background: '#0284c7', borderRadius: 5 }}>
                                <IconZap size={15} color="#ffffff" />
                            </span>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span style={{ fontSize: 11.5, fontWeight: 900, color: '#38bdf8' }}>インターバル・シーケンサー</span>
                                <span style={{ color: '#94a3b8', fontSize: 9.5 }}>度数グリッド ＆ ADSR音作り</span>
                            </span>
                        </button>

                        {/* 🎹 VA シンセ */}
                        <div
                            onClick={onOpenVirtualAnalog}
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = 'copy';
                                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'virtual-analog' }));
                                e.dataTransfer.setData('application/json', JSON.stringify({ type: 'virtual-analog' }));
                            }}
                            title="クリックで画面を開く。タイムラインへドラッグまたは右の［＋追加］でトラック作成。"
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 10px',
                                textAlign: 'left',
                                color: '#f8fafc',
                                background: '#1c1e17',
                                border: '1px solid #77784f',
                                borderRadius: 6,
                                cursor: 'grab',
                                userSelect: 'none',
                                boxSizing: 'border-box',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                                <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', background: '#596249', borderRadius: 5, flexShrink: 0 }}>
                                    <IconSynth size={15} color="#f4f2ad" />
                                </span>
                                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                    <span style={{ fontSize: 11.5, fontWeight: 900, color: '#dce28a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>VAシンセ (バーチャルアナログ)</span>
                                    <span style={{ color: '#9da485', fontSize: 9.5 }}>2オシレーター・ポリフォニック</span>
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAddVirtualAnalogTrack?.();
                                }}
                                style={{
                                    background: 'linear-gradient(135deg, #596249 0%, #3e4431 100%)',
                                    color: '#f4f2ad',
                                    border: '1px solid #8c966f',
                                    borderRadius: 4,
                                    padding: '4px 8px',
                                    fontSize: 10,
                                    fontWeight: 900,
                                    cursor: 'pointer',
                                    flexShrink: 0,
                                    boxShadow: '0 2px 5px rgba(0,0,0,0.4)',
                                }}
                                title="クリックで新しいVAシンセトラックを1本追加して開く"
                            >
                                ＋追加
                            </button>
                        </div>

                        {/* 🎙️ ボイス音源リスト */}
                        <div style={{ color: '#829ab1', fontSize: 9.5, fontWeight: 900, letterSpacing: '1px', marginTop: 8 }}>
                            ボイス音源ライブラリ ({voices.length})
                        </div>
                        {voices.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {voices.map((v, idx) => {
                                    const isSel = selectedVoiceIndex === idx;
                                    return (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => onSelectVoice?.(idx)}
                                            style={{
                                                width: '100%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '7px 9px',
                                                background: isSel ? withAlpha(theme.accentSecondary, 0.2) : theme.bgControl,
                                                border: `1px solid ${isSel ? theme.accentSecondary : theme.border}`,
                                                borderRadius: 5,
                                                color: isSel ? theme.accentSecondary : theme.textSubtle,
                                                fontSize: 11,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                                <IconMicrophone size={12} color={isSel ? '#3b82f6' : '#64748b'} />
                                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {v.name || `ボイス ${idx + 1}`}
                                                </span>
                                            </div>
                                            <span style={{ fontSize: 9, opacity: 0.7, color: '#94a3b8' }}>
                                                {v.noteCount ?? 0}音
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div style={{ padding: '12px 10px', color: theme.textMuted, background: theme.bgControl, border: `1px dashed ${theme.border}`, borderRadius: 6, fontSize: 10, lineHeight: 1.5, textAlign: 'center' }}>
                                録音した声がここに自動追加されます
                            </div>
                        )}
                    </>
                )}

                {/* 🔌 エフェクトタブ */}
                {category === 'effect' && (
                    <>
                        <div style={{ color: '#829ab1', fontSize: 9.5, fontWeight: 900, letterSpacing: '1px' }}>
                            内蔵プロセッサー
                        </div>

                        {/* 🎙️ ボイスチェンジャー */}
                        <div
                            onClick={onOpenVoiceChanger}
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = 'copy';
                                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'voice-changer' }));
                                e.dataTransfer.setData('application/json', JSON.stringify({ type: 'voice-changer' }));
                            }}
                            title="クリックで専用画面を開く。タイムラインへドラッグして追加。"
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '10px 9px',
                                textAlign: 'left',
                                color: '#f8fafc',
                                background: '#15212d',
                                border: '1px solid #0ea5e9',
                                borderRadius: 6,
                                cursor: 'grab',
                                userSelect: 'none',
                                boxSizing: 'border-box',
                            }}
                        >
                            <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', background: '#0284c7', borderRadius: 5 }}>
                                <IconMicrophone size={15} color="#ffffff" />
                            </span>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span style={{ fontSize: 11.5, fontWeight: 900, color: '#38bdf8' }}>ボイスチェンジャー</span>
                                <span style={{ color: '#94a3b8', fontSize: 9.5 }}>超低遅延・フォルマント＆ピッチ加工</span>
                            </span>
                        </div>

                        {/* 🔌 VST3 プラグイン一覧 */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                            <span style={{ color: '#829ab1', fontSize: 9.5, fontWeight: 900, letterSpacing: '1px' }}>
                                プラグイン ({scannedPlugins.length})
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowScanner(true)}
                                style={{
                                    background: '#1e293b',
                                    border: '1px solid #334155',
                                    borderRadius: 4,
                                    color: '#38bdf8',
                                    fontSize: 9.5,
                                    fontWeight: 800,
                                    padding: '2px 6px',
                                    cursor: 'pointer',
                                }}
                            >
                                スキャン
                            </button>
                        </div>

                        {/* プラグイン検索バー */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: theme.bgInset, border: `1px solid ${theme.border}`, borderRadius: 5, padding: '4px 8px' }}>
                            <IconSearch size={12} color={theme.textMuted} />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="プラグインを検索..."
                                style={{
                                    flex: 1,
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#f1f5f9',
                                    fontSize: 10.5,
                                    outline: 'none',
                                }}
                            />
                        </div>

                        {filteredPlugins.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {filteredPlugins.map((plugin) => (
                                    <div
                                        key={plugin.id}
                                        style={{
                                            padding: '6px 8px',
                                            background: theme.bgControl,
                                            border: `1px solid ${theme.border}`,
                                            borderRadius: 4,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            fontSize: 10.5,
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                            <IconPlugin size={11} color="#70a1ff" />
                                            <span style={{ color: '#f8fafc', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {plugin.name}
                                            </span>
                                        </div>
                                        <span style={{ fontSize: 8.5, color: '#64748b', fontWeight: 700 }}>
                                            {plugin.manufacturer}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ padding: '12px 8px', color: theme.textMuted, background: theme.bgControl, border: `1px dashed ${theme.border}`, borderRadius: 6, fontSize: 10, lineHeight: 1.5, textAlign: 'center' }}>
                                プラグインが見つかりません。「スキャン」を押して VST3 を検出してください。
                            </div>
                        )}
                    </>
                )}

                {/* ループ・ファイルタブ */}
                {(category === 'loop' || category === 'file') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ color: '#829ab1', fontSize: 9.5, fontWeight: 900, letterSpacing: '1px' }}>
                            {category === 'loop' ? 'ループ ＆ サンプル' : 'ファイルブラウザー'}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {/* プロジェクトフォルダ */}
                            <div
                                style={{
                                    padding: '7px 9px',
                                    background: '#161c26',
                                    border: '1px solid #243042',
                                    borderRadius: 5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 7,
                                    color: '#f1f5f9',
                                    fontSize: 11,
                                    fontWeight: 800,
                                }}
                            >
                                <IconFolderOpen size={13} color="#60a5fa" />
                                <span>プロジェクト録音ファイル</span>
                            </div>

                            {/* 録音音声ファイル項目 */}
                            <div style={{ paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {voices.length > 0 ? (
                                    voices.map((v, i) => (
                                        <div
                                            key={i}
                                            draggable
                                            onDragStart={(e) => {
                                                e.dataTransfer.effectAllowed = 'copy';
                                                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'voice-clip', voiceIndex: i }));
                                            }}
                                            style={{
                                                padding: '6px 8px',
                                                background: '#11151e',
                                                border: '1px solid #1e2634',
                                                borderRadius: 4,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                fontSize: 10.5,
                                                color: '#cbd5e1',
                                                cursor: 'grab',
                                            }}
                                            title="タイムラインへドラッグ＆ドロップして配置"
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                                <IconFileMusic size={12} color="#38bdf8" />
                                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {v.name}.wav
                                                </span>
                                            </div>
                                            <span style={{ fontSize: 9, color: '#64748b' }}>WAV</span>
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ padding: '8px 10px', color: '#64748b', fontSize: 10, fontStyle: 'italic' }}>
                                        録音されたオーディオがありません
                                    </div>
                                )}
                            </div>

                            {/* ファクトリープリセット / サンプル素材フォルダ */}
                            <div
                                style={{
                                    marginTop: 6,
                                    padding: '7px 9px',
                                    background: '#161c26',
                                    border: '1px solid #243042',
                                    borderRadius: 5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 7,
                                    color: '#f1f5f9',
                                    fontSize: 11,
                                    fontWeight: 800,
                                }}
                            >
                                <IconFolder size={13} color="#f59e0b" />
                                <span>ファクトリーサンプル素材</span>
                            </div>

                            <div style={{ padding: '10px 8px', color: '#64748b', background: '#0e1117', border: '1px dashed #232d3d', borderRadius: 5, fontSize: 10, lineHeight: 1.5, textAlign: 'center' }}>
                                <IconWaveform size={14} color="#475569" />
                                <div style={{ marginTop: 3 }}>ドラッグ＆ドロップで外部オーディオを追加可能</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 🛡️ プラグインスキャナー */}
            <PluginScannerModal
                isOpen={showScanner}
                onClose={() => setShowScanner(false)}
                onScanComplete={refreshPlugins}
            />
        </aside>
    );
};
