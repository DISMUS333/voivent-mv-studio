//==============================================================================
// mvShaderBackend の単体テスト（jsdom / localStorage）
//==============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import {
    getShaderBackendMode,
    setShaderBackendMode,
    createShaderBackendOptions,
    detectActualBackend,
} from './mvShaderBackend';

describe('mvShaderBackend', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('既定は auto（WebGPU 優先）', () => {
        expect(getShaderBackendMode()).toBe('auto');
    });

    it('設定したモードが保存・復元される', () => {
        setShaderBackendMode('webgl2');
        expect(getShaderBackendMode()).toBe('webgl2');
        setShaderBackendMode('auto');
        expect(getShaderBackendMode()).toBe('auto');
    });

    it('auto では forceWebGL を含まない（WebGPU 優先・未対応時は three 側でフォールバック）', () => {
        const opts = createShaderBackendOptions();
        expect(opts.forceWebGL).toBeUndefined();
        expect(opts.antialias).toBe(false);
        expect(opts.alpha).toBe(true);
    });

    it('webgl2 では forceWebGL: true が付く', () => {
        setShaderBackendMode('webgl2');
        const opts = createShaderBackendOptions();
        expect(opts.forceWebGL).toBe(true);
        expect(opts.antialias).toBe(false);
        expect(opts.alpha).toBe(true);
    });

    it('壊れた localStorage 値は auto に正規化される', () => {
        localStorage.setItem('voivent_mv_shader_backend_v1', 'directx12');
        expect(getShaderBackendMode()).toBe('auto');
    });

    it('detectActualBackend: isWebGPUBackend ありは auto（WebGPU 実行中）', () => {
        expect(detectActualBackend({ backend: { isWebGPUBackend: true } })).toBe('auto');
    });

    it('detectActualBackend: isWebGPUBackend なしは webgl2（フォールバック実行中）', () => {
        expect(detectActualBackend({ backend: {} })).toBe('webgl2');
        expect(detectActualBackend({ backend: { isWebGPUBackend: false } })).toBe('webgl2');
    });

    it('detectActualBackend: backend 不在や不正入力は null', () => {
        expect(detectActualBackend({})).toBe(null);
        expect(detectActualBackend(null)).toBe(null);
        expect(detectActualBackend(undefined)).toBe(null);
    });

    it('modeOverride はグローバル設定を変更せず一時上書きできる（テスト用）', () => {
        setShaderBackendMode('auto');
        expect(createShaderBackendOptions('webgl2').forceWebGL).toBe(true);
        expect(getShaderBackendMode()).toBe('auto');
    });
});
