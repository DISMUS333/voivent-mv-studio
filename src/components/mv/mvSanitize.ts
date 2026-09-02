//==============================================================================
// MV シーン HTML/SVG の安全化ユーティリティ。
// dangerouslySetInnerHTML に渡すコードから、実行可能な危険要素を取り除く。
// ※ 完全なセキュリティ境界ではなく「事故防止フィルタ」として設計。
//==============================================================================

/** 常に除去する要素タグ（外部リソース読込・スクリプト実行・フォーム送信など） */
const BLOCKED_TAGS = [
    'script',
    'iframe',
    'object',
    'embed',
    'link',
    'meta',
    'base',
    'form',
];

/**
 * シーン HTML をサニタイズする。
 * - script / iframe / object / embed / link / meta / base / form を除去
 * - on* 系インラインイベント属性を除去
 * - javascript: URL を除去
 *
 * DOMParser が利用できない環境（純粋なテストランナー等）では
 * 正規表現による簡易フォールバックを適用する。
 */
export function sanitizeSceneHtml(html: string): string {
    if (!html || typeof html !== 'string') return '';

    if (typeof DOMParser !== 'undefined') {
        try {
            const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
            const body = doc.body;

            body.querySelectorAll(BLOCKED_TAGS.join(',')).forEach((el) => el.remove());

            body.querySelectorAll('*').forEach((el) => {
                for (const attr of Array.from(el.attributes)) {
                    const name = attr.name.toLowerCase();
                    if (name.startsWith('on')) {
                        el.removeAttribute(attr.name);
                        continue;
                    }
                    if (
                        (name === 'href' || name === 'src' || name === 'xlink:href') &&
                        /^\s*javascript:/i.test(attr.value)
                    ) {
                        el.removeAttribute(attr.name);
                    }
                }
            });

            return body.innerHTML;
        } catch {
            /* パース失敗時はフォールバックへ */
        }
    }

    // フォールバック: 正規表現による簡易除去
    return html
        .replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[^>]*\/?\s*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(href|src|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}