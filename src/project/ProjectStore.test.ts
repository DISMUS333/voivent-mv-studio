//==============================================================================
// project/ProjectStore.ts の単体テスト
// localStorage 正規化ロジック（重複排除・上限・破損データ耐性）を検証する
//==============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { getRecentProjects, rememberProject, forgetProject } from './ProjectStore';
import type { RecentProject } from './ProjectTypes';

const STORAGE_KEY = 'voivent.recent-projects.v1';

function makeProject(id: string, overrides: Partial<RecentProject> = {}): RecentProject {
    return {
        id,
        name: `Project ${id}`,
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('getRecentProjects', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('PS-03: 空のストレージでは空配列を返す', () => {
        expect(getRecentProjects()).toEqual([]);
    });

    it('PS-03: 不正 JSON でもクラッシュせず空配列へ正規化される', () => {
        localStorage.setItem(STORAGE_KEY, '{not valid json');
        expect(getRecentProjects()).toEqual([]);
    });

    it('PS-03: 非配列データ（オブジェクト等）でも空配列へ正規化される', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
        expect(getRecentProjects()).toEqual([]);

        localStorage.setItem(STORAGE_KEY, JSON.stringify('string'));
        expect(getRecentProjects()).toEqual([]);

        localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
        expect(getRecentProjects()).toEqual([]);
    });

    it('PS-03: 異型要素（null / id 無し / name 無し）は除外される', () => {
        const mixed = [
            null,
            'string-item',
            { id: 'a' }, // name 無し
            { name: 'no-id' }, // id 無し
            makeProject('valid'),
        ];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mixed));
        const result = getRecentProjects();
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('valid');
    });
});

describe('rememberProject', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('PS-01: プロジェクトを先頭に追加する', () => {
        rememberProject(makeProject('a'));
        const result = rememberProject(makeProject('b'));
        expect(result.map((p) => p.id)).toEqual(['b', 'a']);
        expect(result[0].isRecent).toBe(true);
    });

    it('PS-01: 同一 id の既存エントリは重複せず先頭へ移動する', () => {
        rememberProject(makeProject('a'));
        rememberProject(makeProject('b'));
        rememberProject(makeProject('c'));
        const result = rememberProject(makeProject('a', { name: 'Renamed A' }));
        expect(result.map((p) => p.id)).toEqual(['a', 'c', 'b']);
        expect(result.find((p) => p.id === 'a')?.name).toBe('Renamed A');
    });

    it('PS-01: 12 件を超えると最も古いエントリが落ちる', () => {
        for (let i = 0; i < 12; i++) {
            rememberProject(makeProject(`p${i}`));
        }
        const result = rememberProject(makeProject('new'));
        expect(result).toHaveLength(12);
        expect(result[0].id).toBe('new');
        expect(result.some((p) => p.id === 'p0')).toBe(false); // 最古 (p0) が削除
        expect(result[result.length - 1].id).toBe('p1');       // 残った最古は p1
    });

    it('結果は localStorage へ永続化される', () => {
        rememberProject(makeProject('persisted'));
        expect(getRecentProjects().map((p) => p.id)).toEqual(['persisted']);
    });
});

describe('forgetProject', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('PS-02: 指定 id の isRecent のみ false 化し、エントリ自体は残る', () => {
        rememberProject(makeProject('a'));
        rememberProject(makeProject('b'));

        const result = forgetProject('a');
        expect(result.find((p) => p.id === 'a')?.isRecent).toBe(false);
        expect(result.find((p) => p.id === 'b')?.isRecent).toBe(true);
        // エントリ数は変わらない
        expect(result).toHaveLength(2);

        // 永続化も反映される
        expect(getRecentProjects()).toHaveLength(2);
    });

    it('存在しない id を指定しても無副作用で全件維持される', () => {
        rememberProject(makeProject('a'));
        const result = forgetProject('missing');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('a');
        expect(result[0].isRecent).toBe(true);
    });
});

describe('tags / color の正規化', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('PS-04: 文字列以外・空白のみの tag は除去される', () => {
        const dirty = {
            ...makeProject('tagged'),
            tags: ['ok', 42, null, '   ', '', { obj: true }, 'fine'] as unknown as string[],
        };
        rememberProject(dirty);
        const result = getRecentProjects();
        expect(result[0].tags).toEqual(['ok', 'fine']);
    });

    it('PS-04: tags が配列でない場合は空配列へ正規化される', () => {
        const dirty = {
            ...makeProject('bad-tags'),
            tags: 'not-an-array' as unknown as string[],
        };
        rememberProject(dirty);
        expect(getRecentProjects()[0].tags).toEqual([]);
    });

    it('PS-04: color が文字列以外の場合は undefined へ正規化される', () => {
        const dirty = {
            ...makeProject('bad-color'),
            color: 12345 as unknown as string,
        };
        rememberProject(dirty);
        expect(getRecentProjects()[0].color).toBeUndefined();
    });
});