//==============================================================================
// UI テーマ共有コンテキスト。
// App ルートで選択された ThemeConfig を子コンポーネントへ
// props バケツリレーなしで供給する。MV ワークスペースやブラウザーパネル等、
// 従来ハードコード色だった領域のテーマ連動に使用する。
//==============================================================================
import React, { createContext, useContext } from 'react';
import { THEMES, getSavedThemeId, type ThemeConfig, type ThemeId } from '../theme';

interface ThemeContextValue {
    theme: ThemeConfig;
    themeId: ThemeId;
}

const ThemeContext = createContext<ThemeContextValue>({
    theme: THEMES.vibrant,
    themeId: 'vibrant',
});

interface ThemeProviderProps {
    theme: ThemeConfig;
    themeId: ThemeId;
    children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ theme, themeId, children }) => (
    <ThemeContext.Provider value={{ theme, themeId }}>
        {children}
    </ThemeContext.Provider>
);

/** 現在のテーマを取得する。プロバイダー未設置時は保存済み/デフォルトテーマにフォールバック */
export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (ctx) return ctx;
    const id = getSavedThemeId();
    return { theme: THEMES[id], themeId: id };
}