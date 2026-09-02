//==============================================================================
// プロジェクト管理カスタムフック。
// 新規作成、開く、保存、更新日時の最新化、履歴管理を一元化。
//==============================================================================
import { useState, useRef, useEffect, useCallback } from 'react';
import { native } from '../native';
import type { RecentProject } from '../project/ProjectTypes';
import {
    getRecentProjects,
    rememberProject,
    forgetProject,
    saveActiveProjectSnapshot,
} from '../project/ProjectStore';
import {
    getStoredMvConfigJson,
    setStoredMvConfigJson,
} from '../components/mv/useMvConfigStore';
import type { SessionState } from '../types';

export function useProjectManager() {
    const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
    const [currentProject, setCurrentProject] = useState<RecentProject | null>(null);
    const [showProjectStart, setShowProjectStart] = useState(true);
    const [saveState, setSaveState] = useState<'saved' | 'unsaved' | 'unavailable'>('saved');
    const [noticeText, setNoticeText] = useState<string>('');
    const [noticeTone, setNoticeTone] = useState<'info' | 'success' | 'error'>('info');

    const savedSessionRef = useRef<string | null>(null);

    // 通知の自動消去（4秒後）
    useEffect(() => {
        if (!noticeText) return;
        const timer = setTimeout(() => setNoticeText(''), 4000);
        return () => clearTimeout(timer);
    }, [noticeText]);

    // 起動時に最近使ったプロジェクト一覧を取得（ローカルAPIとlocalStorageの統合）
    useEffect(() => {
        const localList = getRecentProjects();
        if (localList.length > 0) {
            setRecentProjects(localList);
        }

        // ブラウザ単体（Vite）時は Mac 上のプロジェクト実データを直接フェッチ
        fetch('/api/recent-projects')
            .then((r) => (r.ok ? r.json() : null))
            .then((serverProjects) => {
                if (Array.isArray(serverProjects) && serverProjects.length > 0) {
                    setRecentProjects((prev) => {
                        const merged = [...serverProjects];
                        for (const p of prev) {
                            if (!merged.some((m) => m.id === p.id)) {
                                merged.push(p);
                            }
                        }
                        return merged;
                    });
                }
            })
            .catch(() => { /* noop */ });
    }, []);

    const showNotice = useCallback((text: string, tone: 'info' | 'success' | 'error' = 'info') => {
        setNoticeText(text);
        setNoticeTone(tone);
    }, []);

    const sessionFingerprint = useCallback((value: SessionState | null) => {
        return value ? JSON.stringify(value) : null;
    }, []);

    // セッション変更検知
    const checkSessionChanged = useCallback((session: SessionState | null) => {
        if (!currentProject || !session || !savedSessionRef.current) return;
        if (sessionFingerprint(session) !== savedSessionRef.current) {
            setSaveState('unsaved');
        }
    }, [currentProject, sessionFingerprint]);

    // 保存ダイアログをキャンセルしても保存ボタンが凍結しないよう、
    // 'unavailable' 状態は保存処理の実行中のみに限定する。
    const markSaveUnavailable = useCallback(() => {
        setSaveState('unavailable');
    }, []);

    // プロジェクト作成・入場
    const enterProject = useCallback((project: RecentProject, session?: SessionState | null) => {
        const nowIso = new Date().toISOString();
        const activeProject = { ...project, updatedAt: nowIso };
        setCurrentProject(activeProject);
        setRecentProjects(rememberProject(activeProject));
        setSaveState(project.path ? 'saved' : 'unsaved');
        // 入場時点のセッションを基準 fingerprint として記録する。
        // 未記録だと以後の変更検知が一切発火しない問題の防止。
        savedSessionRef.current = sessionFingerprint(session ?? null);
        setShowProjectStart(false);
        showNotice(`プロジェクト「${project.name}」を開始しました`, 'info');
    }, [sessionFingerprint, showNotice]);

    // プロジェクトを開く
    const openProject = useCallback(async (
        refreshSession: () => Promise<SessionState | null>,
        refreshStatus: () => Promise<void>
    ) => {
        try {
            const selectedPath = await native.openProjectDialog();
            if (typeof selectedPath !== 'string' || !selectedPath) return;
            const ok = await native.loadProject(selectedPath);
            if (!ok) throw new Error('プロジェクトを読み込めませんでした。');

            // 🎬 MV設定・歌詞の復元。ネイティブ側で旧プロジェクト由来の
            // 設定はクリア済みのため、ここでは空設定を書き込まない。
            try {
                const loadedMvJson = await native.getMvConfig();
                if (loadedMvJson && loadedMvJson !== '{}') {
                    setStoredMvConfigJson(selectedPath, loadedMvJson);
                }
            } catch { /* noop */ }

            const name = selectedPath.split('/').filter(Boolean).pop() || '読み込んだプロジェクト';
            const nowIso = new Date().toISOString();
            const project: RecentProject = {
                id: selectedPath,
                name,
                path: selectedPath,
                updatedAt: nowIso,
            };
            setCurrentProject(project);
            setRecentProjects(rememberProject(project));

            const loadedSession = await refreshSession();
            savedSessionRef.current = sessionFingerprint(loadedSession);
            setSaveState('saved');
            setShowProjectStart(false);
            await refreshStatus();
            // ロード成功でも WAV 欠損クリップがある場合は警告する。
            await warnIfMissingClips(refreshStatus);
            showNotice('プロジェクトを読み込みました。', 'success');
        } catch (e) {
            showNotice(String(e), 'error');
        }
    }, [sessionFingerprint, showNotice]);

    // 最近のプロジェクト一覧から選択して開く
    const selectRecentProject = useCallback(async (
        project: RecentProject,
        refreshSession: () => Promise<SessionState | null>,
        refreshStatus: () => Promise<void>
    ) => {
        if (!project.path) {
            enterProject(project);
            return;
        }

        // ブラウザ単体（ChatGPT内蔵ブラウザ等）環境では API 経由で即座に入場
        const isBrowserStandalone = typeof window !== 'undefined' && !(window as any).__JUCE__?.backend;
        if (isBrowserStandalone) {
            try {
                const res = await fetch(`/api/load-project?path=${encodeURIComponent(project.path)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data?.mvConfig) {
                        setStoredMvConfigJson(project.path, JSON.stringify(data.mvConfig));
                    }
                }
            } catch { /* noop */ }
            enterProject(project);
            return;
        }

        try {
            const ok = await native.loadProject(project.path);
            if (!ok) {
                enterProject(project);
                return;
            }

            // 🎬 MV設定・歌詞の復元。
            try {
                const loadedMvJson = await native.getMvConfig();
                if (loadedMvJson && loadedMvJson !== '{}') {
                    setStoredMvConfigJson(project.path, loadedMvJson);
                }
            } catch { /* noop */ }

            const nowIso = new Date().toISOString();
            const activeProject = { ...project, updatedAt: nowIso };
            setCurrentProject(activeProject);
            setRecentProjects(rememberProject(activeProject));

            const loadedSession = await refreshSession();
            savedSessionRef.current = sessionFingerprint(loadedSession);
            setSaveState('saved');
            setShowProjectStart(false);
            await refreshStatus();
            await warnIfMissingClips(refreshStatus);
            showNotice('プロジェクトを開きました。', 'success');
        } catch (e) {
            enterProject(project);
        }
    }, [enterProject, sessionFingerprint, showNotice]);

    // 直近ロード時の WAV 欠損クリップ数を取得し、1件以上あれば警告する。
    const warnIfMissingClips = useCallback(async (
        refreshStatus: () => Promise<void>
    ) => {
        try {
            const st = await native.getStatus();
            const missing = Number(st?.loadMissingClips ?? 0);
            if (missing > 0) {
                showNotice(
                    `WAV ファイルが見つからないクリップが ${missing} 件あります。該当クリップは読み込まれていません。`,
                    'error'
                );
            }
        } catch { /* noop */ }
        void refreshStatus;
    }, [showNotice]);

    // プロジェクト保存
    const saveProject = useCallback(async (
        session: SessionState | null,
        refreshSession: () => Promise<SessionState | null>
    ) => {
        if (!currentProject) return;
        markSaveUnavailable();
        try {
            const selectedParentPath = currentProject.path
                ?? (await native.saveProjectDialog());
            if (typeof selectedParentPath !== 'string' || !selectedParentPath) {
                // キャンセル時は直前の状態へ戻す（保存ボタン凍結の防止）。
                setSaveState(currentProject.path ? 'unsaved' : 'saved');
                return;
            }

            // 新規プロジェクトは、選択した場所の中にプロジェクト名のフォルダを作る
            const projectPath = currentProject.path
                ?? `${selectedParentPath.replace(/\/+$/, '')}/${currentProject.name
                    .trim()
                    .replace(/[\\/:*?"<>|]/g, '_') || '新規プロジェクト'}`;

            // 🎬 現在のプロジェクトの MV 設定・歌詞 JSON を取得して同梱保存
            const currentMvJson = getStoredMvConfigJson(currentProject.path)
                ?? getStoredMvConfigJson(null);

            const ok = await native.saveProject(projectPath, currentMvJson ?? undefined);
            if (!ok) throw new Error('プロジェクトを保存できませんでした。（録音中の場合は停止後に保存してください）');

            // 保存先パスが決まった場合は MV 設定も新パスへ保存
            if (currentMvJson && projectPath !== currentProject.path) {
                setStoredMvConfigJson(projectPath, currentMvJson);
            }

            // ★ 保存時に updated_at を確実に最新化してストアに反映
            const nowIso = new Date().toISOString();
            const savedProject: RecentProject = {
                ...currentProject,
                path: projectPath,
                updatedAt: nowIso,
            };
            setCurrentProject(savedProject);
            setRecentProjects(rememberProject(savedProject));

            const savedSession = await refreshSession();
            savedSessionRef.current = sessionFingerprint(savedSession ?? session);
            setSaveState('saved');
            showNotice('プロジェクトを保存しました。', 'success');
        } catch (e) {
            setSaveState(currentProject.path ? 'unsaved' : 'saved');
            showNotice(String(e), 'error');
        }
    }, [currentProject, markSaveUnavailable, sessionFingerprint, showNotice]);

    // バックアップ成功時の更新日時同期
    const onBackupSuccess = useCallback((timestampIso: string) => {
        if (!currentProject) return;
        const updated = { ...currentProject, updatedAt: timestampIso };
        setCurrentProject(updated);
        setRecentProjects(rememberProject(updated));
    }, [currentProject]);

    // 最近のプロジェクトのタグ編集等の更新
    const updateRecentProject = useCallback((project: RecentProject) => {
        setRecentProjects(rememberProject(project));
        if (currentProject?.id === project.id) {
            setCurrentProject(project);
        }
    }, [currentProject?.id]);

    // 最近のプロジェクトから削除
    const forgetRecentProject = useCallback((project: RecentProject) => {
        setRecentProjects(forgetProject(project.id));
    }, []);

    return {
        recentProjects,
        currentProject,
        showProjectStart,
        saveState,
        noticeText,
        noticeTone,
        savedSessionRef,
        setShowProjectStart,
        setSaveState,
        showNotice,
        checkSessionChanged,
        enterProject,
        openProject,
        selectRecentProject,
        saveProject,
        onBackupSuccess,
        updateRecentProject,
        forgetRecentProject,
    };
}
