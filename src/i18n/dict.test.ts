//==============================================================================
// 翻訳辞書 (dict) の整合性テスト。
// ja / en で「キー集合 + 値の種類 (文字列 / 関数)」が完全一致することを強制し、
// 片言語だけ補間関数にする等の形状ズレをコンパイル・テストの両面で検知する。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { DICTS } from './dict';

describe('dict — ja / en 辞書の整合', () => {
    it('全キーの値が ja / en で同じ種類 (文字列 / 関数) である', () => {
        const jaDict = DICTS.ja as Record<string, unknown>;
        const enDict = DICTS.en as Record<string, unknown>;
        for (const key of Object.keys(jaDict)) {
            expect(typeof enDict[key], `key: ${key}`).toBe(typeof jaDict[key]);
        }
    });

    it('補間関数キーは呼び出して文字列を返す (代表キーのサニティ)', () => {
        expect(DICTS.ja.sceneN(2)).toContain('2');
        expect(DICTS.en.sceneN(2)).toContain('2');
        expect(DICTS.ja.aiPromptSceneTime('1.0', '5.0', '4.0')).toContain('5.0');
        expect(DICTS.en.aiPromptSceneTime('1.0', '5.0', '4.0')).toContain('5.0');
    });
});
