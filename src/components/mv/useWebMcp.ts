//==============================================================================
// WebMCP 登録フック (useWebMcp)。
// ブラウザの Model Context Protocol API (navigator.modelContext / window.modelContext)
// およびグローバルオブジェクト (window.__voiventWebMcp) に DAW の操作ツールを自動登録する。
//==============================================================================
import { useEffect, useRef, useState } from 'react';
import type { MvProjectConfig } from './types';
import type { StemAnalysis } from './stemAnalysis/types';
import { WEB_MCP_TOOLS, type WebMcpContext, type WebMcpToolDefinition, type EnergyAnalysisSource, type WebMcpPreviewCapturePort, type WebMcpVideoRenderPort } from './webMcpTools';

interface UseWebMcpArgs {
    config: MvProjectConfig;
    setConfig: React.Dispatch<React.SetStateAction<MvProjectConfig>>;
    bpm: number;
    sessionDuration: number;
    playheadSec: number;
    isPlaying: boolean;
    /** 楽曲解析データ（get_energy_map ツール用）。未ロード時は null */
    analysis: EnergyAnalysisSource | null;
    onSeek: (sec: number) => void;
    onTogglePlay: () => void;
    onStop: () => void;
    /** プレビュー静止画キャプチャポート (get_mv_preview 用)。省略時はツールが未対応を返す */
    getPreviewCapture?: () => WebMcpPreviewCapturePort | null;
    /** シーン選択要求 (select_mv_scene 用)。プレビューは選択中シーンを表示する */
    onSelectScene?: (sceneId: string) => void;
    /** プロジェクトのプリセット JSON ダウンロード要求 (export_mv_project 用)。
     *  未接続時はツールが未対応を返す */
    onExportProject?: (json: string, filename: string) => boolean;
    /** 動画レンダリングポート (render_mv_video 用)。省略時はツールが未対応を返す */
    getVideoRender?: () => WebMcpVideoRenderPort | null;
    /** stem 分離解析結果 (analyze_mv_stems / get_mv_stem_map 用)。未分離時は null */
    getStemAnalysis?: () => StemAnalysis | null;
    /** stem 分離の実行要求 (AI トリガー)。省略時はツールが未対応を返す */
    runStemSeparation?: (force: boolean) => Promise<{
        ok: boolean;
        backend?: string;
        elapsedSec?: number;
        error?: string;
    }>;
    /** マスターゲイン取得・設定。Web 版は UI の状態へ接続する */
    getMasterGain?: () => number;
    setMasterGain?: (gain: number) => void;
}

export interface WebMcpStatus {
    isSupported: boolean;
    isRegistered: boolean;
    tools: WebMcpToolDefinition[];
    lastInvokedTool?: string;
    lastResult?: string;
}

export function useWebMcp({
    config,
    setConfig,
    bpm,
    sessionDuration,
    playheadSec,
    isPlaying,
    analysis,
    onSeek,
    onTogglePlay,
    onStop,
    getPreviewCapture,
    getVideoRender,
    onSelectScene,
    onExportProject,
    getStemAnalysis,
    runStemSeparation,
    getMasterGain,
    setMasterGain,
}: UseWebMcpArgs): WebMcpStatus {
    const [lastInvokedTool, setLastInvokedTool] = useState<string | undefined>();
    const [lastResult, setLastResult] = useState<string | undefined>();
    const [isRegistered, setIsRegistered] = useState(false);

    // 常に最新のコンテキストを参照するための ref
    const contextRef = useRef<WebMcpContext>({
        getConfig: () => config,
        setConfig: (updater) => setConfig(updater),
        getTransport: () => ({ isPlaying, playheadSec, bpm, duration: sessionDuration }),
        getAnalysis: () => analysis,
        onSeek,
        onTogglePlay,
        onStop,
        getPreviewCapture,
        getVideoRender,
        onSelectScene,
        onExportProject,
        getStemAnalysis,
        runStemSeparation,
        getMasterGain: () => {
            if (getMasterGain) return getMasterGain();
            try {
                return (globalThis as any).__webAudioEngine?.getGain?.() ?? 1.0;
            } catch {
                return 1.0;
            }
        },
        setMasterGain: (g: number) => {
            if (setMasterGain) {
                setMasterGain(g);
                return;
            }
            try {
                (globalThis as any).__webAudioEngine?.setGain?.(g);
            } catch { /* noop */ }
        },
    });

    // 各レンダリングで最新値を contextRef に反映
    useEffect(() => {
        contextRef.current = {
            getConfig: () => config,
            setConfig: (updater) => setConfig(updater),
            getTransport: () => ({ isPlaying, playheadSec, bpm, duration: sessionDuration }),
            getAnalysis: () => analysis,
            onSeek,
            onTogglePlay,
            onStop,
            getPreviewCapture,
            getVideoRender,
            onSelectScene,
            onExportProject,
            getStemAnalysis,
            runStemSeparation,
            getMasterGain: () => {
                if (getMasterGain) return getMasterGain();
                try {
                    return (globalThis as any).__webAudioEngine?.getGain?.() ?? 1.0;
                } catch {
                    return 1.0;
                }
            },
            setMasterGain: (g: number) => {
                if (setMasterGain) {
                    setMasterGain(g);
                    return;
                }
                try {
                    (globalThis as any).__webAudioEngine?.setGain?.(g);
                } catch { /* noop */ }
            },
        };
    });

    useEffect(() => {
        const abortController = new AbortController();
        const doc = typeof document !== 'undefined' ? (document as any) : null;
        const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
        const win = typeof window !== 'undefined' ? (window as any) : null;
        const modelContext = doc?.modelContext || nav?.modelContext || win?.modelContext || null;

        // ツール実行ラッパー
        const executeTool = async (name: string, args: any) => {
            const tool = WEB_MCP_TOOLS.find((t) => t.name === name);
            if (!tool) {
                const msg = `Tool "${name}" not found.`;
                return { content: [{ type: 'text', text: msg }], success: false, message: msg };
            }
            try {
                const res = await tool.execute(args, contextRef.current);
                setLastInvokedTool(name);
                setLastResult(res.message);
                return {
                    content: [{ type: 'text', text: res.message }],
                    ...res,
                };
            } catch (err: any) {
                const errMsg = err?.message || String(err);
                setLastInvokedTool(name);
                setLastResult(`Error: ${errMsg}`);
                return {
                    content: [{ type: 'text', text: `Tool execution failed: ${errMsg}` }],
                    success: false,
                    message: `Tool execution failed: ${errMsg}`,
                };
            }
        };

        // 1. 標準 WebMCP API (document.modelContext / navigator.modelContext) への登録
        if (modelContext && typeof modelContext.registerTool === 'function') {
            for (const tool of WEB_MCP_TOOLS) {
                try {
                    const registration = {
                        name: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                        // Chrome 150+ / W3C WebMCP 最新標準は execute、旧ドラフトは handler
                        execute: (args: any) => executeTool(tool.name, args),
                        handler: (args: any) => executeTool(tool.name, args),
                    };
                    const res = modelContext.registerTool(registration, { signal: abortController.signal });
                    if (res && typeof res.catch === 'function') {
                        res.catch((e: any) => console.warn(`[WebMCP] Error in tool ${tool.name}:`, e));
                    }
                } catch (e) {
                    console.warn(`[WebMCP] Failed to register tool ${tool.name}:`, e);
                }
            }
            console.log(`[WebMCP] 🚀 Successfully registered ${WEB_MCP_TOOLS.length} tools to document.modelContext`);
        }

        // 2. window.__voiventWebMcp への登録（ChatGPT 拡張 / コンソール / ローカルスクリプト用）
        if (win) {
            win.__voiventWebMcp = {
                tools: WEB_MCP_TOOLS.map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema,
                })),
                callTool: (name: string, args: any) => executeTool(name, args),
                getProject: () => contextRef.current.getConfig(),
            };
        }

        setIsRegistered(true);

        return () => {
            abortController.abort();
            if (win?.__voiventWebMcp) {
                delete win.__voiventWebMcp;
            }
        };
    }, []);

    const isSupported = typeof window !== 'undefined' && (
        Boolean((document as any)?.modelContext) ||
        Boolean((navigator as any)?.modelContext) ||
        Boolean((window as any)?.modelContext) ||
        Boolean((window as any)?.__voiventWebMcp)
    );

    return {
        isSupported,
        isRegistered,
        tools: WEB_MCP_TOOLS,
        lastInvokedTool,
        lastResult,
    };
}
