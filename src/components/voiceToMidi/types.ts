//==============================================================================
// Voice to MIDI（鼻歌・ボーカル解析メロディ抽出）の型定義
//==============================================================================

export type MusicalScale =
    | 'chromatic'
    | 'major'
    | 'minor'
    | 'dorian'
    | 'pentatonic_major'
    | 'pentatonic_minor';

export interface VoiceToMidiSettings {
    noiseGateThreshold: number; // 0.001 - 0.2 (音量ノイズゲート)
    minNoteDurationSec: number; // 0.05 - 0.5s (短すぎるノイズ音符の排除)
    pitchSmoothing: number;     // 1 - 7 (メディアンフィルタ平滑化窓幅)
    scale: MusicalScale;        // スケール吸着
    rootKey: number;            // 0(C) - 11(B)
    velocitySensitivity: number;// 0.5 - 2.0 (ベロシティ追従感度)
}

export interface ExtractedMidiNote {
    id: string;
    midi: number;         // 21 - 108 (A0 - C8)
    noteName: string;     // "C4", "F#3" など
    startSeconds: number; // クリップ先頭からの開始秒
    endSeconds: number;   // クリップ先頭からの終了秒
    duration: number;     // 秒数
    velocity: number;     // 1 - 127
    confidence: number;   // 0.0 - 1.0 (ピッチ安定度)
}
