//==============================================================================
// MV シーン CSS（globalCss / cssCode / svgCode 内 <style>）のスコープ化ユーティリティ。
//
// AI が生成した CSS が `body { ... }` や `* { ... !important }` を含んでも
// アプリ本体 UI（タイムライン・パネル・ボタン等）へ漏れ出さないよう、
// すべてのセレクタを MV ステージ要素の子孫に書き換える「事故防止フィルタ」。
//
// - 通常ルール: `.foo` → `.mv-css-stage .foo`
// - html / body / :root で始まるセレクタはステージ要素自身へリダイレクト
// - `*` はステージ内全称へ限定
// - @keyframes / @font-face 等は中身を書き換えず素通し
// - @media / @supports / @container 内は再帰的にスコープ化
// - 文字列リテラル（content: "}" 等）とコメントは保護する
// ※ 完全な CSS パーサーではなく、未知の構文は無害化側に倒す設計。
//==============================================================================

/** MV ステージ（AudioReactiveSandbox コンテナ）に付与するスコープクラス */
export const MV_STAGE_CLASS = 'mv-css-stage';

/** 文字列リテラル（'"' または "'"）の終端インデックスを返す（エスケープ対応） */
function skipString(input: string, start: number): number {
    const quote = input[start];
    let i = start + 1;
    while (i < input.length) {
        if (input[i] === '\\') { i += 2; continue; }
        if (input[i] === quote) return i + 1;
        i++;
    }
    return i;
}

/** ブロックコメントの終端インデックスを返す（未終端は入力末尾） */
function skipComment(input: string, start: number): number {
    const end = input.indexOf('*/', start + 2);
    return end === -1 ? input.length : end + 2;
}

/** コメント・文字列を保護しつつブロック本体と閉じ後インデックスを抽出する */
function extractBraces(input: string, openIdx: number): { body: string; next: number } {
    let depth = 0;
    let i = openIdx;
    while (i < input.length) {
        const ch = input[i];
        if (ch === '/' && input[i + 1] === '*') { i = skipComment(input, i); continue; }
        if (ch === '"' || ch === "'") { i = skipString(input, i); continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return { body: input.slice(openIdx + 1, i), next: i + 1 };
        }
        i++;
    }
    // 閉じが無い壊れた入力: 残りを本体として扱う（無害化側に倒す）
    return { body: input.slice(openIdx + 1), next: input.length };
}

/** コメント・文字列を除いた本体にブロック開始 `{` を含むか（CSS ネスト検出） */
function containsBlockStart(body: string): boolean {
    let i = 0;
    while (i < body.length) {
        const ch = body[i];
        if (ch === '/' && body[i + 1] === '*') { i = skipComment(body, i); continue; }
        if (ch === '"' || ch === "'") { i = skipString(body, i); continue; }
        if (ch === '{') return true;
        i++;
    }
    return false;
}

/** 単一セレクタをスコープへ付け替える */
function scopeSelector(sel: string, scope: string): string {
    const s = sel.trim();
    if (!s) return '';
    // @keyframes 内の進行度セレクタ（防御: 通常ここには来ない）
    if (/^(from|to)$|^(-?\d+(\.\d+)?%)$/i.test(s)) return s;
    if (s === '*') return `${scope} *`;
    // html / body / :root で始まるセレクタはステージ要素自身へリダイレクト
    const m = s.match(/^(html|body|:root)((?:[\s]|\S)*)$/i);
    if (m) {
        const rest = (m[2] ?? '').trim();
        if (!rest) return scope;
        const hadSpace = /^\s/.test(m[2]);
        return hadSpace ? `${scope} ${rest}` : `${scope}${rest}`;
    }
    return `${scope} ${s}`;
}

/** 中身を書き換えず素通しする @ルール（keyframes / font-face 等） */
const PASS_THROUGH_AT = /^@(-[a-z]+-)?keyframes|@font-face|@property|@counter-style|@page|@charset|@namespace/i;

/** 中身を再帰的にスコープ化する @ルール（条件付きグループ） */
const NESTED_AT = /^@(media|supports|container|layer)\b/i;

/** 1 ブロック（ヘッダ＋本体）を種別判定して変換する */
function transformBlock(header: string, body: string, scope: string): string {
    const h = header.trim();
    if (!h) return `{${body}}`;
    if (PASS_THROUGH_AT.test(h)) {
        return `${h}{${body}}`;
    }
    if (NESTED_AT.test(h)) {
        return `${h}{${scopeBlock(body, scope)}}`;
    }
    // 通常ルール: セレクタごとにスコープ化（CSS ネストがあれば本体も再帰処理）
    const scoped = h
        .split(',')
        .map((sel) => scopeSelector(sel, scope))
        .filter(Boolean)
        .join(', ');
    const inner = containsBlockStart(body) ? scopeBlock(body, scope) : body;
    return `${scoped}{${inner}}`;
}

/** トップレベル走査: セレクタ蓄積バッファ＋ブロック抽出で全体を変換する */
function scopeBlock(input: string, scope: string): string {
    let out = '';
    let buf = '';
    let i = 0;
    while (i < input.length) {
        const ch = input[i];
        if (ch === '/' && input[i + 1] === '*') {
            const stop = skipComment(input, i);
            buf += input.slice(i, stop);
            i = stop;
            continue;
        }
        if (ch === '"' || ch === "'") {
            const stop = skipString(input, i);
            buf += input.slice(i, stop);
            i = stop;
            continue;
        }
        if (ch === ';') {
            // ブロックを持たない宣言文（@import url(...); 等）は素通し
            out += buf + ';';
            buf = '';
            i++;
            continue;
        }
        if (ch === '{') {
            const header = buf;
            buf = '';
            const { body, next } = extractBraces(input, i);
            out += transformBlock(header, body, scope);
            i = next;
            continue;
        }
        if (ch === '}') {
            // 閉じ過ぎへの防御: バッファごと素通し
            out += buf + '}';
            buf = '';
            i++;
            continue;
        }
        buf += ch;
        i++;
    }
    if (buf.trim()) out += buf;
    return out;
}

/**
 * CSS を MV ステージ内へスコープ化する。
 * - 各セレクタへ `.${scope}` を付与（scope 引数は `.mv-css-stage` 形式で渡す）
 * - html / body / :root はステージ要素へリダイレクトし、アプリ UI への適用を遮断
 * - @keyframes / @font-face は保護、@media 等は再帰処理
 * - 空入力は空文字を返す
 */
export function scopeMvCss(css: string | undefined | null, scope: string): string {
    if (!css || !css.trim()) return '';
    return scopeBlock(css, scope);
}
