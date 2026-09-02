//==============================================================================
// mvShaderProbeStats / mvTslSandbox のテスト。
// AI 生成シェーダー検証ハーネスの純粋判定ロジックと、
// jsdom で検証可能なサンドボックス経路（コンパイル・契約・副作用遮断）を検証する。
//==============================================================================
import { describe, expect, it } from 'vitest';
import {
    analyzeFrame,
    analyzeProbeSequence,
    judgeProbeSequence,
} from './mvShaderProbeStats';
import {
    compileTslShader,
    TSL_SHADER_CONTRACT_DOC,
    TSL_COMPILE_TIMEOUT_MS,
} from './mvTslSandbox';

const W = 8;
const H = 8;

function solidFrame(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < px.length; i += 4) {
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
    return px;
}

/** 時間によって変化するグラデーション風フレーム */
function gradientFrame(shift: number): Uint8ClampedArray {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            px[i] = (x * 30 + shift * 80) % 256;
            px[i + 1] = (y * 20 + shift * 40) % 256;
            px[i + 2] = 120;
            px[i + 3] = 255;
        }
    }
    return px;
}

describe('analyzeFrame', () => {
    it('単色フレームは分散 0 になる', () => {
        const s = analyzeFrame(solidFrame(100, 100, 100));
        expect(s.colorVariance).toBe(0);
        expect(s.meanLuma).toBeCloseTo(100, 0);
        expect(s.opaqueRatio).toBe(1);
        expect(s.hasNaN).toBe(false);
    });

    it('NaN ピクセルを検出する（float バッファ。Uint8 系はクランプで NaN が消えるため）', () => {
        const px = new Float32Array(W * H * 4);
        px.fill(0.5);
        px[0] = Number.NaN;
        const s = analyzeFrame(px);
        expect(s.hasNaN).toBe(true);
    });

    it('透明フレームは opaqueRatio 0 になる', () => {
        const s = analyzeFrame(solidFrame(255, 255, 255, 0));
        expect(s.opaqueRatio).toBe(0);
    });
});

describe('judgeProbeSequence', () => {
    it('静止生成（全フレーム同一）は不合格・理由が AI に返せる文言', () => {
        const stats = analyzeProbeSequence([solidFrame(50, 50, 50), solidFrame(50, 50, 50), solidFrame(50, 50, 50)]);
        const j = judgeProbeSequence(stats);
        expect(j.ok).toBe(false);
        expect(j.reason).toContain('uniform');
    });

    it('単色塗りつぶしは不合格', () => {
        const stats = analyzeProbeSequence([solidFrame(10, 10, 10), solidFrame(200, 200, 200)]);
        const j = judgeProbeSequence(stats);
        expect(j.ok).toBe(false);
        expect(j.reason).toContain('単色');
    });

    it('全面透明は不合格', () => {
        const stats = analyzeProbeSequence([solidFrame(10, 10, 10, 0), solidFrame(200, 30, 30, 0)]);
        const j = judgeProbeSequence(stats);
        expect(j.ok).toBe(false);
        expect(j.reason).toContain('透明');
    });

    it('NaN は最優先で不合格（float バッファ）', () => {
        const px = new Float32Array(W * H * 4);
        px.fill(0.4);
        px[8] = Number.NaN;
        const stats = analyzeProbeSequence([px, gradientFrame(1), gradientFrame(2)]);
        const j = judgeProbeSequence(stats);
        expect(j.ok).toBe(false);
        expect(j.reason).toContain('NaN');
    });

    it('時間で変化する正常シェーダーは合格', () => {
        const stats = analyzeProbeSequence([gradientFrame(0), gradientFrame(1), gradientFrame(2)]);
        const j = judgeProbeSequence(stats);
        expect(j.ok).toBe(true);
        expect(j.reason).toBeNull();
    });
});

describe('compileTslShader (jsdom: 描画検証前のコンパイル経路)', () => {
    it('空コードは契約エラーを返す', async () => {
        const r = await compileTslShader('');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('shaderCode');
    });

    it('構文エラーコードはコンパイル失敗として捕捉される', async () => {
        const r = await compileTslShader('return tsl.vec4(tslll.uv()');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('コンパイル失敗');
    });

    it('関数を返さないコードは契約違反として捕捉される', async () => {
        const r = await compileTslShader('return 42;');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('(tsl, u)');
    });

    it('正常な TSL コードはコンパイルを通る（jsdom では描画検証は後段）', async () => {
        const r = await compileTslShader('return tsl.vec4(u.uLow, u.uBeat, tsl.uv().x, 1.0);');
        expect(r.ok).toBe(true);
        expect(r.error).toBeNull();
        expect(r.uniforms?.uTimeSec).toBeDefined();
    });

    it('DOM へのアクセスは遮断される（サンドボックス副作用防止）', async () => {
        const r = await compileTslShader('return (function(){ document.title = "hacked"; return tsl.vec4(1,1,1,1); })();');
        expect(r.ok).toBe(false);
    });

    it('契約ドキュメントに uniform 一式が記載されている', () => {
        for (const name of ['uTimeSec', 'uLow', 'uMid', 'uHigh', 'uBeat', 'uEnergy']) {
            expect(TSL_SHADER_CONTRACT_DOC).toContain(name);
        }
        expect(TSL_COMPILE_TIMEOUT_MS).toBeGreaterThan(0);
    });
});

describe('compileTslShader (提出形状の揺れの吸収)', () => {
    it('function 宣言だけを提出しても自動検出で (tsl, u) を渡して呼び出される', async () => {
        const r = await compileTslShader('function myShader(tsl, u) { return tsl.vec4(u.uLow, u.uBeat, tsl.uv().x, 1.0); }');
        expect(r.ok).toBe(true);
        expect(r.error).toBeNull();
    });

    it('関数宣言を return した場合も呼び出してノードを取り出す', async () => {
        const r = await compileTslShader('return function(tsl, u) { return tsl.vec4(tsl.uv().x, u.uLow, 0.3, 1.0); };');
        expect(r.ok).toBe(true);
    });

    it('アロー関数を return せず宣言だけした場合も救済される', async () => {
        const r = await compileTslShader('const shader = (tsl, u) => tsl.vec4(u.uLow, u.uBeat, tsl.uv().y, 1.0);');
        expect(r.ok).toBe(true);
    });

    it('return を含まない単一式提出は式評価で救済される', async () => {
        const r = await compileTslShader('tsl.vec4(u.uLow, u.uBeat, tsl.uv().x, 1.0)');
        expect(r.ok).toBe(true);
    });

    it('GLSL 文字列を返す提出は isNode ゲートで不合格・理由に実際の型が含まれる', async () => {
        const r = await compileTslShader('return "void main() { gl_FragColor = vec4(1.0); }";');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('TSL ノードではありません');
        expect(r.error).toContain('文字列');
    });

    it('プレーンオブジェクトを返す提出は isNode ゲートで不合格', async () => {
        const r = await compileTslShader('return { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('TSL ノードではありません');
        expect(r.error).toContain('オブジェクト');
    });

    it('undefined を返す提出（分岐漏れ）は不合格・入替提案が返る', async () => {
        const r = await compileTslShader('const unused = tsl.uv();');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('return の入れ忘れ');
    });
});

// プローブ描画経路（クリーンアップ握り潰しバグ）の回帰テストは
// mvTslSandbox.probe.test.ts（モックレンダラー使用）へ分離。
