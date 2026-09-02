//==============================================================================
// AudioSignals への stem 強化シグナル合成ヘルパー。
// 未分離プロジェクトは 1 バイトも変更しない (後方互換の要)。
// 分離済み + stem 強化モード ON のときのみ既存擬似帯域を実測値へ差し替える。
//==============================================================================
import type { AudioSignals } from '../types';
import type { StemAnalysis } from './types';
import { stemSignalsAtTime } from './stemAnalyzer';

/**
 * 既存 AudioSignals に stem 強化シグナルを合成して返す。
 * - analysis が null / stemMode が false → signals をそのまま返す (変化なし)
 * - 分離済み → beat / low / high / vocalActive を実測値へ強化
 *   (beat は拍グリッドの実測 onset パルス、low はベース実測包絡を優先)
 */
export function withStemSignals(
    signals: AudioSignals,
    analysis: StemAnalysis | null | undefined,
    stemMode: boolean,
): AudioSignals {
    if (!analysis || !stemMode) return signals;
    const s = stemSignalsAtTime(analysis, signals.timeSeconds);
    return {
        ...signals,
        // 実測ドラム onset パルスを beat として優先 (擬似 BPM 拍より正確)
        beat: Math.max(signals.beat, s.drumPulse),
        // ベース実測エネルギーを low へ合成 (最大値結合。擬似分配より過小にならない)
        low: Math.max(signals.low, s.bassEnergy),
        // ボーカル実測エネルギーを high/mid にも軽く反映 (歌声の輪郭)
        high: Math.max(signals.high, s.vocalEnergy * 0.8),
        stem: s,
    };
}
