import type { StemBuffers } from './types';

/**
 * ステレオ PCM から表示用の正規化ピーク列を作る。
 * ブロック境界を比例計算することで、サンプルの末尾を取りこぼさない。
 */
export function computePeaks(stem: StemBuffers, requestedPoints: number): Float32Array {
    const pointCount = Math.max(1, Math.floor(requestedPoints));
    const len = Math.min(stem.left.length, stem.right.length);
    const peaks = new Float32Array(pointCount);
    if (len === 0) return peaks;

    for (let i = 0; i < pointCount; i++) {
        const start = Math.floor((i * len) / pointCount);
        const end = Math.min(len, Math.max(start + 1, Math.ceil(((i + 1) * len) / pointCount)));
        let peak = 0;
        for (let j = start; j < end; j++) {
            const left = stem.left[j];
            const right = stem.right[j];
            if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
            const value = Math.max(Math.abs(left), Math.abs(right));
            if (value > peak) peak = value;
        }
        peaks[i] = peak;
    }

    let maxPeak = 0;
    for (const peak of peaks) {
        if (peak > maxPeak) maxPeak = peak;
    }
    if (maxPeak > 0) {
        for (let i = 0; i < peaks.length; i++) peaks[i] /= maxPeak;
    }
    return peaks;
}
