import React, { useEffect, useState } from 'react';
import { native } from '../native';

export interface PluginScannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScanComplete?: () => void;
}

export function PluginScannerModal({ isOpen, onClose, onScanComplete }: PluginScannerModalProps) {
    const [progress, setProgress] = useState(0);
    const [currentPlugin, setCurrentPlugin] = useState('プラグインスキャンプロセスを待機しています...');
    const [logs, setLogs] = useState<Array<{ time: string; text: string }>>([]);
    const [isScanning, setIsScanning] = useState(false);

    const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const addLog = (text: string) => {
        const now = new Date();
        const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
        setLogs((prev) => [...prev.slice(-40), { time: timeStr, text }]);
    };

    useEffect(() => {
        if (!isOpen) return;

        setIsScanning(true);
        setProgress(0);
        setCurrentPlugin('プラグインスキャンプロセスを待機しています...');
        setLogs([]);
        addLog('プラグインスキャンプロセスをスタートしています...');

        // C++ からのリアルタイム進捗イベントを購読
        let handleProgress: [string, number] | undefined;
        try {
            if (window.__JUCE__?.backend?.addEventListener) {
                handleProgress = window.__JUCE__.backend.addEventListener('pluginScanProgress', (payload: unknown) => {
                    const data = payload as { progress: number; pluginName: string; completed: boolean };
                    if (data) {
                        setProgress(Math.min(100, Math.max(0, Math.round(data.progress * 100))));
                        if (data.pluginName) {
                            setCurrentPlugin(`${data.pluginName} を検証中...`);
                            addLog(`${data.pluginName} をスキャンしています...`);
                        }
                        if (data.completed) {
                            setIsScanning(false);
                            addLog('すべてのプラグインのスキャンが正常に完了しました。');
                            setTimeout(() => {
                                onScanComplete?.();
                                onClose();
                            }, 600);
                        }
                    }
                });
            }
        } catch (e) {
            console.error(e);
        }

        // スキャンを開始
        native.scanPlugins().catch((err) => {
            addLog(`スキャン開始エラー: ${String(err)}`);
            setIsScanning(false);
        });

        return () => {
            if (handleProgress && window.__JUCE__?.backend?.removeEventListener) {
                window.__JUCE__.backend.removeEventListener(handleProgress);
            }
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleCancel = async () => {
        try {
            await native.cancelPluginScan();
        } catch (e) {
            console.error(e);
        }
        setIsScanning(false);
        onClose();
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(10, 13, 20, 0.75)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 99999,
                animation: 'fadeIn 0.2s ease-out',
            }}
        >
            <div
                style={{
                    width: 520,
                    backgroundColor: '#1a1f29',
                    borderRadius: 10,
                    border: '1px solid #2d3748',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    color: '#e2e8f0',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                }}
            >
                {/* 🪟 ウィンドウヘッダー */}
                <div
                    style={{
                        padding: '10px 14px',
                        backgroundColor: '#141821',
                        borderBottom: '1px solid #232b38',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        userSelect: 'none',
                    }}
                >
                    <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#ff5f56' }} />
                        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#ffbd2e' }} />
                        <div style={{ width: 11, height: 11, borderRadius: '50%', backgroundColor: '#27c93f' }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#a0aec0', letterSpacing: 0.5 }}>
                        プラグインスキャナー
                    </span>
                    <div style={{ width: 45 }} />
                </div>

                {/* 📦 メインコンテンツ */}
                <div style={{ padding: '20px 22px' }}>
                    {/* 現在のスキャン対象 */}
                    <div
                        style={{
                            fontSize: 13,
                            color: '#cbd5e0',
                            marginBottom: 12,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            fontWeight: 500,
                        }}
                    >
                        {currentPlugin}
                    </div>

                    {/* プログレスバー */}
                    <div
                        style={{
                            width: '100%',
                            height: 12,
                            backgroundColor: '#0d1117',
                            borderRadius: 6,
                            overflow: 'hidden',
                            border: '1px solid #283344',
                            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
                            position: 'relative',
                            marginBottom: 18,
                        }}
                    >
                        <div
                            style={{
                                width: `${progress}%`,
                                height: '100%',
                                background: 'linear-gradient(90deg, #1e90ff 0%, #00d2d3 100%)',
                                borderRadius: 6,
                                transition: 'width 0.15s ease-out',
                                boxShadow: '0 0 10px rgba(30, 144, 255, 0.5)',
                            }}
                        />
                    </div>

                    {/* タイムスタンプ付きスキャンログ */}
                    <div
                        style={{
                            height: 120,
                            backgroundColor: '#0c0f14',
                            borderRadius: 6,
                            border: '1px solid #1f2733',
                            padding: '8px 12px',
                            overflowY: 'auto',
                            fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            fontSize: 11,
                            color: '#8b9bb4',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            marginBottom: 18,
                        }}
                    >
                        {logs.map((log, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10 }}>
                                <span style={{ color: '#576574', flexShrink: 0 }}>{log.time}</span>
                                <span style={{ color: '#cbd5e1', wordBreak: 'break-all' }}>{log.text}</span>
                            </div>
                        ))}
                    </div>

                    {/* 🔘 アクションボタン */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                        <button
                            onClick={handleCancel}
                            style={{
                                backgroundColor: '#2d3748',
                                color: '#e2e8f0',
                                border: '1px solid #4a5568',
                                borderRadius: 5,
                                padding: '6px 16px',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3e4a5d')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#2d3748')}
                        >
                            キャンセル
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
