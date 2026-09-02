//==============================================================================
// Web 版 (WebMCP Challenge 用) ビルド設定。
// デスクトップの vite.config.ts とは完全に分離:
//  - エントリ: web.html → src/web/main-web.tsx
//  - `**/native` の import を src/web/nativeShim.ts へ差し替え
//    (Web ブラウザでは window.__JUCE__ が存在せず、本物の native.ts は
//     import 時にクラッシュするため)
//  - localProjectSyncPlugin (ローカル FS 参照) は Web 版では不要
//  - singlefile 化しない (通常の静的ホスティング向けチャンク出力)
//==============================================================================
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { NATIVE_ALIAS_FIND } from './src/web/nativeAlias';

/**
 * web.html を index.html へリネームする (Cloudflare Workers Static Assets が
 * ルートパス `/` で配信できるように)。Workers の not_found_handling に
 * 依存しない確実なルートアクセスのため。
 */
function renameWebHtmlPlugin(): Plugin {
    return {
        name: 'rename-web-html',
        closeBundle() {
            const from = path.resolve(__dirname, 'dist-web/web.html');
            const to = path.resolve(__dirname, 'dist-web/index.html');
            if (fs.existsSync(from)) {
                fs.renameSync(from, to);
                console.log('[rename-web-html] dist-web/web.html -> dist-web/index.html');
            }
            // 25MiB超の ort wasm は R2 (/ort/...) から配信するため静的アセットから除外
            const assetsDir = path.resolve(__dirname, 'dist-web/assets');
            if (fs.existsSync(assetsDir)) {
                for (const f of fs.readdirSync(assetsDir)) {
                    if (f.endsWith('.wasm')) {
                        fs.unlinkSync(path.join(assetsDir, f));
                    }
                }
            }
        },
    };
}

export default defineConfig({
    plugins: [react(), renameWebHtmlPlugin()],
    base: './',
    // Web 版専用の静的コピー元 (_headers 等を dist-web へ含める)
    publicDir: 'public-web',
    define: {
        // Web デプロイでは 25MiB 超の ort WASM / ステム分離モデルを静的
        // アセットに同梱できないため、R2 経由の same-origin URL をビルド時に
        // 注入する (worker/index.ts の R2 プロキシが配信)。
        // デスクトップ ビルド (vite.config.ts) はこの定数を定義しないため、
        // バンドル内の data URL / ローカル /models/ を使う既定動作のまま。
        __ORT_WASM_URL__: JSON.stringify('/ort/ort-wasm-simd-threaded.jsep.wasm'),
        __STEM_MODEL_URL__: JSON.stringify('/models/htdemucs_embedded.onnx'),
        // ステム分離 Worker を「実ファイル Module Worker」で動かす (true)。
        // Blob inline は ort の import.meta.url 基準の内部ローダが解決できず
        // WebGPU EP 初期化が固まるため、Web では実ファイル方式にする
        __STEM_WORKER_FILE__: JSON.stringify(true),
    },
    resolve: {
        alias: [
            {
                // JUCE ブリッジを Web 版では shim へ差し替える。
                // import 型宣言 (import type) は型のみで消えるため実行時のみ影響する。
                find: NATIVE_ALIAS_FIND,
                replacement: path.resolve(__dirname, 'src/web/nativeShim.ts'),
            },
        ],
    },
    worker: {
        format: 'es',
    },
    build: {
        outDir: 'dist-web',
        target: 'es2020',
        sourcemap: false,
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
            input: path.resolve(__dirname, 'web.html'),
            output: {
                // 公開環境で初期アプリバンドルが単一の大容量アセットに
                // 集中すると、静的配信の初回取得が長時間待ちになることがある。
                // 依存ごとに分割して初期起動と遅延機能の取得を分離する。
                manualChunks(id) {
                    if (!id.includes('node_modules')) return undefined;
                    if (id.includes('/react/') || id.includes('/react-dom/')) return 'vendor-react';
                    if (id.includes('/three/')) return 'vendor-three';
                    if (id.includes('/phaser/')) return 'vendor-phaser';
                    if (id.includes('/onnxruntime-web/') || id.includes('/mediabunny/')) return 'vendor-media';
                    return undefined;
                },
            },
        },
    },
});
