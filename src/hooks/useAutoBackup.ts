//==============================================================================
// 自動バックアップ管理フック。
// アイドル時にプロジェクト配下の Backups/ フォルダへ世代スナップショットを自動保存。
//==============================================================================
import { useEffect, useRef, useCallback } from 'react';
import { native } from '../native';
import type { RecentProject } from '../project/ProjectTypes';

type AutoBackupOptions = {
    project: RecentProject | null;
    saveState: 'saved' | 'unsaved' | 'unavailable';
    isPlaying?: boolean;
    isRecording?: boolean;
    intervalMinutes?: number;
    maxBackups?: number;
    onBackupSuccess?: (timestamp: string) => void;
};

export function useAutoBackup({
    project,
    saveState,
    isPlaying = false,
    isRecording = false,
    intervalMinutes = 5,
    maxBackups = 10,
    onBackupSuccess,
}: AutoBackupOptions) {
    const isBackingUpRef = useRef(false);
    const lastBackupTimeRef = useRef<number>(Date.now());
    // 録音・再生状態はコールバック内で最新値を読むため ref へ保持する。
    const busyRef = useRef(false);
    useEffect(() => {
        busyRef.current = Boolean(isPlaying || isRecording);
    }, [isPlaying, isRecording]);

    const performBackup = useCallback(async (force = false) => {
        // プロジェクトパスがない（一度も保存先が指定されていない）場合はスキップ
        if (!project?.path || isBackingUpRef.current) return;
        // 再生中や録音中など高負荷・RT処理中はスキップ
        if (!force && busyRef.current) return;
        // セッションが保存準備中などの場合はスキップ
        if (!force && saveState === 'unavailable') return;

        isBackingUpRef.current = true;
        try {
            const ok = await native.autoBackupProject(project.path, maxBackups);
            if (ok) {
                const nowIso = new Date().toISOString();
                lastBackupTimeRef.current = Date.now();
                onBackupSuccess?.(nowIso);
            }
        } catch (e) {
            console.warn('[AutoBackup] Failed to create backup:', e);
        } finally {
            isBackingUpRef.current = false;
        }
    }, [project?.path, saveState, maxBackups, onBackupSuccess]);

    // 定期バックアップタイマー
    useEffect(() => {
        if (!project?.path || intervalMinutes <= 0) return;

        const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
        const timerId = setInterval(() => {
            const now = Date.now();
            const elapsed = now - lastBackupTimeRef.current;
            // 設定間隔（例: 5分）以上が経過しており、かつ未保存の変更がある場合にのみバックアップを実行
            if (elapsed >= intervalMs && saveState === 'unsaved') {
                void performBackup();
            }
        }, 15000); // 15秒ごとにアイドル状態・経過時間をチェック

        return () => clearInterval(timerId);
    }, [project?.path, intervalMinutes, saveState, performBackup]);

    return {
        triggerBackup: performBackup,
    };
}