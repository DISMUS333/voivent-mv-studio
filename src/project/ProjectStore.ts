import type { RecentProject } from './ProjectTypes';

const STORAGE_KEY = 'voivent.recent-projects.v1';
const SNAPSHOT_KEY = 'voivent.active-project-snapshot.v1';
const MAX_RECENT_PROJECTS = 12;

function readRecentProjects(): RecentProject[] {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        return Array.isArray(value)
            ? value
                .filter((item): item is RecentProject => Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item))
                .map((item) => ({
                    ...item,
                    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) : [],
                    color: typeof item.color === 'string' ? item.color : undefined,
                }))
            : [];
    } catch {
        return [];
    }
}

export function getRecentProjects(): RecentProject[] {
    return readRecentProjects();
}

export function rememberProject(project: RecentProject): RecentProject[] {
    const next = [{ ...project, isRecent: true }, ...readRecentProjects().filter((item) => item.id !== project.id)].slice(0, MAX_RECENT_PROJECTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
}

export function forgetProject(projectId: string): RecentProject[] {
    const next = readRecentProjects().map((item) => item.id === projectId ? { ...item, isRecent: false } : item);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
}

/** 現在アクティブなプロジェクトデータ（セッション＋MV設定）をブラウザ共有用に保存 */
export function saveActiveProjectSnapshot(data: unknown): void {
    try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[ProjectStore] Failed to save active project snapshot:', e);
    }
}

/** ブラウザ共有用のアクティブプロジェクトデータを取得 */
export function getActiveProjectSnapshot<T = unknown>(): T | null {
    try {
        const raw = localStorage.getItem(SNAPSHOT_KEY);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}