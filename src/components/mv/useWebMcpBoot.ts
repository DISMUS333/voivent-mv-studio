//==============================================================================
// WebMCP ブートツール登録フック。
// ウェルカム画面 (楽曲ロード前) にブートツールを document.modelContext へ
// 先行登録する。active が false になったら解除する (本編ツールと入れ替わり)。
//==============================================================================
import { useEffect, useRef } from 'react';
import { createBootToolDefinitions, type WebMcpBootContext } from './webMcpBootTools';

interface UseWebMcpBootArgs {
    /** 楽曲未ロード (ウェルカム画面表示中) = true */
    active: boolean;
    ctx: WebMcpBootContext;
    /** 登録済みブートツールを window.__voiventWebMcp へも公開する (コンソールデバッグ用) */
    onExpose?: (api: { callTool: (name: string, args: unknown) => Promise<unknown>; tools: Array<{ name: string }> } | null) => void;
}

export function useWebMcpBoot({ active, ctx, onExpose }: UseWebMcpBootArgs): void {
    const ctxRef = useRef(ctx);
    useEffect(() => { ctxRef.current = ctx; });

    useEffect(() => {
        if (!active) { onExpose?.(null); return; }

        const abortController = new AbortController();
        const doc = typeof document !== 'undefined' ? (document as any) : null;
        const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
        const win = typeof window !== 'undefined' ? (window as any) : null;
        const modelContext = doc?.modelContext || nav?.modelContext || win?.modelContext || null;

        const bootCtx: WebMcpBootContext = {
            isAudioLoaded: () => ctxRef.current.isAudioLoaded(),
            onLoadFile: (file) => ctxRef.current.onLoadFile(file),
        };
        const tools = createBootToolDefinitions(bootCtx);

        const callTool = async (name: string, args: unknown) => {
            const tool = tools.find((t) => t.name === name);
            if (!tool) return { success: false, message: `Tool "${name}" not found.` };
            try {
                // ブートツールは context 引数を使用しない (クロージャで bootCtx を参照)
                const res = await tool.execute(args ?? {}, undefined as never);
                return {
                    content: res.content ?? [{ type: 'text', text: res.message }],
                    ...res,
                };
            } catch (err: any) {
                const msg = err?.message || String(err);
                return { content: [{ type: 'text', text: `Tool execution failed: ${msg}` }], success: false, message: `Tool execution failed: ${msg}` };
            }
        };

        if (modelContext && typeof modelContext.registerTool === 'function') {
            for (const tool of tools) {
                try {
                    const registration = {
                        name: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                        // Chrome 150+ / W3C WebMCP 最新標準は execute、旧ドラフトは handler
                        execute: (args: any) => callTool(tool.name, args),
                        handler: (args: any) => callTool(tool.name, args),
                    };
                    const res = modelContext.registerTool(registration, { signal: abortController.signal });
                    if (res && typeof res.catch === 'function') {
                        res.catch((e: any) => console.warn(`[WebMCP boot] Error in tool ${tool.name}:`, e));
                    }
                } catch (e) {
                    console.warn(`[WebMCP boot] Failed to register tool ${tool.name}:`, e);
                }
            }
            console.log(`[WebMCP boot] Registered ${tools.length} boot tools (editor not mounted yet)`);
        }

        // コンソール / テストドライバ用フォールバック (本編 __voiventWebMcp が無い間のみ)
        if (win && !win.__voiventWebMcp) {
            win.__voiventBootMcp = {
                tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
                callTool,
            };
            onExpose?.(win.__voiventBootMcp);
        }

        return () => {
            abortController.abort();
            if (win?.__voiventBootMcp) delete win.__voiventBootMcp;
            onExpose?.(null);
        };
    }, [active]);
}