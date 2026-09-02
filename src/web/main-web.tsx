import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WebMvStudio } from './WebMvStudio';
import { getSavedThemeId, THEMES } from '../theme';
import { ThemeProvider } from '../hooks/useTheme';

//==============================================================================
// MV Studio Web 版エントリポイント。
// 音声ファイル読み込み → MV ワークスペース (デスクトップと同一コンポーネント)。
//==============================================================================

function WebRoot() {
    const themeId = getSavedThemeId();
    return (
        <ThemeProvider theme={THEMES[themeId] ?? THEMES.vibrant} themeId={themeId}>
            <WebMvStudio />
        </ThemeProvider>
    );
}

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(
        <StrictMode>
            <WebRoot />
        </StrictMode>,
    );
}
