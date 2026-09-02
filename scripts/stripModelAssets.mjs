//==============================================================================
// デプロイ前のモデルアセット除外スクリプト。
// vite.config.web.ts の publicDir (public-web/) にはローカル開発用のモデルが
// 置かれており、そのまま dist-web/ にコピーされる。Cloudflare Workers の
// 静的アセットは 1 ファイル 25MiB 上限のため 172MB 級モデルを含められず、
// デプロイ自体が失敗する。モデル / ort WASM は R2 (worker/index.ts) から
// 配信するため、wrangler の前に dist-web から 25MiB 超ファイルを取り除く。
//==============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ASSET_BYTES = 25 * 1024 * 1024; // Workers 静的アセットの上限
const distWeb = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-web');

function removeOversized(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            removeOversized(full);
            if (fs.readdirSync(full).length === 0) {
                fs.rmdirSync(full);
                console.log(`[stripModelAssets] removed empty dir dist-web/${path.relative(distWeb, full)}/`);
            }
        } else if (fs.statSync(full).size > MAX_ASSET_BYTES) {
            fs.rmSync(full);
            console.log(`[stripModelAssets] removed dist-web/${path.relative(distWeb, full)} (R2 経由で配信されるため)`);
        }
    }
}

if (fs.existsSync(distWeb)) {
    removeOversized(distWeb);
} else {
    console.log('[stripModelAssets] no dist-web directory (nothing to do)');
}
