import React, { useCallback, useEffect, useRef, useState } from 'react';
import { native } from '../native';
import {
    IconClose,
    IconGrip,
    IconPlugin,
    IconPlus,
    IconPower,
    IconSearch,
    IconTrash,
    IconMicrophone,
    IconSliders,
} from './Icons';
import { PluginScannerModal } from './PluginScannerModal';
import { FloatingWindow } from './FloatingWindow';

export interface PluginSlotInfo {
    name: string;
    enabled: boolean;
    id: string;
}

export interface ScannedPlugin {
    id: string;
    name: string;
    manufacturer: string;
    category: string;
    format: string;
}

interface FxChainProps {
    trackIdx: number;
    isOpen: boolean;
    onClose: () => void;
    onOpenVoiceChanger?: () => void;
    onOpenEq?: () => void;
    theme?: Record<string, string>;
}

export const FxChain: React.FC<FxChainProps> = ({ trackIdx, isOpen, onClose, onOpenVoiceChanger, onOpenEq, theme: _ }) => {
    const [slots, setSlots] = useState<PluginSlotInfo[]>([]);
    const [scannedPlugins, setScannedPlugins] = useState<ScannedPlugin[]>([]);
    const [showPluginList, setShowPluginList] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [scanning, setScanning] = useState(false);
    const [busyPlugin, setBusyPlugin] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
    const dragStartY = useRef<number>(0);

    const refreshSlots = useCallback(async () => {
        try {
            const list = await native.getTrackPlugins(trackIdx);
            if (Array.isArray(list)) setSlots(list as PluginSlotInfo[]);
        } catch { /* noop */ }
    }, [trackIdx]);

    useEffect(() => {
        if (isOpen) {
            void native.setActiveTrack(trackIdx);
            refreshSlots();
        }
    }, [isOpen, trackIdx, refreshSlots]);

    const handleScan = () => {
        setScanning(true);
        setMessage(null);
    };

    const handleOpenPluginList = async () => {
        if (scannedPlugins.length === 0) {
            try {
                const list = await native.getScannedPlugins();
                if (Array.isArray(list) && list.length > 0) {
                    setScannedPlugins(list as ScannedPlugin[]);
                } else {
                    await handleScan();
                }
            } catch {
                setMessage('プラグイン一覧を取得できませんでした');
            }
        }
        setShowPluginList(true);
    };

    const handleAddPlugin = async (pluginId: string) => {
        setBusyPlugin(pluginId);
        setMessage(null);
        try {
            const ok = await native.addTrackPlugin(trackIdx, pluginId);
            if (!ok) {
                setMessage('プラグインを起動できませんでした。互換性や認証状態を確認してください');
                return;
            }
            setShowPluginList(false);
            setSearchQuery('');
            await refreshSlots();
        } catch {
            setMessage('プラグインを起動できませんでした');
        } finally {
            setBusyPlugin(null);
        }
    };

    const handleRemove = async (slotIdx: number) => {
        setMessage(null);
        try {
            if (!await native.removeTrackPlugin(trackIdx, slotIdx))
                throw new Error('remove failed');
            await refreshSlots();
        } catch {
            setMessage('プラグインを削除できませんでした');
        }
    };

    const stopSlotInteraction = (e: React.SyntheticEvent) => {
        e.stopPropagation();
    };

    const handleToggleEnabled = async (slotIdx: number, current: boolean) => {
        await native.setTrackPluginEnabled(trackIdx, slotIdx, !current);
        await refreshSlots();
    };

    const handleOpenEditor = async (slotIdx: number) => {
        setMessage(null);
        try {
            const ok = await native.openPluginEditor(trackIdx, slotIdx);
            if (!ok) setMessage('プラグイン画面を開けませんでした');
        } catch {
            setMessage('プラグイン画面を開けませんでした');
        }
    };

    // ポインタードラッグで並べ替え
    const handleSlotPointerDown = (e: React.PointerEvent, idx: number) => {
        if ((e.target as HTMLElement).closest('button') !== null) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDraggingIdx(idx);
        dragStartY.current = e.clientY;
    };

    const handleSlotPointerMove = (e: React.PointerEvent, idx: number) => {
        if (draggingIdx === null) return;
        const delta = e.clientY - dragStartY.current;
        const slotH = 40;
        const newIdx = Math.max(0, Math.min(slots.length - 1,
            draggingIdx + Math.round(delta / slotH)));
        if (newIdx !== dragOverIdx) setDragOverIdx(newIdx);
    };

    const handleSlotPointerUp = async () => {
        if (draggingIdx !== null && dragOverIdx !== null && draggingIdx !== dragOverIdx) {
            await native.reorderTrackPlugin(trackIdx, draggingIdx, dragOverIdx);
            await refreshSlots();
        }
        setDraggingIdx(null);
        setDragOverIdx(null);
    };

    const filteredPlugins = scannedPlugins.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.manufacturer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (!isOpen) return null;

    return (
        <FloatingWindow
            title={`INSERT FX - Track ${trackIdx + 1}`}
            icon={<IconPlugin size={14} color="#70a1ff" />}
            isOpen={isOpen}
            onClose={onClose}
            initialWidth={360}
            initialHeight={480}
            minWidth={300}
            minHeight={280}
            zIndex={1200}
        >
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                background: 'linear-gradient(160deg, #1a1e2e 0%, #141720 100%)',
                color: '#e8eaf6',
            }}>

                {/* FX スロットリスト */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                    {/* 🎛️ 常設 4-Band パラメトリック EQ カード */}
                    <div
                        onClick={() => {
                            if (onOpenEq) {
                                onClose();
                                onOpenEq();
                            }
                        }}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 14px',
                            margin: '4px 8px 8px',
                            borderRadius: 8,
                            background: 'linear-gradient(135deg, rgba(20, 60, 55, 0.35) 0%, rgba(10, 35, 30, 0.5) 100%)',
                            border: '1px solid rgba(112, 224, 255, 0.3)',
                            cursor: 'pointer',
                            transition: 'border-color 0.2s, background 0.2s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(112, 224, 255, 0.6)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(112, 224, 255, 0.3)')}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <IconSliders size={16} color="#70e0ff" />
                            <div style={{ minWidth: 0 }}>
                                <div style={{ color: '#70e0ff', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    4-BAND EQ (イコライザー)
                                </div>
                                <div style={{ color: '#78a89a', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    周波数カーブ・音質・リアルタイム補正
                                </div>
                            </div>
                        </div>
                        <button
                            style={{
                                background: '#16594b', color: '#82fff5', border: '1px solid #317968',
                                borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700,
                                cursor: 'pointer', flexShrink: 0, marginLeft: 8,
                            }}
                        >
                            開く
                        </button>
                    </div>

                    {/* 🎙️ DEEP VOICE (内蔵トラック専用ボイスプロセッサー) */}
                    <div
                        onClick={() => {
                            if (onOpenVoiceChanger) {
                                onClose();
                                onOpenVoiceChanger();
                            }
                        }}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 14px',
                            margin: '4px 8px 10px',
                            borderRadius: 8,
                            background: 'linear-gradient(135deg, rgba(30,58,95,0.35) 0%, rgba(15,30,50,0.5) 100%)',
                            border: '1px solid rgba(80,160,240,0.3)',
                            cursor: 'pointer',
                            transition: 'border-color 0.2s, background 0.2s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(100,200,255,0.6)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(80,160,240,0.3)')}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <IconMicrophone size={16} color="#82e5ff" />
                            <div>
                                <div style={{ color: '#82e5ff', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
                                    DEEP VOICE (ボイスプロセッサー)
                                </div>
                                <div style={{ color: '#789aa8', fontSize: 10 }}>
                                    マイク音声をリアルタイムに太く深い美声へ加工
                                </div>
                            </div>
                        </div>
                        <button
                            style={{
                                background: '#164b59', color: '#82f5ff', border: '1px solid #316879',
                                borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700,
                                cursor: 'pointer',
                            }}
                        >
                            開く
                        </button>
                    </div>

                    {slots.length === 0 ? (
                        <div style={{
                            padding: '18px 16px', textAlign: 'center',
                            color: 'rgba(255,255,255,0.3)', fontSize: 12,
                        }}>
                            外部 VST3 / AU プラグインスロットが空です<br />
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>下の「プラグイン追加」から VST3 / AU を挿せます</span>
                        </div>
                    ) : slots.map((slot, idx) => (
                        <div key={idx}
                            onPointerDown={e => handleSlotPointerDown(e, idx)}
                            onPointerMove={e => handleSlotPointerMove(e, idx)}
                            onPointerUp={handleSlotPointerUp}
                            onClick={e => {
                                if ((e.target as HTMLElement).closest('button') !== null)
                                    e.stopPropagation();
                            }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '6px 12px',
                                margin: '2px 8px',
                                borderRadius: 8,
                                background: draggingIdx === idx
                                    ? 'rgba(100,120,255,0.15)'
                                    : dragOverIdx === idx
                                        ? 'rgba(100,120,255,0.08)'
                                        : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${slot.enabled ? 'rgba(80,100,255,0.25)' : 'rgba(255,255,255,0.06)'}`,
                                cursor: 'grab',
                                transition: 'background 0.15s, border-color 0.15s',
                                userSelect: 'none',
                            }}
                        >
                            {/* グリップ SVG */}
                            <IconGrip size={12} color="rgba(255,255,255,0.25)" />

                            {/* ON/OFF 電源ボタン SVG */}
                            <button
                                onMouseDown={stopSlotInteraction}
                                onPointerDown={e => e.stopPropagation()}
                                onClick={() => handleToggleEnabled(idx, slot.enabled)}
                                title={slot.enabled ? 'バイパスする' : '有効にする'}
                                style={{
                                    width: 22, height: 22, borderRadius: '50%',
                                    border: 'none',
                                    background: slot.enabled
                                        ? 'radial-gradient(circle, #5c7cfa, #3d5af1)'
                                        : 'rgba(255,255,255,0.12)',
                                    cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: slot.enabled ? '0 0 8px rgba(92,124,250,0.6)' : 'none',
                                    transition: 'all 0.2s',
                                    flexShrink: 0,
                                }}
                            >
                                <IconPower size={11} color={slot.enabled ? '#ffffff' : 'rgba(255,255,255,0.3)'} />
                            </button>

                            {/* プラグイン名（クリックで GUI ウィンドウを開く） */}
                            <button
                                onMouseDown={stopSlotInteraction}
                                onPointerDown={e => e.stopPropagation()}
                                onClick={() => handleOpenEditor(idx)}
                                style={{
                                    flex: 1, background: 'none', border: 'none',
                                    color: slot.enabled ? '#c5ceff' : 'rgba(255,255,255,0.3)',
                                    fontSize: 12, fontWeight: 500,
                                    textAlign: 'left', cursor: 'pointer',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    padding: 0,
                                    transition: 'color 0.2s',
                                }}
                                title="クリックして GUI を開く"
                            >
                                {slot.name}
                            </button>

                            {/* 削除ボタン SVG */}
                            <button
                                onMouseDown={stopSlotInteraction}
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => {
                                    e.stopPropagation();
                                    void handleRemove(idx);
                                }}
                                title="削除"
                                style={{
                                    background: 'none', border: 'none',
                                    color: 'rgba(255,100,100,0.4)',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: 3,
                                    transition: 'color 0.2s',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.color = '#ff6b6b')}
                                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,100,100,0.4)')}
                            >
                                <IconTrash size={13} />
                            </button>
                        </div>
                    ))}
                </div>

                {/* フッター：追加ボタン + スキャン */}
                <div style={{
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    padding: '10px 12px',
                    display: 'flex', gap: 8,
                    background: 'rgba(0,0,0,0.2)',
                }}>
                    {message && <div style={{ position: 'absolute', transform: 'translateY(-36px)', left: 12, right: 12, color: '#ff9a9a', fontSize: 11, textAlign: 'center' }}>{message}</div>}
                    <button onClick={handleOpenPluginList} style={{
                        flex: 1, padding: '7px 0',
                        background: 'linear-gradient(135deg, #5c7cfa, #3d5af1)',
                        border: 'none', borderRadius: 8,
                        color: '#fff', fontWeight: 700, fontSize: 12,
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        boxShadow: '0 2px 12px rgba(61,90,241,0.4)',
                        transition: 'opacity 0.2s',
                    }} onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    >
                        <IconPlus size={13} color="#ffffff" />
                        プラグイン追加
                    </button>
                    <button onClick={handleScan} disabled={scanning} style={{
                        padding: '7px 12px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        color: scanning ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
                        fontSize: 11, fontWeight: 600,
                        cursor: scanning ? 'wait' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 5,
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap',
                    }}>
                        <IconSearch size={12} color={scanning ? 'rgba(255,255,255,0.3)' : '#70a1ff'} />
                        {scanning ? 'スキャン中...' : 'スキャン'}
                    </button>
                </div>
            </div>

            {/* プラグイン選択モーダル */}
            {showPluginList && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9100,
                    background: 'rgba(0,0,0,0.65)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} onClick={e => { if (e.target === e.currentTarget) setShowPluginList(false); }}>
                    <div style={{
                        width: 440, maxHeight: '72vh',
                        background: 'linear-gradient(160deg, #1e2135 0%, #161825 100%)',
                        border: '1px solid rgba(100,120,255,0.3)',
                        borderRadius: 14,
                        boxShadow: '0 24px 72px rgba(0,0,0,0.8)',
                        display: 'flex', flexDirection: 'column',
                        overflow: 'hidden',
                    }}>
                        <div style={{
                            padding: '14px 16px',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <IconPlugin size={16} color="#70a1ff" />
                                    <div style={{ color: '#e8eaf6', fontWeight: 700, fontSize: 13 }}>
                                        プラグインを選択 (VST3 / AU)
                                    </div>
                                </div>
                                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                                    {filteredPlugins.length} 件検出
                                </span>
                            </div>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '7px 12px',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: 8,
                            }}>
                                <IconSearch size={13} color="rgba(255,255,255,0.4)" />
                                <input
                                    autoFocus
                                    placeholder="名前・メーカー・カテゴリで検索..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    style={{
                                        flex: 1, background: 'transparent',
                                        border: 'none', color: '#e8eaf6', fontSize: 12,
                                        outline: 'none',
                                    }}
                                />
                            </div>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {filteredPlugins.length === 0 ? (
                                <div style={{
                                    padding: '32px 16px', textAlign: 'center',
                                    color: 'rgba(255,255,255,0.3)', fontSize: 12,
                                }}>
                                    {scannedPlugins.length === 0
                                        ? '「スキャン」ボタンを押してプラグインを検出してください'
                                        : '該当するプラグインが見つかりません'}
                                </div>
                            ) : filteredPlugins.map((p, i) => (
                                <button key={i} disabled={busyPlugin !== null} onClick={() => handleAddPlugin(p.id)} style={{
                                    display: 'block', width: '100%',
                                    padding: '10px 16px',
                                    background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                                    textAlign: 'left', cursor: 'pointer',
                                    opacity: busyPlugin !== null && busyPlugin !== p.id ? 0.55 : 1,
                                    transition: 'background 0.15s',
                                }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(92,124,250,0.1)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ color: '#c5ceff', fontWeight: 600, fontSize: 12 }}>{busyPlugin === p.id ? '起動中...' : p.name}</div>
                                        <span style={{
                                            fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
                                            background: p.format.includes('AU') ? 'rgba(255,107,129,0.15)' : 'rgba(112,161,255,0.15)',
                                            color: p.format.includes('AU') ? '#ff6b81' : '#70a1ff',
                                        }}>
                                            {p.format}
                                        </span>
                                    </div>
                                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
                                        {p.manufacturer} {p.category ? `· ${p.category}` : ''}
                                    </div>
                                </button>
                            ))}
                        </div>
                        <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'flex-end' }}>
                            <button onClick={() => setShowPluginList(false)} style={{
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8, color: 'rgba(255,255,255,0.6)',
                                padding: '6px 16px', fontSize: 12, cursor: 'pointer',
                            }}>閉じる</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 🛡️ 隔離プラグインスキャナーダイアログ */}
            <PluginScannerModal
                isOpen={scanning}
                onClose={() => setScanning(false)}
                onScanComplete={async () => {
                    const list = await native.getScannedPlugins();
                    if (Array.isArray(list)) setScannedPlugins(list as ScannedPlugin[]);
                }}
            />
        </FloatingWindow>
    );
};

