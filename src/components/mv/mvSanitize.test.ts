//==============================================================================
// mvSanitize.ts の単体テスト。
// 危険要素除去・属性制限・URL スキーム検証を検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { sanitizeSceneHtml } from './mvSanitize';

describe('sanitizeSceneHtml', () => {
    it('script タグを除去する', () => {
        const out = sanitizeSceneHtml('<div>ok</div><script>alert(1)</script>');
        expect(out).not.toContain('script');
        expect(out).toContain('<div>ok</div>');
    });

    it('iframe / object / embed を除去する', () => {
        const html = '<iframe src="https://example.com"></iframe><object data="x"></object><embed src="y">';
        const out = sanitizeSceneHtml(html);
        expect(out).not.toContain('iframe');
        expect(out).not.toContain('object');
        expect(out).not.toContain('embed');
    });

    it('on* インラインイベントハンドラを除去する', () => {
        const out = sanitizeSceneHtml('<div onclick="alert(1)" onmouseover="x()">text</div>');
        expect(out).not.toContain('onclick');
        expect(out).not.toContain('onmouseover');
        expect(out).toContain('text');
    });

    it('javascript: URL を除去する', () => {
        const out = sanitizeSceneHtml('<a href="javascript:alert(1)">link</a>');
        expect(out).not.toContain('javascript:');
    });

    it('data: URL は許可される', () => {
        const out = sanitizeSceneHtml('<img src="data:image/png;base64,AAAA">');
        expect(out).toContain('data:image/png');
    });

    it('https URL は許可される', () => {
        const out = sanitizeSceneHtml('<img src="https://example.com/a.png">');
        expect(out).toContain('https://example.com/a.png');
    });

    it('style 属性は許可される', () => {
        const out = sanitizeSceneHtml('<div style="color:red">s</div>');
        expect(out).toContain('style');
    });

    it('class 属性は許可される', () => {
        const out = sanitizeSceneHtml('<div class="mv-box">c</div>');
        expect(out).toContain('class');
    });

    it('通常の SVG コンテンツは保持される', () => {
        const svg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#38bdf8"/></svg>';
        const out = sanitizeSceneHtml(svg);
        expect(out).toContain('<svg');
        expect(out).toContain('<circle');
        expect(out).toContain('#38bdf8');
    });

    it('空文字入力は空文字を返す', () => {
        expect(sanitizeSceneHtml('')).toBe('');
    });
});