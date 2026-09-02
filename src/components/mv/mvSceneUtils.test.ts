//==============================================================================
// mvSceneUtils（シーン・歌詞操作ロジック）の単体テスト。
//==============================================================================
import { describe, it, expect } from 'vitest';
import { computeSceneTransition } from './AudioReactiveSandbox';
import {
    computePhrasePreviewWindow,
    createEmptyScene,
    clampSceneEndsToDuration,
    deleteScene,
    deleteScenes,
    duplicateScene,
    findActiveScene,
    getOverlappingLyricIds,
    gridSecondsFromBpm,
    moveSceneTimeSnapped,
    moveSceneTime,
    parseLrc,
    PHRASE_PREVIEW_LEAD_SEC,
    PHRASE_PREVIEW_TAIL_SEC,
    resizeSceneSnapped,
    resizeScene,
    splitSceneAtTime,
    shiftAllLyricTimes,
    snapToGrid,
    sortLyrics,
    sortScenes,
    toLrc,
    withResolvedDurations,
    computeInsertionTiming,
    createLyricId,
    LYRIC_DEFAULT_DURATION,
    LYRIC_MIN_INSERTED_DURATION,
    mergeWithNextLyric,
    moveLyricTimeSnapped,
    resizeLyricSnapped,
    splitLyricAtPosition,
} from './mvSceneUtils';
import type { LyricItem, MvScene } from './types';

const mkScene = (id: string, start: number, end: number): MvScene => ({
    id,
    name: id,
    startTime: start,
    endTime: end,
    svgCode: '<div/>',
});

describe('sortScenes', () => {
    it('開始時刻順にソートされる', () => {
        const sorted = sortScenes([mkScene('b', 10, 20), mkScene('a', 0, 10)]);
        expect(sorted.map((s) => s.id)).toEqual(['a', 'b']);
    });

    it('元配列を破壊しない', () => {
        const original = [mkScene('b', 10, 20), mkScene('a', 0, 10)];
        sortScenes(original);
        expect(original[0].id).toBe('b');
    });
});

describe('createEmptyScene / duplicateScene', () => {
    it('新規シーンは一意の ID を持つ', () => {
        const a = createEmptyScene(0, 8);
        const b = createEmptyScene(8, 16);
        expect(a.id).not.toBe(b.id);
        expect(b.startTime).toBe(8);
    });

    it('複製シーンは別 ID・コピー名を持つ', () => {
        const src = mkScene('s1', 0, 5);
        const copy = duplicateScene(src);
        expect(copy.id).not.toBe(src.id);
        expect(copy.name).toMatch(/コピー|copy/i);
        expect(copy.svgCode).toBe(src.svgCode);
    });
});

describe('moveSceneTime', () => {
    it('隣接シーンと重ならないようクランプされる', () => {
        const scenes = [mkScene('a', 0, 10), mkScene('b', 10, 20), mkScene('c', 20, 30)];
        // b を a の中へ移動 → a の終了位置へ押し込まれる
        const moved = moveSceneTime(scenes, 'b', 3, 60);
        expect(moved[1].startTime).toBeGreaterThanOrEqual(moved[0].endTime - 0.001);
    });

    it('存在しない ID の場合は元配列を返す', () => {
        const scenes = [mkScene('a', 0, 10)];
        expect(moveSceneTime(scenes, 'none', 5, 60)).toBe(scenes);
    });
});

describe('resizeScene', () => {
    it('次のシーン開始位置を超えない', () => {
        const scenes = [mkScene('a', 0, 5), mkScene('b', 10, 20)];
        const resized = resizeScene(scenes, 'a', 50);
        expect(resized[0].endTime).toBe(10);
    });

    it('最短 0.5 秒を保証する', () => {
        const scenes = [mkScene('a', 0, 5)];
        const resized = resizeScene(scenes, 'a', -10);
        expect(resized[0].endTime).toBe(0.5);
    });
});

describe('clampSceneEndsToDuration', () => {
    it('音声長を超えるシーン終端を音声の終端へ揃える', () => {
        const scenes = [mkScene('long', 0, 300), mkScene('short', 10, 20)];
        const clamped = clampSceneEndsToDuration(scenes, 146);
        expect(clamped[0].endTime).toBe(146);
        expect(clamped[1].endTime).toBe(20);
    });

    it('変更が不要な場合は元配列を返す', () => {
        const scenes = [mkScene('short', 0, 10)];
        expect(clampSceneEndsToDuration(scenes, 146)).toBe(scenes);
    });
});

describe('deleteScene & deleteScenes', () => {
    it('削除後、後続シーンが前倒しされて隙間が埋まる', () => {
        const scenes = [mkScene('a', 0, 4), mkScene('b', 4, 12), mkScene('c', 12, 16)];
        const removed = deleteScene(scenes, 'b');
        expect(removed.length).toBe(2);
        expect(removed[0].startTime).toBe(0);
        expect(removed[0].endTime).toBe(4);
        expect(removed[1].startTime).toBe(4); // c が 12 -> 4 へ
        expect(removed[1].endTime).toBe(8);
    });

    it('複数シーンを一括削除できる', () => {
        const scenes = [mkScene('a', 0, 4), mkScene('b', 4, 10), mkScene('c', 10, 16)];
        const removed = deleteScenes(scenes, new Set(['a', 'b']));
        expect(removed.length).toBe(1);
        expect(removed[0].id).toBe('c');
        expect(removed[0].startTime).toBe(0);
        expect(removed[0].endTime).toBe(6);
    });

    it('全シーン削除時は先頭1つを初期化して残す（最低1シーン保護）', () => {
        const scenes = [mkScene('a', 0, 4)];
        const removed = deleteScene(scenes, 'a');
        expect(removed.length).toBe(1);
        expect(removed[0].startTime).toBe(0);
    });
});

describe('splitSceneAtTime', () => {
    it('シーン区間内の時刻で2分割し、後半シーンにプロパティを適用する', () => {
        const scenes = [mkScene('a', 0, 10)];
        const res = splitSceneAtTime(scenes, 4.0, { backgroundImageId: 'bg_123' });
        expect(res.newSceneId).toBeTruthy();
        expect(res.scenes).toHaveLength(2);
        expect(res.scenes[0].startTime).toBe(0);
        expect(res.scenes[0].endTime).toBe(4.0);
        expect(res.scenes[1].startTime).toBe(4.0);
        expect(res.scenes[1].endTime).toBe(10);
        expect(res.scenes[1].backgroundImageId).toBe('bg_123');
    });

    it('シーン境界近傍（マージン0.2秒未満）では分割を行わない', () => {
        const scenes = [mkScene('a', 0, 10)];
        const res = splitSceneAtTime(scenes, 0.1);
        expect(res.newSceneId).toBeNull();
        expect(res.scenes).toHaveLength(1);
    });
});

describe('findActiveScene', () => {
    it('時間帯に一致するシーンを返す', () => {
        const scenes = [mkScene('a', 0, 10), mkScene('b', 10, 20)];
        expect(findActiveScene(scenes, 15)?.id).toBe('b');
        expect(findActiveScene(scenes, -1)).toBeNull();
    });
});

describe('LRC パース／書き出し', () => {
    it('標準 LRC をパースする', () => {
        const lrc = '[00:01.50]最初のフレーズ\n[00:05]次のフレーズ';
        const parsed = parseLrc(lrc);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].time).toBeCloseTo(1.5, 3);
        expect(parsed[0].text).toBe('最初のフレーズ');
        expect(parsed[1].time).toBe(5);
    });

    it('複数タイムスタンプ行に対応する', () => {
        const lrc = '[00:01][00:11]くり返し';
        const parsed = parseLrc(lrc);
        expect(parsed).toHaveLength(2);
    });

    it('書き出し→パースで往復一致する', () => {
        const lyrics: LyricItem[] = [
            { time: 61.23, text: 'あ' },
            { time: 0.5, text: 'い' },
        ];
        const roundTripped = parseLrc(toLrc(lyrics));
        expect(roundTripped[0].time).toBeCloseTo(0.5, 2);
        expect(roundTripped[1].time).toBeCloseTo(61.23, 1);
    });
});

describe('グリッドスナップ', () => {
    it('snapToGrid が最寄りグリッドへ丸める', () => {
        expect(snapToGrid(2.3, 1)).toBe(2);
        expect(snapToGrid(2.6, 1)).toBe(3);
        expect(snapToGrid(0.9, 0.5)).toBe(1);
        expect(snapToGrid(0.24, 0.5)).toBe(0);
    });

    it('snapToGrid はグリッド無効時は元値を返す', () => {
        expect(snapToGrid(2.345, 0)).toBe(2.345);
        expect(snapToGrid(2.345, -1)).toBe(2.345);
    });

    it('gridSecondsFromBpm が BPM から正しい間隔を算出する', () => {
        // 120 BPM の 1 拍 = 0.5 秒
        expect(gridSecondsFromBpm(120, 1)).toBeCloseTo(0.5, 5);
        // 120 BPM の 4 拍（1 小節）= 2 秒
        expect(gridSecondsFromBpm(120, 4)).toBeCloseTo(2, 5);
        // 無効 BPM は 120 扱い
        expect(gridSecondsFromBpm(0, 1)).toBeCloseTo(0.5, 5);
    });

    it('moveSceneTimeSnapped が移動開始位置をスナップする', () => {
        const scenes = [mkScene('a', 0, 10), mkScene('b', 10, 20)];
        const moved = moveSceneTimeSnapped(scenes, 'b', 12.7, 60, 2);
        expect(moved[1].startTime).toBeCloseTo(12, 3);
    });

    it('resizeSceneSnapped が終端をスナップする', () => {
        const scenes = [mkScene('a', 0, 5)];
        const resized = resizeSceneSnapped(scenes, 'a', 7.8, 2);
        expect(resized[0].endTime).toBeCloseTo(8, 3);
    });
});

describe('computeSceneTransition（シーン遷移）', () => {
    const mkT = (id: string, start: number, end: number, transition?: string): MvScene => ({
        ...mkScene(id, start, end),
        transition: transition as never,
    });

    it('遷移なしシーンは progress 1 で前シーンを返さない', () => {
        const scenes = [mkT('a', 0, 10), mkT('b', 10, 20)];
        const t = computeSceneTransition(scenes, 12);
        expect(t.current?.id).toBe('b');
        expect(t.previous).toBeNull();
        expect(t.progress).toBe(1);
    });

    it('遷移区間では前シーンと進行度を返す', () => {
        const scenes = [mkT('a', 0, 10), mkT('b', 10, 20, 'fade')];
        const t = computeSceneTransition(scenes, 10.3); // 0.6秒遷移の半ば
        expect(t.current?.id).toBe('b');
        expect(t.previous?.id).toBe('a');
        expect(t.progress).toBeGreaterThan(0);
        expect(t.progress).toBeLessThan(1);
    });

    it('遷移完了後は前シーンを解放する', () => {
        const scenes = [mkT('a', 0, 10), mkT('b', 10, 20, 'fade')];
        const t = computeSceneTransition(scenes, 11.0); // 遷移(0.6s)完了後
        expect(t.previous).toBeNull();
        expect(t.progress).toBe(1);
    });

    it('先頭シーンは遷移対象の前シーンを持たない', () => {
        const scenes = [mkT('a', 0, 10, 'zoom')];
        const t = computeSceneTransition(scenes, 0.2);
        expect(t.current?.id).toBe('a');
        expect(t.previous).toBeNull();
    });

    it('シーン間ギャップでは黒画面（current null）を返す', () => {
        // a が 0-4 秒、b が 6-10 秒 → 5 秒地点はどちらにも属さない
        const scenes = [mkT('a', 0, 4), mkT('b', 6, 10)];
        const t = computeSceneTransition(scenes, 5);
        expect(t.current).toBeNull();
        expect(t.previous).toBeNull();
    });
});

describe('歌詞ユーティリティ', () => {
    it('withResolvedDurations が duration 未指定を補完する', () => {
        const resolved = withResolvedDurations([{ time: 0, text: 'a' }, { time: 3, text: 'b' }]);
        expect(resolved[0].resolvedDuration).toBe(3);
        expect(resolved[1].resolvedDuration).toBe(4.0);
    });

    it('sortLyrics が時刻順に並べ替える', () => {
        const sorted = sortLyrics([
            { time: 9, text: 'c' },
            { time: 1, text: 'a' },
            { time: 4, text: 'b' },
        ]);
        expect(sorted.map((l) => l.text)).toEqual(['a', 'b', 'c']);
    });
});

describe('computePhrasePreviewWindow（フレーズプレビュー区間）', () => {
    it('プレビュー既定値は前戻り 2 秒・テール 1 秒', () => {
        expect(PHRASE_PREVIEW_LEAD_SEC).toBe(2);
        expect(PHRASE_PREVIEW_TAIL_SEC).toBe(1);
    });

    it('既定で開始 2 秒前から終了 + 1 秒後の区間を返す', () => {
        const w = computePhrasePreviewWindow(10, 2);
        expect(w.startSec).toBeCloseTo(8, 5);
        expect(w.endSec).toBeCloseTo(13, 5);
    });

    it('前戻りが直前フレーズ末尾と重なる場合はその境界でクリップする', () => {
        // 10 - 2 = 8 だが前フレーズが 9.5 まで鳴っている → 9.5 から
        const w = computePhrasePreviewWindow(10, 2, undefined, undefined, 9.5);
        expect(w.startSec).toBeCloseTo(9.5, 5);
        expect(w.endSec).toBeCloseTo(13, 5);
    });

    it('先頭付近のフレーズは 0 秒にクランプする', () => {
        const w = computePhrasePreviewWindow(1, 1);
        expect(w.startSec).toBe(0);
        expect(w.endSec).toBeCloseTo(3, 5);
    });

    it('duration 未指定は 4 秒扱いになる', () => {
        const w = computePhrasePreviewWindow(10, undefined);
        expect(w.startSec).toBeCloseTo(8, 5);
        expect(w.endSec).toBeCloseTo(15, 5);
    });

    it('無効な lead / tail は前戻り・テールなしとして動作する', () => {
        const w = computePhrasePreviewWindow(10, 2, 0, -1);
        expect(w.startSec).toBeCloseTo(10, 5);
        expect(w.endSec).toBeCloseTo(12, 5);
    });

    it('極端に短い区間でも最小区間 0.5 秒を保証する', () => {
        const w = computePhrasePreviewWindow(10, 0.01, 0, 0);
        expect(w.endSec - w.startSec).toBeGreaterThanOrEqual(0.5);
    });

    it('無効な開始時刻は 0 扱いになる', () => {
        const w = computePhrasePreviewWindow(Number.NaN, 2);
        expect(w.startSec).toBe(0);
        expect(w.endSec).toBeCloseTo(3, 5);
    });
});

describe('shiftAllLyricTimes / getOverlappingLyricIds', () => {
    it('shiftAllLyricTimes が全フレーズを一括シフトする', () => {
        const src: LyricItem[] = [
            { id: 'a', time: 2, text: 'x', duration: 1 },
            { id: 'b', time: 5, text: 'y', duration: 1 },
        ];
        const { shifted, clampedCount } = shiftAllLyricTimes(src, -0.3);
        expect(shifted[0].time).toBeCloseTo(1.7, 5);
        expect(shifted[1].time).toBeCloseTo(4.7, 5);
        expect(clampedCount).toBe(0);
        expect(src[0].time).toBe(2); // 元配列を破壊しない
    });

    it('0 秒未満へ落ちるフレーズは 0 にクランプされ件数が返る', () => {
        const src: LyricItem[] = [
            { id: 'a', time: 0.2, text: 'x', duration: 1 },
            { id: 'b', time: 3, text: 'y', duration: 1 },
        ];
        const { shifted, clampedCount } = shiftAllLyricTimes(src, -0.5);
        expect(shifted[0].time).toBe(0);
        expect(shifted[1].time).toBeCloseTo(2.5, 5);
        expect(clampedCount).toBe(1);
    });

    it('getOverlappingLyricIds が次フレーズ開始を食い込む id を返す', () => {
        const src: LyricItem[] = [
            { id: 'a', time: 0, duration: 2, text: 'x' },
            { id: 'b', time: 1.5, duration: 1, text: 'y' },
            { id: 'c', time: 5, duration: 1, text: 'z' },
        ];
        expect(getOverlappingLyricIds(src)).toEqual(['a']);
    });

    it('getOverlappingLyricIds は重なりが無ければ空配列を返す', () => {
        const src: LyricItem[] = [
            { id: 'a', time: 0, duration: 1, text: 'x' },
            { id: 'b', time: 1, duration: 1, text: 'y' },
        ];
        expect(getOverlappingLyricIds(src)).toEqual([]);
    });
});

describe('computeInsertionTiming（フレーズ挿入時刻）', () => {
    it('十分な空きがある場合: 前後の隙間の中央に既定持続で配置', () => {
        // src: 10.0 → 次フレーズ 20.0（空き 10s）→ 中央 15.0、持続は既定 4s
        const t = computeInsertionTiming(10.0, 4.0, 20.0);
        expect(t.time).toBe(15.0);
        expect(t.duration).toBe(LYRIC_DEFAULT_DURATION);
    });

    it('次フレーズが近い場合: 収まるよう持続を圧縮し終了を揃える', () => {
        // src: 10.0 → 次 12.8（空き 2.8s）→ 中央 11.4、次開始までの 1.4s に圧縮
        const t = computeInsertionTiming(10.0, 4.0, 12.8);
        expect(t.time).toBeCloseTo(11.4, 5);
        expect(t.duration).toBeCloseTo(1.4, 5);
        expect(t.time + t.duration).toBeLessThanOrEqual(12.8 + 1e-9);
    });

    it('空きが最低保証未満の場合: 中間時刻へ置かれる', () => {
        const t = computeInsertionTiming(10.0, 4.0, 10.2);
        expect(t.time).toBeCloseTo(10.1, 5);
        expect(t.duration).toBe(LYRIC_MIN_INSERTED_DURATION);
    });

    it('次フレーズが無い場合は末尾追加: 終了直後＋既定持続', () => {
        const t = computeInsertionTiming(30.0, 4.0, undefined);
        expect(t.time).toBe(34.0);
        expect(t.duration).toBe(LYRIC_DEFAULT_DURATION);
    });

    it('不正な開始時刻・持続は安全値へフォールバックする', () => {
        const t = computeInsertionTiming(Number.NaN, -1, undefined);
        expect(t.time).toBeGreaterThanOrEqual(0);
        expect(t.duration).toBeGreaterThan(0);
    });
});

describe('mergeWithNextLyric（隣接フレーズ結合）', () => {
    it('テキスト連結と持続延長を行い、配列長が 1 減る', () => {
        const src: LyricItem[] = [
            { id: 'a', time: 0, duration: 2, text: '流れる季節の真ん中で' },
            { id: 'b', time: 2, duration: 2, text: 'ふと' },
            { id: 'c', time: 4, duration: 4, text: 'あの日を思い出す' },
        ];
        const merged = mergeWithNextLyric(src, 'a');
        expect(merged).not.toBeNull();
        expect(merged?.length).toBe(2);
        const a = merged?.find((l) => l.id === 'a');
        expect(a?.text).toBe('流れる季節の真ん中でふと');
        expect(a?.time).toBe(0);
        expect(a?.duration).toBeCloseTo(4, 5); // b 終了 (2+2) まで延長
        expect(merged?.find((l) => l.id === 'b')).toBeUndefined();
        expect(merged?.find((l) => l.id === 'c')?.text).toBe('あの日を思い出す');
    });

    it('最終行は null を返し、元配列は不変', () => {
        const src: LyricItem[] = [
            { id: 'a', time: 0, duration: 2, text: 'x' },
            { id: 'b', time: 2, duration: 2, text: 'y' },
        ];
        const before = JSON.stringify(src);
        expect(mergeWithNextLyric(src, 'b')).toBeNull();
        expect(JSON.stringify(src)).toBe(before);
    });

    it('id 不明・id 無し要素を含む場合も安全に null を返す', () => {
        const src: LyricItem[] = [
            { time: 0, duration: 2, text: 'x' } as LyricItem,
            { id: 'b', time: 2, duration: 2, text: 'y' },
        ];
        // 存在しない id
        expect(mergeWithNextLyric(src, 'missing')).toBeNull();
        // 先頭が id 無しでも配列自体は処理され、最終行 'b' は結合対象が無いので null
        expect(mergeWithNextLyric(src, 'b')).toBeNull();
    });

    it('時間順に並んでいない入力でもソート順で判定する', () => {
        const src: LyricItem[] = [
            { id: 'b', time: 5, duration: 2, text: 'y' },
            { id: 'a', time: 0, duration: 2, text: 'x' },
        ];
        const merged = mergeWithNextLyric(src, 'a');
        expect(merged?.find((l) => l.id === 'a')?.text).toBe('xy');
        expect(merged?.length).toBe(1);
    });

    it('createLyricId は接頭辞付きで毎回異なる値を返す', () => {
        const a = createLyricId();
        const b = createLyricId();
        expect(a).toMatch(/^ly_/);
        expect(a).not.toBe(b);
    });

    it('moveLyricTimeSnapped で歌詞の開始時刻がスナップ移動する', () => {
        const src: LyricItem[] = [
            { id: 'ly1', time: 1.0, duration: 2.0, text: 'Hello' },
            { id: 'ly2', time: 4.0, duration: 2.0, text: 'World' },
        ];
        // 1小節スナップ (gridSec = 2.0)
        const moved = moveLyricTimeSnapped(src, 'ly1', 2.1, 10.0, 2.0);
        expect(moved.find((l) => l.id === 'ly1')?.time).toBe(2.0);
        expect(moved.find((l) => l.id === 'ly1')?.duration).toBe(2.0);
    });

    it('resizeLyricSnapped で歌詞の持続時間がスナップ更新される', () => {
        const src: LyricItem[] = [
            { id: 'ly1', time: 1.0, duration: 2.0, text: 'Hello' },
        ];
        // 終了時刻 4.9s ➔ グリッド 1.0s スナップで 5.0s ➔ duration は 5.0 - 1.0 = 4.0s
        const resized = resizeLyricSnapped(src, 'ly1', 4.9, 1.0);
        expect(resized.find((l) => l.id === 'ly1')?.duration).toBe(4.0);
    });

    it('splitLyricAtPosition でカーソル位置の文字数比率で時間按分して2分割できる', () => {
        const src: LyricItem[] = [
            { id: 'ly1', time: 10.0, duration: 4.0, text: '駆けたあれは' },
            { id: 'ly2', time: 15.0, duration: 2.0, text: 'ソーラレイ' },
        ];
        // 「駆けた」(3文字) と「あれは」(3文字) で分割 ➔ 3:3 = 50%:50% (各2.0秒)
        const splitted = splitLyricAtPosition(src, 'ly1', 3);
        expect(splitted).not.toBeNull();
        expect(splitted?.length).toBe(3);

        const head = splitted![0];
        const tail = splitted![1];
        const next = splitted![2];

        expect(head.text).toBe('駆けた');
        expect(head.time).toBe(10.0);
        expect(head.duration).toBe(2.0);

        expect(tail.text).toBe('あれは');
        expect(tail.time).toBe(12.0); // 10.0 + 2.0
        expect(tail.duration).toBe(2.0);

        // 分割した後半「あれは」と次フレーズ「ソーラレイ」を結合できる
        const merged = mergeWithNextLyric(splitted!, tail.id!);
        expect(merged).not.toBeNull();
        expect(merged?.length).toBe(2);
        expect(merged![0].text).toBe('駆けた');
        expect(merged![1].text).toBe('あれはソーラレイ');
    });

    it('splitLyricAtPosition は不正な分割位置で安全に null を返す', () => {
        const src: LyricItem[] = [
            { id: 'ly1', time: 10.0, duration: 4.0, text: 'Hello' },
        ];
        expect(splitLyricAtPosition(src, 'ly1', 0)).toBeNull();
        expect(splitLyricAtPosition(src, 'ly1', 5)).toBeNull();
        expect(splitLyricAtPosition(src, 'ly1', 10)).toBeNull();
        expect(splitLyricAtPosition(src, 'missing', 2)).toBeNull();
    });
});
