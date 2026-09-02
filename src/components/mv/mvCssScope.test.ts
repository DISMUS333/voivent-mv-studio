//==============================================================================
// mvCssScope.ts の単体テスト。
// AI 生成 CSS がアプリ UI へ漏れないこと（スコープ化）を jsdom なしで検証する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { scopeMvCss, MV_STAGE_CLASS } from './mvCssScope';

const SCOPE = `.${MV_STAGE_CLASS}`;

describe('scopeMvCss', () => {
    it('通常ルールのセレクタへスコープを付与する', () => {
        const r = scopeMvCss('.lyric-box { color: red; }', SCOPE);
        expect(r).toContain(`.mv-css-stage .lyric-box{`);
        expect(r).toContain('color: red');
    });

    it('カンマ区切りの複数セレクタすべてへスコープを付与する', () => {
        const r = scopeMvCss('.a, .b { opacity: 0.5; }', SCOPE);
        expect(r).toContain('.mv-css-stage .a, .mv-css-stage .b{');
    });

    it('body / html / :root セレクタをステージ要素自身へリダイレクトする', () => {
        const r = scopeMvCss('body { margin: 0; } html { overflow: hidden; } :root { --x: 1; }', SCOPE);
        expect(r).toContain('.mv-css-stage{ margin: 0; }');
        expect(r).toContain('.mv-css-stage{ overflow: hidden; }');
        expect(r).toContain('.mv-css-stage{ --x: 1; }');
        expect(r).not.toMatch(/(^|\s|,)body\s*\{/);
        expect(r).not.toMatch(/(^|\s|,)html\s*\{/);
    });

    it('body 配下の子孫セレクタはステージの子孫へ置換する', () => {
        expect(scopeMvCss('body .lyric { font-weight: 700; }', SCOPE))
            .toContain('.mv-css-stage .lyric{');
        // 複合（body.foo）はステージ要素自身の複合へ
        expect(scopeMvCss('body.foo { z-index: 1; }', SCOPE))
            .toContain('.mv-css-stage.foo{');
    });

    it('全称セレクタ * をステージ内へ限定する', () => {
        const r = scopeMvCss('* { box-sizing: border-box; }', SCOPE);
        expect(r).toBe('.mv-css-stage *{ box-sizing: border-box; }');
    });

    it('@media 内のルールを再帰的にスコープ化する', () => {
        const css = '@media (max-width: 500px) { .panel { display: none; } body { background: #000; } }';
        const r = scopeMvCss(css, SCOPE);
        expect(r).toContain('@media (max-width: 500px)');
        expect(r).toContain('.mv-css-stage .panel{');
        expect(r).toContain('.mv-css-stage{ background: #000; }');
    });

    it('@keyframes は中身を書き換えず保護する', () => {
        const css = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin-target { animation: spin 2s linear infinite; }';
        const r = scopeMvCss(css, SCOPE);
        expect(r).toContain('@keyframes spin{');
        expect(r).toContain('from { transform: rotate(0deg); }');
        expect(r).toContain('to { transform: rotate(360deg); }');
        expect(r).toContain('.mv-css-stage .spin-target{');
    });

    it('@font-face は中身を書き換えず素通しされる', () => {
        const css = '@font-face { font-family: MyFont; src: url(data:font/woff2;base64,AAAA); }';
        const r = scopeMvCss(css, SCOPE);
        expect(r).toContain('@font-face');
        expect(r).toContain('font-family: MyFont');
        expect(r).toContain('src: url(data:font/woff2;base64,AAAA)');
        expect(r).not.toContain('.mv-css-stage');
    });

    it('文字列リテラル内の波括弧・セミコロンを壊さない', () => {
        const css = '.a::after { content: "}"; } .b::before { content: "{"; }';
        const r = scopeMvCss(css, SCOPE);
        expect(r).toContain('content: "}"');
        expect(r).toContain('content: "{"');
        expect(r).toContain('.mv-css-stage .a::after{');
        expect(r).toContain('.mv-css-stage .b::before{');
    });

    it('ブロックを持たない宣言文（@import 等）は素通しされる', () => {
        const css = '@import url("theme.css"); .x { color: blue; }';
        const r = scopeMvCss(css, SCOPE);
        expect(r).toContain('@import url("theme.css");');
        expect(r).toContain('.mv-css-stage .x{');
    });

    it('コメントを保持したままスコープ化する', () => {
        const css = '/* main box */ .box { width: 10px; }';
        const r = scopeMvCss(css, SCOPE);
        expect(r).toContain('/* main box */');
        // コメントはセレクタ間に保持され、.box へはスコープが付く
        expect(r).toContain('.box{');
        expect(r).toContain('.mv-css-stage');
    });

    it('空入力は空文字を返す', () => {
        expect(scopeMvCss('', SCOPE)).toBe('');
        expect(scopeMvCss(undefined, SCOPE)).toBe('');
        expect(scopeMvCss(null, SCOPE)).toBe('');
    });
});
