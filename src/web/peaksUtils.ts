//==============================================================================
// Web 版ピーク解析ユーティリティ。
// デコード済み AudioBuffer からデスクトップ版 Analysis と同じ
// peaks ([min, max] ペア) 形式を生成する。MV オフライン描画と
// WebMCP get_energy_map のデータ源になる。
//==============================================================================

/**
 * AudioBuffer のモノラル先頭チャンネルから波形ピーク包絡を計算する。
 * @param buffer デコード済みバッファ (null 時は空配列)
 * @param samples 分割数 (既定 1024)
 */
export function computeAnalysisPeaks(buffer: AudioBuffer | null, samples = 1024): Array<[number, number]> {
    if (!buffer || buffer.length === 0 || samples <= 0) return [];
    const data = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / samples));
    const peaks: Array<[number, number]> = [];
    for (let i = 0; i < samples; i++) {
        const s = i * block;
        if (s >= data.length) {
            peaks.push([0, 0]);
            continue;
        }
        const e = Math.min(data.length, s + block);
        let mn = 1;
        let mx = -1;
        for (let j = s; j < e; j++) {
            const v = data[j];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        // サンプルが 1 つも読めなかったブロックは無音扱い
        peaks.push(mn > mx ? [0, 0] : [mn, mx]);
    }
    return peaks;
}
