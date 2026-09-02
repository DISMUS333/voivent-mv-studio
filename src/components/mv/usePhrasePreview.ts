//==============================================================================
// フレーズプレビュー再生フック。
// 歌詞フレーズ編集 UI の「▶」ボタンに応え、セッション再生位置を指定区間へ
// シークして再生を開始し、区間終端で自動停止する。中央ペインの大画面プレビュー
// は実セッション再生位置に同期しているため、このフックはトランスポート操作と
// 区間監視だけを担当する（描画は既存パイプラインに一任）。
//==============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { native } from '../../native';
import type { Status } from '../../types';

interface UsePhrasePreviewArgs {
    /** セッション状態（再生位置・再生中フラグの監視元。50ms ポーリングで更新される） */
    status: Status | null;
}

export interface PhrasePreviewController {
    /** プレビュー再生中のフレーズ id（未再生時は null） */
    previewingLyricId: string | null;
    /**
     * 指定区間のプレビュー再生を開始する。
     * 同一フレーズの再生中に再呼び出しした場合はトグル停止する。
     */
    startPreview: (startSec: number, endSec: number, lyricId: string) => void;
}

/** シーク失敗等の暴走保険（区間長 + この猶予で強制停止） */
const PREVIEW_DEADLINE_GRACE_MS = 5000;

export function usePhrasePreview({ status }: UsePhrasePreviewArgs): PhrasePreviewController {
    const [previewingLyricId, setPreviewingLyricId] = useState<string | null>(null);
    const activeIdRef = useRef<string | null>(null);
    const endSecRef = useRef<number | null>(null);
    // シークが区間内へ着地してから終端監視を開始するためのフラグ
    // （開始直後の旧再生位置が終端より先でも誤停止しないためのガード）
    const armedRef = useRef(false);
    const seenPlayingRef = useRef(false);
    const deadlineRef = useRef(0);

    const clearPreview = useCallback(() => {
        activeIdRef.current = null;
        endSecRef.current = null;
        armedRef.current = false;
        seenPlayingRef.current = false;
        setPreviewingLyricId(null);
    }, []);

    const startPreview = useCallback((startSec: number, endSec: number, lyricId: string) => {
        // 同一フレーズ再生中ならトグル停止
        if (activeIdRef.current === lyricId) {
            void native.stopSessionPlayback();
            clearPreview();
            return;
        }
        activeIdRef.current = lyricId;
        endSecRef.current = endSec;
        armedRef.current = false;
        seenPlayingRef.current = false;
        deadlineRef.current = Date.now() + Math.max(0, endSec - startSec) * 1000 + PREVIEW_DEADLINE_GRACE_MS;
        setPreviewingLyricId(lyricId);
        void (async () => {
            try {
                await native.setSessionPosition(Math.max(0, startSec));
                await native.startSessionPlayback();
            } catch {
                // ネイティブ側失敗時は監視のみ破棄（再生状態は触らない）
                clearPreview();
            }
        })();
    }, [clearPreview]);

    // 区間監視: 再生位置がプレビュー終端に達したら自動停止
    useEffect(() => {
        if (activeIdRef.current === null || endSecRef.current === null) return;
        const endSec = endSecRef.current;
        const playing = Boolean(status?.isSessionPlaying);
        const pos = status?.sessionPosition ?? 0;
        if (playing) seenPlayingRef.current = true;
        // シークが区間内（終端以前）へ着地したら終端監視をアーム
        if (!armedRef.current && pos <= endSec) armedRef.current = true;

        if (armedRef.current && (pos >= endSec || Date.now() > deadlineRef.current)) {
            void native.stopSessionPlayback();
            clearPreview();
        } else if (!playing && seenPlayingRef.current) {
            // ユーザーがトランスポートで手動停止した場合は監視のみ解除
            clearPreview();
        }
    }, [status, clearPreview]);

    // アンマウント時: プレビュー再生中なら停止して監視を破棄
    useEffect(() => {
        return () => {
            if (activeIdRef.current !== null) {
                void native.stopSessionPlayback();
            }
        };
    }, []);

    return { previewingLyricId, startPreview };
}