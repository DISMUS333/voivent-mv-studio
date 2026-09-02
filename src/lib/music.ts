//==============================================================================
// 音楽理論・表示に関する純粋関数（React/C++ に依存しない）。
//==============================================================================

// ピッチの表示範囲（Hz）を対数スケールでマッピングするための定数
export const MIN_HZ = 40;
export const MAX_HZ = 2000;

// 鍵盤の定数
export const DEFAULT_BASE_OCTAVE = 3; // C3 スタート (MIDI 48)
export const KEY_W = 32;

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);

export function noteName(midi: number): string {
    return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function isBlack(midi: number): boolean {
    return BLACK.has(((midi % 12) + 12) % 12);
}

export function hzToY(hz: number, height: number): number {
    if (hz <= 0) return height;
    const logMin = Math.log(MIN_HZ);
    const logMax = Math.log(MAX_HZ);
    const t = (Math.log(hz) - logMin) / (logMax - logMin);
    const clamped = Math.min(1, Math.max(0, t));
    return height - clamped * height;
}

export function formatTime(seconds: number): string {
    const s = Math.max(0, seconds);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const tenths = Math.floor((s % 1) * 10);
    const secStr = sec < 10 ? `0${sec}` : String(sec);
    return `${m}:${secStr}.${tenths}`;
}

// 鍵盤のキー配列を生成する（オクターブとオクターブ数を指定可能）。
export type KeyLayout = { note: number; black: boolean; left: number };

export function buildKeys(baseOctave: number = 3, numOctaves: number = 3): { keys: KeyLayout[]; width: number } {
    const startMidi = (baseOctave + 1) * 12; // 例: octave 3 -> MIDI 48 (C3)
    const endMidi = startMidi + numOctaves * 12; // 例: 48 + 36 = 84 (C6)

    const keys: KeyLayout[] = [];
    let whiteIdx = 0;
    for (let n = startMidi; n <= endMidi; n++) {
        const black = isBlack(n);
        const left = black ? (whiteIdx - 0.5) * KEY_W : whiteIdx * KEY_W;
        keys.push({ note: n, black, left });
        if (!black) whiteIdx++;
    }
    return { keys, width: whiteIdx * KEY_W };
}