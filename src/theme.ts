export type ThemeId = 'vibrant' | 'slate' | 'charcoal';

export interface ThemeConfig {
    id: ThemeId;
    name: string;
    description: string;
    bgApp: string;
    bgPanel: string;
    bgHeader: string;
    bgTimeline: string;
    /** 最深部パネル背景（MV ワークスペース側面ペイン等） */
    bgDeep: string;
    /** 入力欄・凹み領域の背景 */
    bgInset: string;
    /** 非選択コントロール（ボタン・リスト項目）の背景 */
    bgControl: string;
    border: string;
    borderLight: string;
    /** 弱い区切り線（セクション境界等） */
    borderSubtle: string;
    textMain: string;
    textMuted: string;
    /** 中間的な補助テキスト */
    textSubtle: string;
    accent: string;
    accentHover: string;
    accentSecondary: string;
    /** 情報系ブルー（リンク・再生位置・強調表示） */
    accentInfo: string;
    /** 成功・稼働状態 */
    success: string;
    /** エラー・破壊的操作 */
    danger: string;
    /** 警告 */
    warning: string;
    gridLine: string;
    clipBg: string;
    clipBorder: string;
    previewColors: string[];
}

/** HEX (#rrggbb) にアルファを付して rgba() 文字列へ変換する */
export function withAlpha(hex: string, alpha: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
    vibrant: {
        id: 'vibrant',
        name: 'サイバー・エナジー (デフォルト)',
        description: '鮮やかなエメラルド＆ネオンブルー。映えと視覚的インパクトを重視したデザイン',
        bgApp: '#10131a',
        bgPanel: '#151b26',
        bgHeader: '#131822',
        bgTimeline: '#11151e',
        bgDeep: '#0d1017',
        bgInset: '#0a0d14',
        bgControl: '#161c28',
        border: '#232d3d',
        borderLight: '#354359',
        borderSubtle: '#1c2333',
        textMain: '#e8ebf0',
        textMuted: '#8395a7',
        textSubtle: '#94a3b8',
        accent: '#2ed573',
        accentHover: '#26af5f',
        accentSecondary: '#70a1ff',
        accentInfo: '#38bdf8',
        success: '#34d399',
        danger: '#ef4444',
        warning: '#f59e0b',
        gridLine: 'rgba(255, 255, 255, 0.07)',
        clipBg: 'linear-gradient(135deg, #1e3799 0%, #0c2461 100%)',
        clipBorder: '#4d7cff',
        previewColors: ['#10131a', '#151b26', '#2ed573', '#70a1ff'],
    },
    slate: {
        id: 'slate',
        name: 'スタジオ・スレート (疲労軽減 / プロ仕様)',
        description: '純黒・純白・蛍光色を排した目に優しい配色。落ち着いたスレートグレー＆淡いスカイブルー',
        bgApp: '#282c34',
        bgPanel: '#303540',
        bgHeader: '#23272e',
        bgTimeline: '#21252b',
        bgDeep: '#262b33',
        bgInset: '#1f242b',
        bgControl: '#38404d',
        border: '#434956',
        borderLight: '#5c6370',
        borderSubtle: '#3a414d',
        textMain: '#e6e9ef',
        textMuted: '#abb2bf',
        textSubtle: '#9aa5b3',
        accent: '#528bff',
        accentHover: '#3f7ec9',
        accentSecondary: '#61afef',
        accentInfo: '#61afef',
        success: '#4ec9b0',
        danger: '#e06c75',
        warning: '#d19a66',
        gridLine: 'rgba(220, 223, 228, 0.08)',
        clipBg: '#404859',
        clipBorder: '#5c667a',
        previewColors: ['#282c34', '#303540', '#528bff', '#e6e9ef'],
    },
    charcoal: {
        id: 'charcoal',
        name: 'ミニマル・チャコール (深夜集中 / マット)',
        description: '極めて低コントラストで刺激を極限まで抑えたマットダーク。深夜の長時間作業に最適',
        bgApp: '#181a1d',
        bgPanel: '#202226',
        bgHeader: '#1b1d20',
        bgTimeline: '#151618',
        bgDeep: '#16181b',
        bgInset: '#111315',
        bgControl: '#24272c',
        border: '#2e3137',
        borderLight: '#3e4249',
        borderSubtle: '#26292e',
        textMain: '#c8ccd4',
        textMuted: '#828997',
        textSubtle: '#6f7684',
        accent: '#7b97aa',
        accentHover: '#5e7382',
        accentSecondary: '#8da6b8',
        accentInfo: '#8da6b8',
        success: '#7fa88f',
        danger: '#b06868',
        warning: '#b8965f',
        gridLine: 'rgba(255, 255, 255, 0.05)',
        clipBg: '#2d3139',
        clipBorder: '#434854',
        previewColors: ['#181a1d', '#202226', '#7b97aa', '#c8ccd4'],
    },
};

const THEME_STORAGE_KEY = 'originaldaw_theme_id';

export function getSavedThemeId(): ThemeId {
    try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId;
        if (saved && THEMES[saved]) return saved;
    } catch (_) { }
    return 'vibrant';
}

export function saveThemeId(themeId: ThemeId): void {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, themeId);
    } catch (_) { }
}
