//==============================================================================
// MV シーン操作の純粋関数ユーティリティ。
// 追加・複製・削除・並べ替え・時間正規化など、エディタ UI から分離した
// テスト可能なコアロジックを提供する。
//==============================================================================
import type { LyricItem, MvProjectConfig, MvScene } from './types';
import { getDict } from '../../i18n';

/** 新規シーン ID を生成 */
export function createSceneId(): string {
    return `scene_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 空の新規シーンを作成 */
export function createEmptyScene(startTime: number, endTime: number, name?: string): MvScene {
    const t = getDict();
    return {
        id: createSceneId(),
        name: name || t.newScene,
        startTime,
        endTime,
        svgCode: `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0a0d14;color:#64748b;font-size:18px;font-weight:700;">${name || t.untitled}</div>`,
    };
}

/** シーンを複製（ID は新規発行、名前にコピー接尾辞） */
export function duplicateScene(scene: MvScene): MvScene {
    return {
        ...scene,
        id: createSceneId(),
        name: getDict().copySuffix(scene.name),
    };
}

/** シーン配列を開始時刻順にソート */
export function sortScenes(scenes: MvScene[]): MvScene[] {
    return [...scenes].sort((a, b) => a.startTime - b.startTime);
}

/**
 * シーンを移動して時間帯を変更。隣接シーンとの重なりを解消する。
 * @returns 正規化済みシーン配列
 */
export function moveSceneTime(
    scenes: MvScene[],
    sceneId: string,
    newStart: number,
    totalDuration: number,
): MvScene[] {
    const sorted = sortScenes(scenes);
    const idx = sorted.findIndex((s) => s.id === sceneId);
    if (idx === -1) return scenes;

    const clamped = Math.max(0, Math.min(newStart, totalDuration - 0.5));
    const next = [...sorted];
    const target = { ...next[idx] };
    const dur = Math.max(0.5, target.endTime - target.startTime);
    target.startTime = clamped;
    target.endTime = clamped + dur;

    // 前後のシーンと重ならないよう押し込み
    if (idx > 0 && target.startTime < next[idx - 1].endTime) {
        target.startTime = next[idx - 1].endTime;
        target.endTime = target.startTime + dur;
    }
    if (idx < next.length - 1 && target.endTime > next[idx + 1].startTime) {
        target.endTime = next[idx + 1].startTime;
        target.startTime = Math.max(next[idx - 1]?.endTime ?? 0, target.endTime - dur);
    }

    next[idx] = target;
    return next;
}

/** シーンの長さを変更（次のシーン開始位置までクランプ） */
export function resizeScene(
    scenes: MvScene[],
    sceneId: string,
    newEndTime: number,
): MvScene[] {
    const idx = scenes.findIndex((s) => s.id === sceneId);
    if (idx === -1) return scenes;
    const next = [...scenes];
    const target = { ...next[idx] };
    const minEnd = target.startTime + 0.5;
    const maxEnd = idx < scenes.length - 1 ? scenes[idx + 1].startTime : Infinity;
    target.endTime = Math.max(minEnd, Math.min(newEndTime, maxEnd));
    next[idx] = target;
    return next;
}

/** シーンを削除し、時間軸の隙間を後続で埋める */
export function deleteScene(scenes: MvScene[], sceneId: string): MvScene[] {
    return deleteScenes(scenes, [sceneId]);
}

/** 複数シーンを一括削除し、残ったシーンでタイムラインの連続性を維持する */
export function deleteScenes(scenes: MvScene[], sceneIds: Set<string> | string[]): MvScene[] {
    const idSet = sceneIds instanceof Set ? sceneIds : new Set(sceneIds);
    const sorted = sortScenes(scenes);
    const remaining = sorted.filter((s) => !idSet.has(s.id));
    if (remaining.length === 0) {
        // 全て削除しようとした場合は先頭1つだけ残す（初期化）
        return [{
            ...sorted[0],
            startTime: 0,
            endTime: Math.max(1, sorted[0].endTime),
        }];
    }
    // 残ったシーンを先頭から隙間なく詰める
    let currentT = 0;
    const adjusted = remaining.map((s, i) => {
        const dur = Math.max(0.5, s.endTime - s.startTime);
        const st = i === 0 ? 0 : currentT;
        const et = st + dur;
        currentT = et;
        return {
            ...s,
            startTime: st,
            endTime: et,
        };
    });
    return adjusted;
}

/** 音声の終端を超えるシーン終端を、実際の音声長へクランプする。 */
export function clampSceneEndsToDuration(scenes: MvScene[], durationSec: number): MvScene[] {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return scenes;

    let changed = false;
    const next = scenes.map((scene) => {
        const endTime = Math.min(scene.endTime, durationSec);
        if (endTime === scene.endTime) return scene;
        changed = true;
        return { ...scene, endTime };
    });
    return changed ? next : scenes;
}

/** 指定時刻でアクティブになるシーンを取得 */
export function findActiveScene(scenes: MvScene[], timeSec: number): MvScene | null {
    for (const s of scenes) {
        if (timeSec >= s.startTime && timeSec < s.endTime) return s;
    }
    return null;
}

//==============================================================================
// グリッドスナップ（BPM 同期）ユーティリティ
//==============================================================================

/**
 * 時刻を最寄りのグリッド位置へスナップする。
 * @param gridSec グリッド間隔（秒）。0 以下の場合は元値をそのまま返す
 */
export function snapToGrid(timeSec: number, gridSec: number): number {
    if (!(gridSec > 0)) return timeSec;
    const snapped = Math.round(timeSec / gridSec) * gridSec;
    // 浮動小数点誤差をミリ秒精度で丸める
    return Math.round(snapped * 1000) / 1000;
}

/**
 * BPM と拍数からグリッド間隔（秒）を算出する。
 * @param bpm テンポ（無効値は 120 扱い、20〜300 にクランプ）
 * @param beatsPerGrid グリッド 1 区分あたりの拍数（例: 1 = 1拍, 4 = 1小節）
 */
export function gridSecondsFromBpm(bpm: number, beatsPerGrid: number): number {
    const safeBpm = Math.max(20, Math.min(300, bpm > 0 ? bpm : 120));
    return (60 / safeBpm) * Math.max(0.25, beatsPerGrid);
}

/** moveSceneTime のグリッドスナップ版 */
export function moveSceneTimeSnapped(
    scenes: MvScene[],
    sceneId: string,
    newStart: number,
    totalDuration: number,
    gridSec?: number,
): MvScene[] {
    return moveSceneTime(scenes, sceneId, snapToGrid(newStart, gridSec ?? 0), totalDuration);
}

/** resizeScene のグリッドスナップ版 */
export function resizeSceneSnapped(
    scenes: MvScene[],
    sceneId: string,
    newEndTime: number,
    gridSec?: number,
): MvScene[] {
    return resizeScene(scenes, sceneId, snapToGrid(newEndTime, gridSec ?? 0));
}

/** シーンの左端リサイズ（開始時刻トリム） */
export function resizeSceneStart(
    scenes: MvScene[],
    sceneId: string,
    newStartTime: number,
): MvScene[] {
    const sorted = sortScenes(scenes);
    const idx = sorted.findIndex((s) => s.id === sceneId);
    if (idx === -1) return scenes;

    const target = { ...sorted[idx] };
    const minStart = idx > 0 ? sorted[idx - 1].endTime : 0;
    const maxStart = target.endTime - 0.5;
    target.startTime = Math.max(minStart, Math.min(newStartTime, maxStart));

    const next = [...sorted];
    next[idx] = target;
    return next;
}

/** resizeSceneStart のグリッドスナップ版 */
export function resizeSceneStartSnapped(
    scenes: MvScene[],
    sceneId: string,
    newStartTime: number,
    gridSec?: number,
): MvScene[] {
    return resizeSceneStart(scenes, sceneId, snapToGrid(newStartTime, gridSec ?? 0));
}

/**
 * 指定時刻で該当シーンを2分割（カット）する。
 * 分割点（splitTime）がシーンの startTime + 0.2 から endTime - 0.2 の範囲内にある場合のみ分割を行う。
 * 分割後の前半シーンは endTime を splitTime に変更し、
 * 後半シーン（新シーン）は startTime を splitTime、endTime を元の endTime として生成する。
 * @param scenes シーン配列
 * @param splitTime 分割する時刻（秒）
 * @param extraAfterProps 後半シーンに上書き適用するプロパティ（例: { backgroundImageId: 'xxx' }）
 * @returns { scenes: MvScene[]; newSceneId: string | null }
 */
export function splitSceneAtTime(
    scenes: MvScene[],
    splitTime: number,
    extraAfterProps?: Partial<MvScene>,
): { scenes: MvScene[]; newSceneId: string | null } {
    const sorted = sortScenes(scenes);
    const idx = sorted.findIndex((s) => splitTime > s.startTime + 0.2 && splitTime < s.endTime - 0.2);
    if (idx === -1) {
        return { scenes, newSceneId: null };
    }
    const original = sorted[idx];
    const firstScene: MvScene = {
        ...original,
        endTime: splitTime,
    };
    const newSceneId = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const secondScene: MvScene = {
        ...original,
        id: newSceneId,
        startTime: splitTime,
        endTime: original.endTime,
        ...extraAfterProps,
    };
    const next = [...sorted];
    next.splice(idx, 1, firstScene, secondScene);
    return { scenes: next, newSceneId };
}

//==============================================================================
// 歌詞ユーティリティ
//==============================================================================

/** 歌詞を開始時刻順にソート */
export function sortLyrics(lyrics: LyricItem[]): LyricItem[] {
    return [...lyrics].sort((a, b) => a.time - b.time);
}

/** 歌詞の duration を補完（未指定時は次の歌詞まで or 4秒） */
export function withResolvedDurations(lyrics: LyricItem[]): Array<LyricItem & { resolvedDuration: number }> {
    const sorted = sortLyrics(lyrics);
    return sorted.map((l, i) => ({
        ...l,
        resolvedDuration: l.duration ?? (i < sorted.length - 1 ? sorted[i + 1].time - l.time : 4.0),
    }));
}

/** LRC 形式テキストをパース（[mm:ss.xx] 歌詞） */
export function parseLrc(text: string): LyricItem[] {
    const result: LyricItem[] = [];
    const lineRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    for (const rawLine of text.split(/\r?\n/)) {
        const stamps = [...rawLine.matchAll(lineRe)];
        if (stamps.length === 0) continue;
        const content = rawLine.replace(lineRe, '').trim();
        if (!content) continue;
        for (const m of stamps) {
            const mm = parseInt(m[1], 10);
            const ss = parseInt(m[2], 10);
            const fracRaw = m[3] ?? '0';
            const frac = parseInt(fracRaw.padEnd(3, '0').slice(0, 3), 10) / 1000;
            result.push({ time: mm * 60 + ss + frac, text: content });
        }
    }
    return sortLyrics(result);
}

/** 歌詞配列を LRC 形式テキストへ書き出し */
export function toLrc(lyrics: LyricItem[]): string {
    const fmt = (t: number) => {
        const mm = Math.floor(t / 60);
        const ss = Math.floor(t % 60);
        const cs = Math.round((t - Math.floor(t)) * 100);
        return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    };
    return sortLyrics(lyrics)
        .map((l) => `[${fmt(l.time)}]${l.text}`)
        .join(String.fromCharCode(10));
}

//==============================================================================
// フレーズプレビュー区間計算
//==============================================================================

/** フレーズプレビューの既定前戻り秒数（フレーズ開始の何秒前から再生するか） */
export const PHRASE_PREVIEW_LEAD_SEC = 2;

/** フレーズプレビューの既定終了テール秒数（フレーズ終了の何秒後まで再生するか） */
export const PHRASE_PREVIEW_TAIL_SEC = 1;

/**
 * フレーズ（歌詞）プレビューの再生区間を計算する。
 * フレーズ開始の leadSec 前から終了 + tailSec 後までを返す。
 * 前戻りが直前フレーズの末尾と重なる場合はその境界でクリップし、
 * 負の時刻は 0 にクランプする。
 * @param lyricStart フレーズ開始秒（無効値・負値は 0 扱い）
 * @param lyricDuration フレーズ持続秒（無効値・0 以下は既定 4 秒扱い）
 * @param leadSec 前戻り秒数（既定 2 秒）
 * @param tailSec 終了テール秒数（既定 1 秒）
 * @param prevPhraseEnd 直前フレーズの終了秒（重なりクリップ用・省略可）
 */
export function computePhrasePreviewWindow(
    lyricStart: number,
    lyricDuration: number | undefined,
    leadSec: number = PHRASE_PREVIEW_LEAD_SEC,
    tailSec: number = PHRASE_PREVIEW_TAIL_SEC,
    prevPhraseEnd?: number,
): { startSec: number; endSec: number } {
    const start = Number.isFinite(lyricStart) && lyricStart > 0 ? lyricStart : 0;
    const dur = Number.isFinite(lyricDuration) && (lyricDuration as number) > 0
        ? (lyricDuration as number)
        : 4.0;
    const safeLead = Number.isFinite(leadSec) && leadSec > 0 ? leadSec : 0;
    const safeTail = Number.isFinite(tailSec) && tailSec > 0 ? tailSec : 0;

    // 前戻りが直前フレーズ末尾と重なる場合はその境界でクリップ
    let startSec = start - safeLead;
    if (Number.isFinite(prevPhraseEnd) && startSec < (prevPhraseEnd as number)) {
        startSec = prevPhraseEnd as number;
    }
    // 負の時刻は 0 へクランプ（安全側）
    startSec = Math.max(0, startSec);

    // 最小区間 0.5 秒を保証
    const endSec = Math.max(startSec + 0.5, start + dur + safeTail);
    return { startSec, endSec };
}

//==============================================================================
// 歌詞タイミング一括操作ユーティリティ
//==============================================================================

/**
 * 全歌詞の開始時刻を一括シフトする（AI 文字起こし後の全体的なズレ補正用）。
 * 0 秒未満へ落ちるフレーズは 0 にクランプし、その件数を返す。
 * 元配列は破壊しない。
 */
export function shiftAllLyricTimes(
    lyrics: LyricItem[],
    deltaSec: number,
): { shifted: LyricItem[]; clampedCount: number } {
    if (!Number.isFinite(deltaSec) || deltaSec === 0) {
        return { shifted: [...lyrics], clampedCount: 0 };
    }
    let clampedCount = 0;
    const shifted = lyrics.map((l) => {
        const t = Math.round((l.time + deltaSec) * 100) / 100;
        if (t <= 0) {
            clampedCount++;
            return { ...l, time: 0 };
        }
        return { ...l, time: t };
    });
    return { shifted, clampedCount };
}

/**
 * 前フレーズの表示区間が次フレーズの開始を食い込んでいる id 一覧を返す。
 * カラオケ塗りと口パク（viseme）の競合による表示崩れの警告検知に使う。
 */
export function getOverlappingLyricIds(lyrics: LyricItem[]): string[] {
    const sorted = sortLyrics(lyrics);
    const ids: string[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        const cur = sorted[i];
        const next = sorted[i + 1];
        if (!cur.id) continue;
        if (cur.time + (cur.duration ?? 4.0) > next.time + 1e-6) {
            ids.push(cur.id);
        }
    }
    return ids;
}

//==============================================================================
// フレーズ挿入・隣接結合ユーティリティ
// （AI 文字起こしの句読点・文節区切りミスを後から手直しするための編集支援）
//==============================================================================

/** 既定フレーズ持続（秒） */
export const LYRIC_DEFAULT_DURATION = 4.0;

/** 挿入される新フレーズの最低保証持続（秒） */
export const LYRIC_MIN_INSERTED_DURATION = 0.5;

/** 複製・挿入フレーズ用 ID 生成（秒衝突対策でランダム尾を付与） */
export function createLyricId(): string {
    return `ly_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * src フレーズの直後に新フレーズを挿入する際の時刻計算。
 *
 * 既存の「複製」と同じ規約に統一:
 * - 前フレーズ開始〜次フレーズ開始の隙間の中央へ配置
 * - 持続は既定値を上限に、次フレーズ開始で終了が揃うようクランプ（最低保証付き）
 * - 隙間が最低保証の 2 倍未満の極端狭小ケースでは最低保証値のみ確保
 *   （この場合わずかに前フレーズ表示区間と重なるため、既存の重なり警告 ⚠ の対象）
 * - 次フレーズが無い場合は前フレーズ終了直後へ既定持続で追加
 * 元配列は破壊しない。数値は全て小数第2位へ丸める。
 */
export function computeInsertionTiming(
    srcStartSec: number,
    srcDurationSec: number | undefined,
    nextStartSec: number | undefined,
): { time: number; duration: number } {
    const start = Number.isFinite(srcStartSec) && srcStartSec >= 0 ? srcStartSec : 0;
    const dur = Number.isFinite(srcDurationSec) && (srcDurationSec as number) > 0
        ? (srcDurationSec as number)
        : LYRIC_DEFAULT_DURATION;

    if (!Number.isFinite(nextStartSec as number)) {
        // 末尾への追加: 前フレーズ終了直後に既定持続
        return { time: Number((start + dur).toFixed(2)), duration: LYRIC_DEFAULT_DURATION };
    }

    const nextStart = nextStartSec as number;
    const gap = Math.max(0, nextStart - start);
    const t = Number((start + gap / 2).toFixed(2));
    let d = Math.max(LYRIC_MIN_INSERTED_DURATION, Math.min(dur, nextStart - t));
    if (gap < LYRIC_MIN_INSERTED_DURATION * 2) {
        d = LYRIC_MIN_INSERTED_DURATION;
    }
    return { time: t, duration: Number(d.toFixed(2)) };
}

/**
 * index 位のフレーズを次フレーズと結合する結果配列を返す（元配列は破壊しない）。
 *
 * - テキストは読み上げ順どおり「現フレーズ ＋ 次フレーズ」の順で連結する
 * - 結合後の持続は現フレーズ開始を維持したまま次フレーズ終了まで延長
 *   （次々フレーズと重なる場合は既存の重なり警告 ⚠ の対象になるので、そこで持続調整）
 * - id 不明・最終フレーズ・次フレーズ開始が現フレーズ以前（不正順序）の場合は null を返す
 */
export function mergeWithNextLyric(
    lyrics: LyricItem[],
    id: string,
): LyricItem[] | null {
    const sorted = sortLyrics(lyrics);
    const sortedIdx = sorted.findIndex((l) => l.id === id);
    if (sortedIdx === -1 || sortedIdx >= sorted.length - 1) return null;

    const cur = sorted[sortedIdx];
    const nxt = sorted[sortedIdx + 1];
    if (!cur.id || !nxt.id) return null;
    if (nxt.time <= cur.time) return null;

    const nxtDur = Number.isFinite(nxt.duration) && (nxt.duration as number) > 0
        ? (nxt.duration as number)
        : LYRIC_DEFAULT_DURATION;
    const mergedEnd = nxt.time + nxtDur;

    return lyrics
        .filter((l) => l.id !== nxt.id)
        .map((l) => {
            if (l.id !== cur.id) return l;
            return {
                ...l,
                text: `${cur.text}${nxt.text}`,
                duration: Math.max(
                    LYRIC_MIN_INSERTED_DURATION,
                    Number((mergedEnd - l.time).toFixed(2)),
                ),
            };
        });
}

/**
 * フレーズのテキストを指定文字位置（カーソル位置）で 2 つに分割する（AI 区切り修正用）。
 *
 * - splitIndex が 0 以下、または text.length 以上、あるいはテキストが空の場合は null を返す
 * - 前半テキスト head と後半テキスト tail に分割
 * - 持続時間（duration）は文字数比率（head.length : tail.length）で比例按分
 * - 後半フレーズの開始時刻は「元フレーズ開始時刻 + 前半持続時間」
 * - 元配列は破壊せず、対象フレーズを [headフレーズ, tailフレーズ] に置換した新しい配列を返す
 */
export function splitLyricAtPosition(
    lyrics: LyricItem[],
    id: string,
    splitIndex: number,
): LyricItem[] | null {
    const sorted = sortLyrics(lyrics);
    const targetIdx = sorted.findIndex((l) => l.id === id);
    if (targetIdx === -1) return null;
    const target = sorted[targetIdx];
    const text = target.text || '';
    if (splitIndex <= 0 || splitIndex >= text.length) return null;

    const headText = text.slice(0, splitIndex).trimEnd();
    const tailText = text.slice(splitIndex).trimStart();
    if (!headText && !tailText) return null;

    const totalDur = Number.isFinite(target.duration) && (target.duration as number) > 0
        ? (target.duration as number)
        : LYRIC_DEFAULT_DURATION;

    const headLen = Math.max(1, headText.length);
    const tailLen = Math.max(1, tailText.length);
    const ratio = headLen / (headLen + tailLen);

    let headDur = Number((totalDur * ratio).toFixed(2));
    let tailDur = Number((totalDur - headDur).toFixed(2));

    if (headDur < 0.2) headDur = 0.2;
    if (tailDur < 0.2) tailDur = 0.2;

    const headItem: LyricItem = {
        ...target,
        text: headText || text.slice(0, splitIndex),
        duration: headDur,
    };

    const tailItem: LyricItem = {
        ...target,
        id: createLyricId(),
        text: tailText || text.slice(splitIndex),
        time: Number((target.time + headDur).toFixed(2)),
        duration: tailDur,
    };

    const result = [...sorted];
    result.splice(targetIdx, 1, headItem, tailItem);
    return sortLyrics(result);
}

/**
 * 歌詞フレーズのタイムライン移動（グリッドスナップ対応）。
 * 歌詞の開始時刻を変更する（ドラッグ中の操作抜けを防ぐため元の順序を維持）。
 */
export function moveLyricTimeSnapped(
    lyrics: LyricItem[],
    lyricId: string,
    newStartSec: number,
    totalDuration: number,
    gridSec: number,
): LyricItem[] {
    const targetIdx = lyrics.findIndex((l) => l.id === lyricId || `ly_${l.time}_${l.text}` === lyricId);
    if (targetIdx === -1) return lyrics;

    const target = lyrics[targetIdx];
    const dur = target.duration ?? LYRIC_DEFAULT_DURATION;
    const clamped = Math.max(0, Math.min(newStartSec, Math.max(0, totalDuration - 0.2)));
    const snapped = gridSec > 0 ? snapToGrid(clamped, gridSec) : clamped;
    const finalStart = Math.max(0, Number(snapped.toFixed(2)));

    return lyrics.map((l, idx) => {
        if (idx !== targetIdx) return l;
        return {
            ...l,
            time: finalStart,
            duration: dur,
        };
    });
}

/**
 * 歌詞フレーズの右端リサイズ（終了位置トリム）。
 * 終了時刻を変更して duration を更新する。
 */
export function resizeLyricSnapped(
    lyrics: LyricItem[],
    lyricId: string,
    newEndSec: number,
    gridSec: number,
): LyricItem[] {
    const targetIdx = lyrics.findIndex((l) => l.id === lyricId || `ly_${l.time}_${l.text}` === lyricId);
    if (targetIdx === -1) return lyrics;

    const target = lyrics[targetIdx];
    const snappedEnd = gridSec > 0 ? snapToGrid(newEndSec, gridSec) : newEndSec;
    const newDur = Math.max(0.3, Number((snappedEnd - target.time).toFixed(2)));

    return lyrics.map((l, idx) => {
        if (idx !== targetIdx) return l;
        return {
            ...l,
            duration: newDur,
        };
    });
}

/**
 * 歌詞フレーズの左端リサイズ（開始位置トリム）。
 * 開始時刻を変更し、終了時刻を維持したまま duration を更新する。
 */
export function resizeLyricStartSnapped(
    lyrics: LyricItem[],
    lyricId: string,
    newStartSec: number,
    gridSec: number,
): LyricItem[] {
    const targetIdx = lyrics.findIndex((l) => l.id === lyricId || `ly_${l.time}_${l.text}` === lyricId);
    if (targetIdx === -1) return lyrics;

    const target = lyrics[targetIdx];
    const dur = target.duration ?? LYRIC_DEFAULT_DURATION;
    const origEnd = target.time + dur;

    const clampedStart = Math.max(0, Math.min(newStartSec, origEnd - 0.3));
    const snappedStart = gridSec > 0 ? snapToGrid(clampedStart, gridSec) : clampedStart;
    const finalStart = Math.max(0, Math.min(Number(snappedStart.toFixed(2)), origEnd - 0.3));
    const newDur = Math.max(0.3, Number((origEnd - finalStart).toFixed(2)));

    return lyrics.map((l, idx) => {
        if (idx !== targetIdx) return l;
        return {
            ...l,
            time: finalStart,
            duration: newDur,
        };
    });
}



