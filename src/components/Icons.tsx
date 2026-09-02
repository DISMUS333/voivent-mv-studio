//==============================================================================
// 共通 SVG アイコンコンポーネント。
//==============================================================================

import type { CSSProperties } from 'react';

type IconProps = { size?: number; color?: string };

const iconStyle: CSSProperties = { display: 'inline-block', verticalAlign: 'middle' };

export function IconExternalLink({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    );
}

export function IconGlobe({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
    );
}

export function IconRecord({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <circle cx="12" cy="12" r="9" />
        </svg>
    );
}

export function IconStop({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
    );
}

export function IconCode({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
        </svg>
    );
}

export function IconPlay({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <path d="M7 5v14l12-7z" />
        </svg>
    );
}

export function IconAlertTriangle({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    );
}

export function IconFollowPlayhead({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={iconStyle}>
            <line x1="6" y1="3" x2="6" y2="21" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
            <rect x="9" y="8" width="10" height="8" rx="1.5" fill={color} fillOpacity="0.85" stroke={color} strokeWidth="1" />
        </svg>
    );
}

export function IconPause({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
    );
}

export function IconSpeaker({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={color} fillOpacity="0.2" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
    );
}

export function IconSynth({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <circle cx="7" cy="9" r="2" fill={color} fillOpacity="0.4" />
            <circle cx="17" cy="9" r="2" fill={color} fillOpacity="0.4" />
            <path d="M5 16h14" />
        </svg>
    );
}

export function IconScissors({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" />
            <line x1="14.47" y1="14.48" x2="20" y2="20" />
            <line x1="8.12" y1="8.12" x2="12" y2="12" />
        </svg>
    );
}

export function IconClose({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

export function IconReset({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
        </svg>
    );
}

export function IconZap({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={color}
            fillOpacity="0.3"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    );
}

export function IconSliders({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
    );
}

export function IconSave({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
        </svg>
    );
}

export function IconCheck({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

export function IconUndo({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
    );
}

export function IconRedo({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
        </svg>
    );
}

export function IconCopy({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}

/** 結合（分割された隣接行を 1 行にまとめる）アイコン */
export function IconMerge({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <path d="M4 5h16" />
            <path d="M4 9h9" />
            <path d="M12 12v5" />
            <path d="M9 14.5l3 3 3-3" />
            <path d="M4 21h16" />
        </svg>
    );
}

export function IconPin({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V6a3 3 0 0 0-6 0v4.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24V17z" />
        </svg>
    );
}

export function IconMidi({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <line x1="6" y1="5" x2="6" y2="12" />
            <line x1="10" y1="5" x2="10" y2="12" />
            <line x1="14" y1="5" x2="14" y2="12" />
            <line x1="18" y1="5" x2="18" y2="12" />
        </svg>
    );
}

export function IconVideo({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <polygon points="23 7 16 12 23 17 23 7" fill={color} fillOpacity="0.3" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
    );
}

export function IconWaveform({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <path d="M2 12h3l2-7 4 14 4-10 2 6 3-3h2" />
        </svg>
    );
}

export function IconSparkles({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4L12 2z" fill={color} fillOpacity="0.3" />
            <path d="M19 17l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />
        </svg>
    );
}

export function IconSearch({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    );
}

export function IconEdit({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
    );
}

export function IconDownload({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}

export function IconTrash({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={iconStyle}
        >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
    );
}

// ◀ 左ロケーターへ
export function IconPrevLocator({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <polygon points="19 20 9 12 19 4 19 20" />
            <line x1="5" y1="4" x2="5" y2="20" stroke={color} strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

// ▶ 右ロケーターへ
export function IconNextLocator({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <polygon points="5 4 15 12 5 20 5 4" />
            <line x1="19" y1="4" x2="19" y2="20" stroke={color} strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

// ⏪ 早戻し (1小節戻る)
export function IconFastRewind({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <polygon points="11 19 2 12 11 5 11 19" />
            <polygon points="22 19 13 12 22 5 22 19" />
        </svg>
    );
}

// ⏩ 早送り (1小節進む)
export function IconFastForward({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <polygon points="13 19 22 12 13 5 13 19" />
            <polygon points="2 19 11 12 2 5 2 19" />
        </svg>
    );
}

// ⏮ 先頭へ戻る (Return to Zero 0:00.0)
export function IconReturnToStart({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <line x1="4" y1="5" x2="4" y2="19" stroke={color} strokeWidth="3" strokeLinecap="round" />
            <polygon points="20 19 8 12 20 5 20 19" />
        </svg>
    );
}

// 🔁 ループ再生 (Cycle / Loop)
export function IconLoopCycle({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M17 2l4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="M7 22l-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
    );
}

// ⬚ 範囲選択 / マーキー
export function IconMarquee({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeDasharray="3 3" style={iconStyle}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
    );
}

// ＋ 追加
export function IconPlus({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

// − 減算 / ズームアウト
export function IconMinus({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

// ⏱ タイマー / カウントイン
export function IconTimer({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2.5" />
            <path d="M9 3h6" />
            <path d="M12 3v2" />
        </svg>
    );
}

// 🎙️ マイク / 歌声
export function IconMic({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    );
}

// 🎹 ピアノ / 鍵盤
export function IconPiano({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 4v9" stroke={color} strokeWidth="2" />
            <path d="M10 4v9" stroke={color} strokeWidth="2" />
            <path d="M14 4v9" stroke={color} strokeWidth="2" />
            <path d="M18 4v9" stroke={color} strokeWidth="2" />
        </svg>
    );
}

// 📁 フォルダ
export function IconFolder({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    );
}

// 📂 開いたフォルダ
export function IconFolderOpen({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M6 19a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2H9.41a2 2 0 0 0-1.89 1.34L6 19z" />
            <polygon points="6 19 8.24 9.34 22 9.34 19.76 19 6 19" />
        </svg>
    );
}

// 📄 ファイル
export function IconFile({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    );
}

// 🎵 音楽ファイル
export function IconFileMusic({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <circle cx="10" cy="16" r="2" fill={color} />
            <circle cx="16" cy="14" r="2" fill={color} />
            <path d="M12 16v-5l6-2v5" stroke={color} strokeWidth="1.5" />
        </svg>
    );
}

// 📊 スペクトラムバー
export function IconSpectrum({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <rect x="3" y="10" width="3" height="11" rx="1" />
            <rect x="8" y="4" width="3" height="17" rx="1" />
            <rect x="13" y="7" width="3" height="14" rx="1" />
            <rect x="18" y="13" width="3" height="8" rx="1" />
        </svg>
    );
}

// 🪐 オーディオリング
export function IconCircleWave({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="3" fill={color} fillOpacity="0.4" />
            <line x1="12" y1="1" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="23" />
            <line x1="1" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="23" y2="12" />
        </svg>
    );
}

// ⚡ レーザー波形
export function IconLaserWave({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M2 12h4l3-7 6 14 3-7h4" />
        </svg>
    );
}

// 🌌 ワープグリッド
export function IconWarpGrid({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M2 14l10-10 10 10" />
            <line x1="12" y1="4" x2="12" y2="20" />
            <line x1="6" y1="17" x2="18" y2="17" />
            <line x1="3" y1="20" x2="21" y2="20" />
        </svg>
    );
}

// 🚫 演出OFF / 目隠し
export function IconEyeOff({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
    );
}

// ✂️ 波形トリミング
export function IconScissorsCut({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" />
            <line x1="14.47" y1="14.48" x2="20" y2="20" />
            <line x1="8.12" y1="8.12" x2="12" y2="12" />
        </svg>
    );
}

// ⚡ 無音自動カット
export function IconAutoTrim({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill={color} fillOpacity="0.3" />
        </svg>
    );
}

// 🔊 ノーマライズ（音量最大化）
export function IconNormalize({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M11 5L6 9H2v6h4l5 4V5z" fill={color} fillOpacity="0.25" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
    );
}

// 🔄 リバース（逆再生）
export function IconReverse({ size = 13, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
        </svg>
    );
}// ⚙️ 設定 (Settings)
export function IconSettings({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    );
}

// 🎨 パレット / テーマ (Theme Palette)
export function IconPalette({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <circle cx="13.5" cy="6.5" r=".5" fill={color} />
            <circle cx="17.5" cy="10.5" r=".5" fill={color} />
            <circle cx="8.5" cy="7.5" r=".5" fill={color} />
            <circle cx="6.5" cy="12.5" r=".5" fill={color} />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </svg>
    );
}

// ⌨️ キーボード (Keyboard)
export function IconKeyboard({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M6 12h.001M10 12h.001M14 12h.001M18 12h.001M7 16h10" strokeWidth="2.5" />
        </svg>
    );
}

// ⏻ 電源 / バイパス (Power / Bypass)
export function IconPower({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
    );
}

// ⋮⋮ グリップ (Grip)
export function IconGrip({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={iconStyle}>
            <circle cx="9" cy="6" r="1.75" />
            <circle cx="15" cy="6" r="1.75" />
            <circle cx="9" cy="12" r="1.75" />
            <circle cx="15" cy="12" r="1.75" />
            <circle cx="9" cy="18" r="1.75" />
            <circle cx="15" cy="18" r="1.75" />
        </svg>
    );
}

// 🔌 プラグイン (Plugin)
export function IconPlugin({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M9 2v6m6-6v6M4 8h16v6a8 8 0 0 1-16 0V8zm8 14v-4" />
        </svg>
    );
}

// 🎙️ マイク (Microphone)
export function IconMicrophone({ size = 12, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    );
}

// 🧲 スナップ吸着 (Snap to Grid)
export function IconMagnet({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <path d="M4 4v7a8 8 0 0 0 16 0V4" />
            <line x1="4" y1="9" x2="8" y2="9" />
            <line x1="16" y1="9" x2="20" y2="9" />
        </svg>
    );
}

// 🔊 音量 / ボリューム (Volume)
export function IconVolume({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
    );
}

// 🔇 ミュート (Volume Mute)
export function IconVolumeMute({ size = 14, color = 'currentColor' }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
    );
}


