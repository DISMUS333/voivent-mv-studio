//==============================================================================
// AI 生成シェーダー（TSL）用バックエンド選択の単一ソース。
//
// 設計方針（2026-08 改訂: WebGL2 統一から auto 選択へ）:
// - 'auto'（既定）: WebGPU を優先。未対応環境では three 側の getFallback により
//   自動で WebGL2 にフォールバックする（描画コードは TSL 共通で一切変更不要）。
//   WebGPU の方が合成品質・将来拡張性が高いため既定を上げている。
// - 'webgl2': 常に WebGL2 固定。ライブ = 書き出しの完全一致を最優先したい
//   環境向けの明示スイッチ。
//
// 一貫性の核心:
// - 判定は「マシン単位」（ブラウザ / プロセス単位）で不変なため、単一グローバルで
//   ライブ / プローブ / オフライン書き出しの全経路が同一バックエンドを得る。
// - プロジェクトをまたいで state が共有されないよう、MV 設定 (useMvConfigStore)
//   とは分離し、グローバル localStorage に永続化する。
// - 3 経路は必ず createShaderBackendOptions() 経由でオプションを組み立てること。
//   生の forceWebGL を各所に書くと一貫性が壊れるため禁止。
//==============================================================================

/** シェーダー描画バックエンドの選択モード */
export type ShaderBackendMode = 'auto' | 'webgl2';

const STORAGE_KEY = 'voivent_mv_shader_backend_v1';
const VALID_MODES: readonly ShaderBackendMode[] = ['auto', 'webgl2'];

/** グローバル設定の読み取り（壊れた値は auto に正規化） */
export function getShaderBackendMode(): ShaderBackendMode {
    // デバッグ用 URL パラメータ (?backend=webgl2 / ?backend=auto) を最優先。
    // UI は一般ユーザーに非公開。描画不一致の切り分けなど開発時のみ使用する。
    try {
        if (typeof location !== 'undefined' && location.search) {
            const m = new URLSearchParams(location.search).get('backend');
            if (m === 'webgl2' || m === 'auto') return m;
        }
    } catch { /* URL 解析不可時は保存値へフォールバック */ }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw && (VALID_MODES as readonly string[]).includes(raw)) {
            return raw as ShaderBackendMode;
        }
    } catch { /* localStorage 不具合時は既定 */ }
    return 'auto';
}

/** グローバル設定の保存 */
export function setShaderBackendMode(mode: ShaderBackendMode): void {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch { /* noop */ }
}

/** renderer.backend の実バックエンド種別を取得（判定不能時は null） */
export function detectActualBackend(renderer: unknown): ShaderBackendMode | null {
    try {
        const backend = (renderer as { backend?: { isWebGPUBackend?: boolean } }).backend;
        if (!backend) return null;
        return backend.isWebGPUBackend ? 'auto' : 'webgl2';
    } catch {
        return null;
    }
}

/**
 * 3 経路共通の WebGPURenderer コンストラクタオプションを組み立てる。
 *
 * - 'auto'   : forceWebGL を渡さない → WebGPUBackend 生成を試み、失敗時
 *              three 内部の getFallback で WebGLBackend (WebGL2) に落ちる。
 * - 'webgl2' : forceWebGL: true → 常に WebGLBackend。
 *
 * modeOverride はテスト・特殊用途向け。通常は呼び出し側で指定しないこと
 * （指定すると 3 経路のバックエンド一貫性が崩れる）。
 */
export function createShaderBackendOptions(
    modeOverride?: ShaderBackendMode,
): Record<string, unknown> {
    const base: Record<string, unknown> = { antialias: false, alpha: true };
    const mode = modeOverride ?? getShaderBackendMode();
    if (mode === 'webgl2') {
        base.forceWebGL = true;
    }
    return base;
}
