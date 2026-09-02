//==============================================================================
// Base64 データのブラウザダウンロードユーティリティ。
// デスクトップ版の saveExportedVideo (ネイティブ保存ダイアログ) の
// Web 版相当。GIF / WAV 等のバイナリをユーザーのダウンロードフォルダへ保存する。
//==============================================================================

/** data URL プレフィックス (data:...;base64,) を除去して純 Base64 を返す */
export function stripBase64Prefix(data: string): string {
    const commaPos = data.indexOf(',');
    // data URL 形式 (data:image/gif;base64,XXXX) なら純 Base64 部分のみ
    if (data.startsWith('data:') && commaPos >= 0) return data.slice(commaPos + 1);
    return data;
}

/**
 * Base64 文字列をファイルとしてブラウザダウンロードする。
 * 成功時はファイル名を、失敗時は false を返す (saveExportedVideo 契約に準拠)。
 */
export function downloadBase64(base64Data: string, filename: string): string | false {
    try {
        if (!base64Data || !filename) return false;
        const pureB64 = stripBase64Prefix(base64Data);
        const binary = atob(pureB64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        // revoke はダウンロード開始を待ってから (即 revoke すると Safari で失敗する)
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        return filename;
    } catch (e) {
        console.error('[downloadUtils] download failed:', e);
        return false;
    }
}
