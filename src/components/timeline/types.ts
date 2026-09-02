// タイムライン系コンポーネント間で共有する型定義。

export type NoteSelection = { track: number; clip: number; notes: number[] } | null;
export type CutCursor = { track: number; clip: number; timeSeconds: number } | null;
export type MarqueeRect = { x1: number; y1: number; x2: number; y2: number } | null;
