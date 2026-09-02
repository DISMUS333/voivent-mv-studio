//==============================================================================
// シェーダープローブフレームの統計分析（純粋関数のみ・jsdom テスト可能）。
//
// AI 生成シェーダーの品質下限を機械的に保証するため、プローブ描画の
// ピクセル列から「静止生成・単色塗り・透明・NaN」等の不合格パターンを検出する。
// 描画系に依存しないため、単体テストで完全に検証できる。
//==============================================================================

export interface ProbeFrameStats {
    meanLuma: number;
    /** 輝度分散（0 = 完全単色） */
    colorVariance: number;
    hasNaN: boolean;
    /** 不透明ピクセルの比率 */
    opaqueRatio: number;
}

export interface ProbeSequenceStats {
    frames: ProbeFrameStats[];
    /** 全フレームが同一ピクセル列（時間・音響変化に一切反応していない） */
    allIdentical: boolean;
    /** 全フレームが完全透明 */
    allTransparent: boolean;
    /** 全フレームが単色塗りつぶし */
    allSingleColor: boolean;
    hasNaN: boolean;
    /** フレーム間の平均絶対輝度差（動きの指標） */
    interFrameMeanDelta: number;
}

/** 1 フレーム分のピクセル列を分析する（uint8 0..255 または float 0..1） */
export function analyzeFrame(px: Uint8Array | Uint8ClampedArray | Float32Array): ProbeFrameStats {
    const isFloat = px instanceof Float32Array;
    // float バッファ (0..1) は 0..255 空間へ正規化して比較可能にする
    const scale = isFloat ? 255 : 1;
    const pixelCount = Math.floor(px.length / 4);
    let lumaSum = 0;
    let lumaSqSum = 0;
    let opaque = 0;
    let hasNaN = false;

    for (let i = 0; i < px.length; i += 4) {
        const r = px[i] * scale;
        const g = px[i + 1] * scale;
        const b = px[i + 2] * scale;
        const a = px[i + 3] * scale;
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) {
            hasNaN = true;
            continue;
        }
        if (a > 8) opaque++;
        // Rec.601 風の輝度近似（0..255）
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        lumaSum += luma;
        lumaSqSum += luma * luma;
    }

    const meanLuma = pixelCount > 0 ? lumaSum / pixelCount : 0;
    const variance = pixelCount > 0 ? Math.max(0, lumaSqSum / pixelCount - meanLuma * meanLuma) : 0;
    return {
        meanLuma,
        colorVariance: variance,
        hasNaN,
        opaqueRatio: pixelCount > 0 ? opaque / pixelCount : 0,
    };
}

/** プローブフレーム列全体を分析し、不合格パターンを検出する */
export function analyzeProbeSequence(frames: Array<Uint8Array | Uint8ClampedArray | Float32Array>): ProbeSequenceStats {
    if (frames.length === 0) {
        return {
            frames: [],
            allIdentical: true,
            allTransparent: true,
            allSingleColor: true,
            hasNaN: false,
            interFrameMeanDelta: 0,
        };
    }

    const stats = frames.map(analyzeFrame);
    const first = frames[0];

    let allIdentical = true;
    for (const f of frames) {
        if (f.length !== first.length) { allIdentical = false; break; }
        for (let i = 0; i < f.length; i++) {
            if (f[i] !== first[i]) { allIdentical = false; break; }
        }
        if (!allIdentical) break;
    }

    let frameDeltaSum = 0;
    for (let fi = 1; fi < frames.length; fi++) {
        const prev = frames[fi - 1];
        const cur = frames[fi];
        const n = Math.min(prev.length, cur.length);
        let d = 0;
        for (let i = 0; i < n; i += 4) {
            d += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2]);
        }
        frameDeltaSum += d / (n / 4);
    }

    return {
        frames: stats,
        allIdentical,
        allTransparent: stats.every((s) => s.opaqueRatio < 0.001),
        allSingleColor: stats.every((s) => s.colorVariance < 0.5),
        hasNaN: stats.some((s) => s.hasNaN),
        interFrameMeanDelta: frames.length > 1 ? frameDeltaSum / (frames.length - 1) : 0,
    };
}

export interface ProbeJudge {
    ok: boolean;
    /** 不合格理由（合格時は null）。AI の自己修正ループへそのまま返せる文言 */
    reason: string | null;
}

/**
 プローブ結果から合格/不合格を判定する。
 判定順序: NaN → 透明 → 単色 → 静止（無反応）の順で、最も深刻な欠陥を先に報告する。
 */
export function judgeProbeSequence(stats: ProbeSequenceStats): ProbeJudge {
    if (stats.hasNaN) return { ok: false, reason: 'probe: フレームに NaN ピクセルが含まれます（除算や無限大の演算を見直してください）' };
    if (stats.allTransparent) return { ok: false, reason: 'probe: 全フレームが完全透明です（アルファを出力するか背景色を設定してください）' };
    if (stats.allIdentical) return { ok: false, reason: 'probe: 全プローブフレームが同一です。uTimeSec / uLow 等の uniform に反応せず静止しています' };
    if (stats.allSingleColor) return { ok: false, reason: 'probe: 全フレームが単色塗りつぶしです（uv や時間で変化するグラデーションを入れてください）' };
    if (stats.interFrameMeanDelta < 0.5) {
        return { ok: false, reason: 'probe: フレーム間の変化がほぼゼロです（実質静止映像になります）' };
    }
    return { ok: true, reason: null };
}
