//==============================================================================
// AI 生成シェーダー（TSL ノードグラフ）の安全なコンパイル＆プローブ検証ハーネス。
//
// 契約: AI は以下の固定 uniform を受け取り、フルスクリーン 1 枚分の色ノードを返す
//   uTimeSec / uLow / uMid / uHigh / uBeat / uEnergy
// AI コードは new Function で分離実行され、DOM への参照は渡さない。
// 生成物はプローブフレーム（時間・音響値を変えた 3 枚）で機械検証し、
// 不合格時は理由を AI へ返して自己修正ループに回す。
//
// 描画検証は実ブラウザ（GPU バックエンド、mvShaderBackend の設定に従う）でのみ
// 可能なため、純粋判定ロジックは mvShaderProbeStats.ts に分離して jsdom テスト可能にしている。
//==============================================================================
import {
    analyzeProbeSequence,
    judgeProbeSequence,
    type ProbeSequenceStats,
} from './mvShaderProbeStats';
import { createShaderBackendOptions, detectActualBackend } from './mvShaderBackend';
import { normalizePixels } from './mvShaderPixels';

/** AI に公開する契約ドキュメント（webMcpTools のツール説明にそのまま埋め込む） */
export const TSL_SHADER_CONTRACT_DOC = `シェーダー契約:
- 提出形式: (tsl, u) の「本体」。最後に tsl.vec4(...) 等の TSL 色ノードを return する。tsl は TSL ノード関数群、u は uniform 集合。
  例: return tsl.vec4(tsl.sin(u.uTimeSec).mul(0.5).add(0.5), u.uLow, tsl.uv().x, 1.0);
- function shaderCode(tsl, u) { return ...; } / const shaderCode = (tsl, u) => ... の形式でも可（自動検出して呼び出す）。return 省略の単一式も可
- 利用可能 uniform: u.uTimeSec(0..曲長) u.uLow u.uMid u.uHigh u.uBeat(0..1) u.uEnergy(0..1)。検証プローブは全帯域を変化させるので、どの帯域依存でも合格判定できる
- tsl から使える主関数: uniform, uv, vec2, vec3, vec4, float, mix, sin, cos, fract, pow, abs, smoothstep, length, dot, normalize, time, oscSine, loop, Fn, if（.mul/.add などメソッドチェーン OK）
- GLSL からの翻訳対応表: gl_FragCoord/uv → tsl.uv() / a+b → a.add(b) / a-b → a.sub(b) / a*b → a.mul(b) / a/b → a.div(b) / mix(a,b,t) → a.mix(b,t) / clamp → .clamp() / step → tsl.step / fract → tsl.fract / mod → tsl.mod / atan(y,x) → tsl.atan2(y,x) /pow → tsl.pow / 3.0 → tsl.float(3)（スカラーは tsl.float 化）。GLSL 文字列をそのまま提出してはいけない
- 返り値: vec4 型の色ノード 1 個（フルスクリーンquadに貼られる。黒(0,0,0)は「描けていない」と誤認されやすいので避ける）。GLSL 文字列やプレーンオブジェクト { } は返せない
- デザイン: 楽曲のジャンルやユーザーの要望（ポップ、サイバー、和風、エモーショナル、ダーク等）に合わせて、色彩・形状・動きを豊かに表現する
- 良い例: 低音 u.uLow で脈打つ、u.uBeat でインパクト、u.uTimeSec で空間が流れる`;

/** 契約 uniform の型（AI コードへ渡すもの） */
export interface ShaderUniforms {
    uTimeSec: { value: number };
    uLow: { value: number };
    uMid: { value: number };
    uHigh: { value: number };
    uBeat: { value: number };
    uEnergy: { value: number };
}

export interface TslCompileResult {
    ok: boolean;
    /** 不合格理由（合格時 null）。AI の自己修正ループへそのまま返せる文言 */
    error: string | null;
    /** 生成された色ノード（three のノードオブジェクト） */
    colorNode?: unknown;
    uniforms?: ShaderUniforms;
}

/** コンパイル〜検証全体のタイムアウト (ms)。無限ループ風コードの巻き込み防止 */
export const TSL_COMPILE_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} が ${ms}ms でタイムアウトしました（無限ループの疑い）`)), ms);
        p.then((v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); });
    });
}

/**
 * AI 生成コード文字列をコンパイルし、色ノードを得る。
 *
 * 契約: コードは (tsl, u) => { ... } の「本体」として評価され、
 * 最後に tsl.vec4(...) 等の TSL 色ノードを return する。
 *
 * 提出形状の揺れは evaluateShaderSubmission が吸収する:
 * - 本体 + return（標準）
 * - 関数宣言だけを提出（return の入れ忘れ）→ 自動検出して (tsl, u) で呼び出す
 * - return 省略の単一式 → 本体を関数で包んで暗黙 return として救済
 *
 * 安全化（事故防止フィルタ。完全なセキュリティ境界ではない）:
 * - document / window / fetch 等の危険参照を引数シャドウイングで undefined 化
 * - 実行は Promise + タイムアウトで監視
 */

/** return の入れ忘れ対策: 本体コードを関数で包み、即座に (tsl, u) 引数で呼び出すスニペット */
const TSL_FN_BODY_SNIPPET = 'return ((tsl, u) => {\n';

/** 返り値がノードでない場合の共通エラー文言 */
const TSL_NO_NODE_RETURNED_ERROR =
    'shaderCode の返り値が TSL ノードではありません。AI 生成シェーダーは (tsl, u) の本体として tsl.vec4(...) 等の色ノードを return する必要があります（GLSL 文字列や function 宣言そのものは返せません）。';

/** 危険参照の遮断（引数シャドウイング）用の仮引数名一覧 */
const SHADOW_ARGS = ['document', 'window', 'fetch', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'WebSocket', 'Worker', 'globalThis', 'self'] as const;

/**
 * 提出コードを評価して TSL 色ノードを取り出す（形状の揺れを吸収する正規化層）。
 * - 標準: (tsl, u) の本体として return を評価
 * - 関数宣言のみの提出: 返ってきた (tsl, u) 関数を自動で呼び出す
 * - 単一式 / return 忘れ: 本体を関数で包んで再評価
 * 失敗時は元の評価エラーを送出して呼び出し側の診断文言へ流す。
 *
 * ライブ (MvShaderCanvas) / プローブ (verifyTslShader) / 書き出し (mvShaderOffline)
 * の 3 経路がこの関数を共有し、同一提出コードの評価結果が一致することを保証する。
 */
export function evaluateShaderSubmission(code: string, tslApi: unknown, uniforms: ShaderUniforms): unknown {
    const runFactory = (body: string): unknown => {
        const factory = new Function('tsl', 'u', ...SHADOW_ARGS, `"use strict";\n${body}`);
        const shadows = SHADOW_ARGS.map(() => undefined);
        return factory(tslApi, uniforms, ...shadows);
    };

    let evaluated: unknown;
    let evalError: unknown = null;
    try {
        evaluated = runFactory(code);
    } catch (e) {
        evalError = e;
    }

    // 1) 提出コード自体が宣言済み関数を返した場合（return の入れ忘れ）: (tsl, u) で呼び出してノードを取り出す
    if (typeof evaluated === 'function') {
        const arity = evaluated.length;
        if (arity === 2) {
            return (evaluated as (tsl: unknown, u: unknown) => unknown)(tslApi, uniforms);
        }
        if (arity === 0) {
            return (evaluated as () => unknown)();
        }
        // 引数 1 個は契約外（(tsl, u) の 2 引数が原則）。下段のノード判定エラーへ流す
    }

    // 2) return の入れ忘れ / 単一式提出 / 関数宣言だけの提出の救済。
    //    複数の包装経路を順に試し、ノードらしき値が得られた時点で採用する。
    if (evalError !== null || evaluated === undefined || evaluated === null) {
        const fnName = detectSubmittedFunctionName(code);
        const attempts: string[] = [];
        if (fnName) {
            // 関数宣言だけを提出したケース: 宣言を残したまま末尾で (tsl, u) を渡して呼び出す
            attempts.push(`${TSL_FN_BODY_SNIPPET}${code}\nif (typeof ${fnName} === 'function') return ${fnName}(tsl, u);\n})(tsl, u)`);
        }
        if (!/\breturn\b/.test(code)) {
            // return を含まない単一式提出: 本体を式として評価して暗黙 return
            //（ブロック本体のアローは暗黙 return しないため式形式で包む）
            attempts.push(`return ((tsl, u) => (\n${code}\n))(tsl, u);`);
        }
        // フォールバック: ブロック包装（return が条件分岐内のみに存在する等の救済）
        attempts.push(`${TSL_FN_BODY_SNIPPET}${code}\n})(tsl, u)`);
        for (const body of attempts) {
            try {
                const wrapped = runFactory(body);
                if (wrapped !== undefined && wrapped !== null) {
                    return wrapped;
                }
            } catch {
                // この救済経路が失敗 → 次の経路へ
            }
        }
    }

    if (evalError !== null) {
        throw evalError;
    }
    return evaluated;
}

/**
 * 提出コード内で宣言されたシェーダー関数の名前を推定する（救済呼び出し用）。
 * 対象: function 宣言 / const・let + アロー / const・let + function 式。
 * return 済みの通常提出では使われない（呼び出し側のフォールバック経路のみ）。
 */
function detectSubmittedFunctionName(code: string): string | null {
    const patterns = [
        /(?:^|[\n;}])\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
        /(?:^|[\n;}])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
        /(?:^|[\n;}])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/,
    ];
    for (const re of patterns) {
        const m = code.match(re);
        if (m?.[1] && !['shaderCode', 'tsl', 'u'].includes(m[1])) {
            return m[1];
        }
    }
    return null;
}

/** 返り値が TSL ノードでない場合の診断文言（実際の型を添える） */
function describeNonNodeValue(value: unknown): string {
    if (value === undefined) return 'undefined（return の入れ忘れの可能性）';
    if (value === null) return 'null';
    if (typeof value === 'string') return `文字列 "${value.slice(0, 60)}"`;
    if (typeof value === 'function') return '関数（return の入れ忘れ、または引数不一致の可能性）';
    if (Array.isArray(value)) return '配列';
    if (typeof value === 'object') {
        const name = Object.getPrototypeOf(value)?.constructor?.name ?? 'unknown';
        return `オブジェクト (${name})`;
    }
    return `${typeof value} (${String(value).slice(0, 30)})`;
}

export async function compileTslShader(code: string): Promise<TslCompileResult> {
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return { ok: false, error: 'shaderCode が空です。(tsl, u) の本体として色ノードを return してください' };
    }
    try {
        const THREE = await import('three/webgpu');
        const { uniform } = THREE.TSL;
        const uniforms: ShaderUniforms = {
            uTimeSec: uniform(0),
            uLow: uniform(0.4),
            uMid: uniform(0.4),
            uHigh: uniform(0.3),
            uBeat: uniform(0.5),
            uEnergy: uniform(0.5),
        };
        const colorNode = await withTimeout(
            Promise.resolve().then(() =>
                evaluateShaderSubmission(code, THREE.TSL, uniforms),
            ),
            TSL_COMPILE_TIMEOUT_MS,
            'シェーダー本体の評価',
        );
        if (!colorNode || typeof colorNode !== 'object') {
            return {
                ok: false,
                error: `${TSL_NO_NODE_RETURNED_ERROR} 実際の返り値: ${describeNonNodeValue(colorNode)}`,
            };
        }
        // three ノードクラスの isNode マーカーを持つ値のみ通す。
        // プレーンオブジェクトや数値ラッパ等の偽ノードは後段のプローブ描画で
        // 検証不能になるため、ここで確実に遮断する。
        const isNodeLike = (colorNode as { isNode?: unknown }).isNode === true;
        if (!isNodeLike) {
            return {
                ok: false,
                error: `${TSL_NO_NODE_RETURNED_ERROR} 実際の返り値: ${describeNonNodeValue(colorNode)}（tsl.vec4 / tsl.mix 等、TSL ノード関数の結果を return してください）`,
            };
        }
        return { ok: true, error: null, colorNode, uniforms };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `コンパイル失敗: ${msg}` };
    }
}

/** プローブ1枚分の描画結果 RGBA */
interface ProbeCapture { pixels: Uint8ClampedArray; }

/**
 * 実ブラウザでプローブ描画を実行し、3 枚（時間・音響を変える）のピクセルを取得する。
 * WebGPURenderer は WebGPU 非対応環境で自動的に WebGL2 へフォールバックする。
 * レンダラーは呼び出しごとに生成・破棄する（状態を残さない純検証）。
 */
async function renderProbeFrames(
    colorNode: unknown,
    uniforms: ShaderUniforms,
): Promise<{ captures: ProbeCapture[]; backend: string }> {
    const THREE = await import('three/webgpu');
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const G = THREE as unknown as Record<string, new (...args: any[]) => any>;
    const NodeMaterial = G.NodeMaterial as new () => { colorNode: unknown };
    const OrthographicCamera = G.OrthographicCamera;
    const PlaneGeometry = G.PlaneGeometry;
    const Scene = G.Scene as new () => { add: (m: unknown) => void };
    const Mesh = G.Mesh;
    const RenderTarget = G.RenderTarget;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const { WebGPURenderer } = THREE as unknown as { WebGPURenderer: new (opts: Record<string, unknown>) => {
        init: () => Promise<void>;
        setRenderTarget: (t: unknown | null) => void;
        renderAsync: (scene: unknown, cam: unknown) => Promise<void>;
        // r185: 戻り値で TypedArray を受ける（旧来の受け取りバッファ渡しは不可）
        readRenderTargetPixelsAsync: (t: unknown, x: number, y: number, w: number, h: number) => Promise<Uint8Array | Uint8ClampedArray>;
        // r185: dispose は同期 API（旧 WebGPU 拡張の disposeAsync は廃止済み。存在しないメソッドを
        // finally で呼ぶとプローブ成功分の return も例外で握り潰され全件不合格になる）
        dispose: () => Promise<void> | void;
    } };

    const W = 64;
    const H = 64;
    const renderer = new WebGPURenderer(createShaderBackendOptions());
    await renderer.init();
    // 実バックエンドを記録（auto 指定でも未対応環境では WebGL2 にフォールバックする）。
    // AI への検証結果やデバッグログで「どのバックエンドで検証したか」を明示するのに使う。
    const backend = detectActualBackend(renderer) ?? 'unknown';

    try {
        const scene = new Scene();
        const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1) as unknown;
        const mat = new NodeMaterial();
        mat.colorNode = colorNode;
        const quad = new Mesh(new PlaneGeometry(2, 2), mat) as { frustumCulled: boolean };
        quad.frustumCulled = false;
        scene.add(quad);

        const rt = new RenderTarget(W, H) as unknown;
        const captures: ProbeCapture[] = [];
        // [時刻, uLow, uMid, uHigh, uBeat] — 全帯域を振らせることで、
        // uMid / uHigh など特定帯域のみに反応するシェーダーが「静止」と
        // 誤判定されることを防ぐ（uEnergy は low と beat から派生）
        const probeInputs: Array<[number, number, number, number, number]> = [
            [0.0, 0.05, 0.1, 0.9, 0.0],
            [1.5, 0.8, 0.2, 0.3, 0.6],
            [3.0, 0.2, 0.9, 0.1, 1.0],
        ];

        for (const [t, low, mid, high, beat] of probeInputs) {
            uniforms.uTimeSec.value = t;
            uniforms.uLow.value = low;
            uniforms.uMid.value = mid;
            uniforms.uHigh.value = high;
            uniforms.uBeat.value = beat;
            uniforms.uEnergy.value = Math.max(0, Math.min(1, (low + beat) / 2));
            renderer.setRenderTarget(rt);
            await renderer.renderAsync(scene, camera);
            const raw = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H);
            // バックエンド差（行パディング・行の向き）を吸収してタイト・上原点へ正規化
            const normalized = normalizePixels(raw, W, H, backend);
            if (!normalized) {
                throw new Error(`プローブ読み取りバッファの長さが不正です (raw=${raw.length})`);
            }
            captures.push({ pixels: new Uint8ClampedArray(normalized) });
        }
        return { captures, backend };
    } finally {
        renderer.setRenderTarget(null);
        // クリーンアップ失敗がプローブ成功分の return を握り潰さないよう防御する。
        // 実機バグ（2026-08）: three r185 に disposeAsync は存在せず、finally の
        // 存在しないメソッド呼び出し例外が try 内の return を破棄し、
        // 提出コードの質と無関係に全件不合格になっていた。
        try {
            // r185: dispose は同期 API（await は Promise/void 両対応）
            await renderer.dispose();
        } catch {
            // レンダラーは呼び出しごとに生成・破棄されるため、クリーンアップ失敗の
            // 漏れは許容。検証結果（captures / stats）を優先する
        }
    }
}

export interface TslVerificationResult {
    ok: boolean;
    error: string | null;
    stats?: ProbeSequenceStats;
    /** プローブ描画に使用された実バックエンド（'auto' = WebGPU / 'webgl2' / 'unknown'）。描画環境なしでは undefined */
    backend?: string;
}

/**
 * AI 生成シェーダーをコンパイルし、実描画プローブで検証するまでを一括実行する。
 * ブラウザ環境でない場合は描画検証をスキップし、コンパイル結果のみ返す。
 */
export async function verifyTslShader(code: string): Promise<TslVerificationResult> {
    const compiled = await compileTslShader(code);
    if (!compiled.ok) {
        return { ok: false, error: compiled.error };
    }
    if (typeof document === 'undefined') {
        // jsdom / Node では実描画検証不可。コンパイル通過のみを返す
        return { ok: true, error: null, stats: undefined };
    }
    try {
        const { captures, backend } = await withTimeout(renderProbeFrames(compiled.colorNode!, compiled.uniforms!), TSL_COMPILE_TIMEOUT_MS * 3, 'プローブ描画');
        const stats = analyzeProbeSequence(captures.map((c) => c.pixels));
        const judge = judgeProbeSequence(stats);
        return { ok: judge.ok, error: judge.reason, stats, backend };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `プローブ描画失敗: ${msg}` };
    }
}

