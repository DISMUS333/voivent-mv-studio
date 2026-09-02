//==============================================================================
// 録音波形・ピッチ曲線・アタック点を Canvas に描画するビュー。
//==============================================================================
import type { Analysis, Status } from '../types';
import { hzToY } from '../lib/music';

export function drawWaveform(
    ctx: CanvasRenderingContext2D,
    analysis: Analysis,
    width: number,
    height: number,
    playheadRatio: number,
) {
    ctx.clearRect(0, 0, width, height);

    // 背景
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, width, height);

    // 波形（ピークの min/max を垂直バーとして描画）
    const peaks = analysis.peaks;
    if (peaks && peaks.length > 0) {
        ctx.fillStyle = '#3ddc84';
        const n = peaks.length;
        const barW = Math.max(1, width / n);
        for (let i = 0; i < n; i++) {
            const [mn, mx] = peaks[i];
            const x = i * barW;
            const yTop = height / 2 - mx * (height / 2);
            const yBottom = height / 2 - mn * (height / 2);
            ctx.fillRect(x, yTop, barW, Math.max(1, yBottom - yTop));
        }
    }

    // ピッチ曲線
    const pitch = analysis.pitch;
    const pitchTimes = analysis.pitchTimes;
    if (pitch && pitch.length > 0) {
        ctx.strokeStyle = '#ff6b9d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < pitch.length; i++) {
            const hz = pitch[i];
            const t = pitchTimes[i] / analysis.duration;
            const x = t * width;
            const y = hzToY(hz, height);
            if (hz > 0) {
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            } else {
                started = false;
            }
        }
        ctx.stroke();
    }

    // アタック点
    if (analysis.attackTimes && analysis.attackTimes.length > 0) {
        ctx.fillStyle = '#ffc857';
        for (const time of analysis.attackTimes) {
            const x = (time / analysis.duration) * width;
            ctx.fillRect(x - 1, 0, 2, height);
        }
    }

    // 再生ヘッド
    if (playheadRatio > 0) {
        const x = playheadRatio * width;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
}

export function WaveformCanvas(props: {
    analysis: Analysis | null;
    status: Status | null;
}) {
    return null; // 描画は App 側の effect で直接行う（互換用プレースホルダ）
}
