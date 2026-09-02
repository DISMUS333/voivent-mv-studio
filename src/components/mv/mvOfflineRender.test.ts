//==============================================================================
// mvOfflineRender の単体テスト。
// オフライン描画用シグナル再構築ロジックの決定性と境界挙動を検証する。
// リップシンク用 viseme の擬似推定ロジックも合わせて検証する。
//==============================================================================
import { describe, expect, it } from 'vitest';
import {
    amplitudeAtTime,
    beatPulseAtTime,
    buildOfflineSignals,
    offlineVisemeAtTime,
    offlineVisemeAtTimeWithLyrics,
} from './mvOfflineRender';
import {
    charToViseme,
    lyricsVisemeAtTime,
    mergeVisemeWithLyrics,
} from './lyricsToViseme';
import type { LyricItem } from './types';

describe('amplitudeAtTime', () => {
    const peaks: Array<[number, number]> = [
        [0, 0.2],   // idx 0
        [-0.4, 0],  // idx 1
        [0, 0.8],   // idx 2
        [-0.1, 0.1] // idx 3
    ];

    it('時刻に対応するピークの絶対値最大を返す', () => {
        // duration=4s、peaks 4個 → 1秒ごとに1インデックス
        expect(amplitudeAtTime(peaks, 4, 0.5)).toBeCloseTo(0.2);
        expect(amplitudeAtTime(peaks, 4, 1.5)).toBeCloseTo(0.4);
        expect(amplitudeAtTime(peaks, 4, 2.5)).toBeCloseTo(0.8);
    });

    it('範囲外の時刻はクランプされる', () => {
        expect(amplitudeAtTime(peaks, 4, -5)).toBeCloseTo(0.2);
        expect(amplitudeAtTime(peaks, 4, 99)).toBeCloseTo(0.1);
    });

    it('ピーク未取得・不正入力時は 0 を返す', () => {
        expect(amplitudeAtTime(undefined, 4, 1)).toBe(0);
        expect(amplitudeAtTime([], 4, 1)).toBe(0);
        expect(amplitudeAtTime(peaks, 0, 1)).toBe(0);
        expect(amplitudeAtTime(peaks, NaN, 1)).toBe(0);
        expect(amplitudeAtTime(peaks, 4, Infinity)).toBe(0);
    });
});

describe('beatPulseAtTime', () => {
    it('拍の瞬間（位相 0）で最大値 1.0 になる', () => {
        // BPM 120 → 拍周期 0.5 秒
        expect(beatPulseAtTime(120, 0)).toBeCloseTo(1.0);
        expect(beatPulseAtTime(120, 0.5)).toBeCloseTo(1.0);
        expect(beatPulseAtTime(120, 1.0)).toBeCloseTo(1.0);
    });

    it('拍間で指数関数的に減衰する', () => {
        const mid = beatPulseAtTime(120, 0.25); // 位相 0.5
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(1);
        // 減衰曲線: exp(-0.5 * decay)
        expect(mid).toBeCloseTo(Math.exp(-3));
    });

    it('BPM・時刻が不正な場合は 0 を返す', () => {
        expect(beatPulseAtTime(0, 1)).toBe(0);
        expect(beatPulseAtTime(-10, 1)).toBe(0);
        expect(beatPulseAtTime(NaN, 1)).toBe(0);
        expect(beatPulseAtTime(120, -1)).toBe(0);
        expect(beatPulseAtTime(120, NaN)).toBe(0);
    });
});

describe('buildOfflineSignals', () => {
    it('解析データから決定的なシグナルを構築する', () => {
        const analysis = {
            peaks: [[0, 0.6]] as Array<[number, number]>,
            duration: 2,
        };
        const s = buildOfflineSignals(90, analysis, 0.5);
        expect(s.peak).toBeCloseTo(0.6);
        expect(s.low).toBeGreaterThan(s.mid);
        expect(s.mid).toBeGreaterThan(s.high);
        expect(s.isPlaying).toBe(true);
        expect(s.timeSeconds).toBe(0.5);
        expect(s.bpm).toBe(90);
    });

    it('同一入力に対して同一出力を返す（決定性）', () => {
        const analysis = {
            peaks: [[0, 0.5], [-0.3, 0], [0, 0.9]] as Array<[number, number]>,
            duration: 3,
        };
        const a = buildOfflineSignals(120, analysis, 1.234);
        const b = buildOfflineSignals(120, analysis, 1.234);
        expect(a).toEqual(b);
    });

    it('解析データなしでもビートパルスのみで動作する', () => {
        const s = buildOfflineSignals(60, null, 0);
        expect(s.peak).toBe(0);
        expect(s.beat).toBeCloseTo(1.0);
        expect(s.timeSeconds).toBe(0);
    });
});

describe('offlineVisemeAtTime', () => {
    it('振幅が無音閾値未満なら "sil" + 強度 0', () => {
        expect(offlineVisemeAtTime(0, 0)).toEqual({ viseme: 'sil', visemeStrength: 0 });
        expect(offlineVisemeAtTime(1.0, 0.03)).toEqual({ viseme: 'sil', visemeStrength: 0 });
        expect(offlineVisemeAtTime(1.0, -0.1)).toEqual({ viseme: 'sil', visemeStrength: 0 });
    });

    it('時刻 t に応じて a/i/u/e/o を巡回する（0.32秒周期）', () => {
        const seq = ['a', 'i', 'u', 'e', 'o'] as const;
        // 各区間の中央時刻で期待母音になる
        expect(offlineVisemeAtTime(0.16, 0.5).viseme).toBe(seq[0]);
        expect(offlineVisemeAtTime(0.48, 0.5).viseme).toBe(seq[1]);
        expect(offlineVisemeAtTime(0.80, 0.5).viseme).toBe(seq[2]);
        expect(offlineVisemeAtTime(1.12, 0.5).viseme).toBe(seq[3]);
        expect(offlineVisemeAtTime(1.44, 0.5).viseme).toBe(seq[4]);
        // 5 周期後は a に戻る
        expect(offlineVisemeAtTime(0.16 + 0.32 * 5, 0.5).viseme).toBe(seq[0]);
    });

    it('不正な入力（NaN）は "sil" を返す', () => {
        expect(offlineVisemeAtTime(NaN, 0.5).viseme).toBe('sil');
        expect(offlineVisemeAtTime(1.0, NaN).viseme).toBe('sil');
    });

    it('strength は 0.25〜1.0 の範囲にクランプされる', () => {
        const low = offlineVisemeAtTime(0.16, 0.05);
        expect(low.visemeStrength).toBeGreaterThanOrEqual(0.25);
        const high = offlineVisemeAtTime(0.16, 2.0);
        expect(high.visemeStrength).toBeLessThanOrEqual(1.0);
    });
});

describe('buildOfflineSignals + リップシンク viseme', () => {
    const activeAnalysis = {
        peaks: [[0, 0.5]] as Array<[number, number]>,
        duration: 2,
    };

    it('有声区間では viseme が設定され、GIF 出力で口パクが再現できる', () => {
        const s = buildOfflineSignals(120, activeAnalysis, 0.16);
        expect(s.viseme).not.toBe('sil');
        expect(s.visemeStrength).toBeGreaterThan(0);
    });

    it('無音区間では viseme="sil" + 強度 0', () => {
        const s = buildOfflineSignals(120, null, 0);
        expect(s.viseme).toBe('sil');
        expect(s.visemeStrength).toBe(0);
    });

    it('GIF の決定性: 同じ (bpm, analysis, t) は同じ viseme を返す', () => {
        const a = buildOfflineSignals(120, activeAnalysis, 0.5);
        const b = buildOfflineSignals(120, activeAnalysis, 0.5);
        expect(a.viseme).toBe(b.viseme);
        expect(a.visemeStrength).toBe(b.visemeStrength);
    });
});

describe('charToViseme (50音 → viseme)', () => {
    it('あ段/か行/さ行/た行/な行/は行/ま行/や行/ら行/わ行 → 5母音', () => {
        // あ段
        expect(charToViseme('あ').viseme).toBe('a');
        expect(charToViseme('い').viseme).toBe('i');
        expect(charToViseme('う').viseme).toBe('u');
        expect(charToViseme('え').viseme).toBe('e');
        expect(charToViseme('お').viseme).toBe('o');
        // か行
        expect(charToViseme('か').viseme).toBe('a');
        expect(charToViseme('き').viseme).toBe('i');
        expect(charToViseme('く').viseme).toBe('u');
        expect(charToViseme('け').viseme).toBe('e');
        expect(charToViseme('こ').viseme).toBe('o');
        // さ行
        expect(charToViseme('さ').viseme).toBe('a');
        expect(charToViseme('し').viseme).toBe('i');
        expect(charToViseme('す').viseme).toBe('u');
        expect(charToViseme('せ').viseme).toBe('e');
        expect(charToViseme('そ').viseme).toBe('o');
    });

    it('カタカナも同等に扱われる（カタカナ→ひらがな範囲シフト）', () => {
        expect(charToViseme('ア').viseme).toBe('a');
        expect(charToViseme('イ').viseme).toBe('i');
        expect(charToViseme('ウ').viseme).toBe('u');
        expect(charToViseme('エ').viseme).toBe('e');
        expect(charToViseme('オ').viseme).toBe('o');
    });

    it('ん / っ / ー / 空白 → "sil" + 弱〜ゼロ開口', () => {
        expect(charToViseme('ん').viseme).toBe('sil');
        expect(charToViseme('っ').viseme).toBe('sil');
        expect(charToViseme('ー').viseme).toBe('sil');
        expect(charToViseme(' ').viseme).toBe('sil');
    });

    it('小書き母音も同じ母音として扱う', () => {
        expect(charToViseme('ぁ').viseme).toBe('a');
        expect(charToViseme('ぃ').viseme).toBe('i');
        expect(charToViseme('ぅ').viseme).toBe('u');
        expect(charToViseme('ぇ').viseme).toBe('e');
        expect(charToViseme('ぉ').viseme).toBe('o');
    });

    it('英字・記号は "sil" + 弱開口 (ニュートラル)', () => {
        expect(charToViseme('A').viseme).toBe('sil');
        expect(charToViseme('1').viseme).toBe('sil');
        expect(charToViseme('!').viseme).toBe('sil');
        // 強度は 0 より大きい
        expect(charToViseme('A').strength).toBeGreaterThan(0);
    });

    it('strength は a/o で大きく、i/u で小さい傾向', () => {
        const a = charToViseme('あ').strength;
        const o = charToViseme('お').strength;
        const i = charToViseme('い').strength;
        const u = charToViseme('う').strength;
        expect(a).toBeGreaterThan(i);
        expect(o).toBeGreaterThan(u);
    });
});

describe('lyricsVisemeAtTime', () => {
    const lyrics: LyricItem[] = [
        { time: 0, duration: 2, text: 'あい' },        // 0..2s, 1文字1秒
        { time: 2, duration: 3, text: 'うえおか' },   // 2..5s, 1文字0.6秒
    ];

    it('フレーズ内の文字を均等時間スライスする', () => {
        // 0.0..0.5s → "あ"（a）
        expect(lyricsVisemeAtTime(lyrics, 0.0)?.viseme).toBe('a');
        expect(lyricsVisemeAtTime(lyrics, 0.4)?.viseme).toBe('a');
        // 1.0..1.5s → "い"（i）
        expect(lyricsVisemeAtTime(lyrics, 1.0)?.viseme).toBe('i');
        expect(lyricsVisemeAtTime(lyrics, 1.5)?.viseme).toBe('i');
        // 2.0..2.6s → "う"（u）
        expect(lyricsVisemeAtTime(lyrics, 2.3)?.viseme).toBe('u');
        // 2.6..3.2s → "え"（e）
        expect(lyricsVisemeAtTime(lyrics, 3.0)?.viseme).toBe('e');
        // 3.2..3.8s → "お"（o）
        expect(lyricsVisemeAtTime(lyrics, 3.5)?.viseme).toBe('o');
        // 3.8..5.0s → "か"（a）
        expect(lyricsVisemeAtTime(lyrics, 4.5)?.viseme).toBe('a');
    });

    it('歌詞外（時刻 5s 以降）は null を返し C++ 側へフォールバック可能', () => {
        expect(lyricsVisemeAtTime(lyrics, 5.0)).toBeNull();
        expect(lyricsVisemeAtTime(lyrics, 999)).toBeNull();
    });

    it('歌詞フレーズ開始前は null', () => {
        expect(lyricsVisemeAtTime(lyrics, -1)).toBeNull();
    });

    it('歌詞未指定・空配列は null', () => {
        expect(lyricsVisemeAtTime(undefined, 1)).toBeNull();
        expect(lyricsVisemeAtTime([], 1)).toBeNull();
    });

    it('text が空 or duration 0 のフレーズはスキップ', () => {
        const bad: LyricItem[] = [
            { time: 0, duration: 0, text: 'あ' },
            { time: 0, text: '   ' },
        ];
        expect(lyricsVisemeAtTime(bad, 0.5)).toBeNull();
    });

    it('返すスナップショットに現在文字とそのインデックスを含む', () => {
        const snap = lyricsVisemeAtTime(lyrics, 2.3);
        expect(snap).not.toBeNull();
        expect(snap!.char).toBe('う');
        expect(snap!.charIndex).toBe(0);
        expect(snap!.charStrength).toBeGreaterThan(0);
    });
});

describe('mergeVisemeWithLyrics', () => {
    const lyrics: LyricItem[] = [{ time: 0, duration: 2, text: 'あい' }];

    it('歌詞マッチあり → 歌詞 viseme を採用（C++ より優先）', () => {
        const result = mergeVisemeWithLyrics('o', 0.9, lyrics, 1.0);
        expect(result.viseme).toBe('i'); // 歌詞 "い" が勝つ
        expect(result.visemeStrength).toBeGreaterThan(0);
    });

    it('歌詞マッチなし (歌詞ありの区間外) → 完全 sil', () => {
        // 歌詞があるが t=5.0 は区間外 (duration=2) → C++ ではなく sil
        const result = mergeVisemeWithLyrics('a', 0.7, lyrics, 5.0);
        expect(result.viseme).toBe('sil');
        expect(result.visemeStrength).toBe(0);
    });

    it('歌詞なし・C++ "sil" → "sil" + 0', () => {
        const result = mergeVisemeWithLyrics('sil', 0, undefined, 1.0);
        expect(result.viseme).toBe('sil');
        expect(result.visemeStrength).toBe(0);
    });
});

describe('offlineVisemeAtTimeWithLyrics', () => {
    const lyrics: LyricItem[] = [{ time: 0, duration: 2, text: 'あ' }];

    it('歌詞区間内 → 歌詞 viseme を優先', () => {
        const result = offlineVisemeAtTimeWithLyrics(1.0, 0.5, lyrics);
        expect(result.viseme).toBe('a');
        expect(result.visemeStrength).toBeGreaterThan(0);
    });

    it('歌詞外 → 完全 sil（口を動かすな）', () => {
        // 歌詞があるのに区間外の場合は、振幅に関係なく sil を返す
        const result = offlineVisemeAtTimeWithLyrics(5.0, 0.5, lyrics);
        expect(result.viseme).toBe('sil');
        expect(result.visemeStrength).toBe(0);
    });

    it('歌詞が完全に無い → 振幅ベース擬似 viseme へフォールバック', () => {
        const result = offlineVisemeAtTimeWithLyrics(1.0, 0.5, undefined);
        expect(result.viseme).not.toBe('sil');
        expect(result.visemeStrength).toBeGreaterThan(0);
    });

    it('buildOfflineSignals に歌詞を渡すとリップシンクが 50音駆動になり、歌詞外は sil', () => {
        const analysis = {
            peaks: [[0, 0.5]] as Array<[number, number]>,
            duration: 4,
        };
        // 歌詞なし → 振幅ベースで動く
        const noLyric = buildOfflineSignals(120, analysis, 3.0);
        expect(noLyric.viseme).not.toBe('sil');
        // 歌詞区間内（t=0.5s、"あ" → a）→ 歌詞 viseme
        const withLyric = buildOfflineSignals(120, analysis, 0.5, lyrics);
        expect(withLyric.viseme).toBe('a');
        // 歌詞区間外で歌詞付き → 完全 sil（口を動かすな）
        const outOfRange = buildOfflineSignals(120, analysis, 3.0, lyrics);
        expect(outOfRange.viseme).toBe('sil');
        expect(outOfRange.visemeStrength).toBe(0);
    });

    it('「ー」は前の母音を保持する（自然な口パク）', () => {
        const longLyric: LyricItem[] = [{ time: 0, duration: 3, text: 'ハロー' }];
        // t=1.5s、均等スライスで「ロ」末尾〜「ー」先頭 (perChar=0.75)
        // text="ハロー" の 3 文字目 = "ー" → 前の "ロ" (o) を保持
        const r = offlineVisemeAtTimeWithLyrics(1.6, 0.5, longLyric);
        expect(r.viseme).toBe('o');
    });

    it('句読点・中黒は完全 sil', () => {
        const punctLyric: LyricItem[] = [{ time: 0, duration: 3, text: 'あ・い' }];
        // perChar=1.0、t=1.5 で "・" (charIdx=1) → sil
        const r = offlineVisemeAtTimeWithLyrics(1.5, 0.5, punctLyric);
        expect(r.viseme).toBe('sil');
        expect(r.visemeStrength).toBe(0);
    });

    it('歌詞変更が即座に viseme に反映される', () => {
        // 同じ時刻 t=0.5 で、歌詞の text だけ変更したら viseme が変わる
        const ly1: LyricItem[] = [{ id: '1', time: 0, duration: 1, text: 'あ' }];
        const ly2: LyricItem[] = [{ id: '1', time: 0, duration: 1, text: 'い' }];
        const r1 = offlineVisemeAtTimeWithLyrics(0.5, 0.5, ly1);
        const r2 = offlineVisemeAtTimeWithLyrics(0.5, 0.5, ly2);
        expect(r1.viseme).toBe('a');
        expect(r2.viseme).toBe('i');
    });

    it('歌詞の time / duration 変更で区間外→区間内に変わると viseme が sil→母音に変わる', () => {
        const ly1: LyricItem[] = [{ id: '1', time: 5, duration: 1, text: 'あ' }];
        const ly2: LyricItem[] = [{ id: '1', time: 1, duration: 5, text: 'あ' }];
        // t=2.0: ly1 は区間外 (5..6)、ly2 は区間内 (1..6)
        const r1 = offlineVisemeAtTimeWithLyrics(2.0, 0.5, ly1);
        const r2 = offlineVisemeAtTimeWithLyrics(2.0, 0.5, ly2);
        expect(r1.viseme).toBe('sil');
        expect(r2.viseme).toBe('a');
    });
});