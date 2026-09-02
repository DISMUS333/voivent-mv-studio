//==============================================================================
// 歌詞フレーズ → リップシンク viseme 変換ユーティリティ。
//
// 背景:
//   MV モードでは AI 歌詞起こし & 自動配置で生成された LyricItem[] が
//   フレーズ単位で { time, duration, text } を持つ。これを 1 文字ずつ
//   均等時間スライスし、各文字を 50 音（あいうえお…）→ viseme 5 母音
//   (a/i/u/e/o) + sil に分類する。
//
//   これにより「喋ってない時に口が動く」事故を歌詞の無い区間 = 確実に sil
//   として排除できる。歌詞が無い区間や未接続のフレーズは null を返し、
//   呼び出し側（useMvAudioSignals / LivePreviewPlayer / mvOfflineRender）
//   が C++ 側フォルマント推定やオフライン擬似 viseme にフォールバックする。
//==============================================================================
import type { LyricItem, VisemeKind } from './types';

/** 歌詞から生成した viseme スナップショット */
export interface LyricsVisemeSnapshot {
    viseme: VisemeKind;
    /** 開口量 0..1。0 = 完全に閉じた状態（sil） */
    visemeStrength: number;
    /** 歌詞中の現在位置にある文字（デバッグ・キャプション表示用） */
    char: string;
    /** 何番目の文字を話しているか（0..text.length-1）。歌詞表示連携用 */
    charIndex: number;
    /** 文字毎の開口量プリセット（あ=大、i=小 など） */
    charStrength: number;
}

/**
 * 1 文字を 50 音 → viseme 5 母音に変換する。
 * - 母音 a/i/u/e/o は対応する viseme を返す
 * - 撥音 ん、促音 っ、長音 ー、空白は 'sil'（口を閉じる）
 * - 小書き（ぁ/ぃ/ぅ/ぇ/ぉ/ゃ/ゅ/ょ/ゎ）も同じ母音として扱う
 * - 英字・数字・記号は 'sil' + 弱開口（ニュートラル）
 * - 開口量は音響的な大小関係: a/o > e > i/u を基本に 0..1 で返す
 */
export function charToViseme(ch: string): { viseme: VisemeKind; strength: number } {
    if (!ch) return { viseme: 'sil', strength: 0 };
    const code = ch.codePointAt(0) ?? 0;
    const isHiragana = code >= 0x3040 && code <= 0x309f;
    const isKatakana = code >= 0x30a0 && code <= 0x30ff;
    if (ch === ' ' || ch === '\n' || ch === '\t') {
        return { viseme: 'sil', strength: 0 };
    }
    // 句読点・中黒等の区切り記号 → 完全 sil（口を動かすな）
    if (ch === '、' || ch === '。' || ch === '，' || ch === '．' || ch === '・' || ch === '?' || ch === '!' || ch === '？' || ch === '！' || ch === '…' || ch === '‥' || ch === '~' || ch === '〜' || ch === ',') {
        return { viseme: 'sil', strength: 0 };
    }
    if (!isHiragana && !isKatakana) {
        // 英字・数字・記号 → ニュートラル弱開口
        return { viseme: 'sil', strength: 0.15 };
    }
    // カタカナをひらがな範囲へ寄せる
    const base = isKatakana ? code - 0x60 : code;
    switch (base) {
        // あ段
        case 0x3042: return { viseme: 'a', strength: 1.00 };
        case 0x3044: return { viseme: 'i', strength: 0.55 };
        case 0x3046: return { viseme: 'u', strength: 0.55 };
        case 0x3048: return { viseme: 'e', strength: 0.75 };
        case 0x304a: return { viseme: 'o', strength: 0.95 };
        // か行
        case 0x304b: return { viseme: 'a', strength: 0.80 };
        case 0x304d: return { viseme: 'i', strength: 0.45 };
        case 0x304f: return { viseme: 'u', strength: 0.40 };
        case 0x3051: return { viseme: 'e', strength: 0.65 };
        case 0x3053: return { viseme: 'o', strength: 0.85 };
        // さ行
        case 0x3055: return { viseme: 'a', strength: 0.80 };
        case 0x3057: return { viseme: 'i', strength: 0.45 };
        case 0x3059: return { viseme: 'u', strength: 0.45 };
        case 0x305b: return { viseme: 'e', strength: 0.65 };
        case 0x305d: return { viseme: 'o', strength: 0.85 };
        // た行
        case 0x305f: return { viseme: 'a', strength: 0.80 };
        case 0x3061: return { viseme: 'i', strength: 0.50 };
        case 0x3064: return { viseme: 'u', strength: 0.50 };
        case 0x3066: return { viseme: 'e', strength: 0.65 };
        case 0x3068: return { viseme: 'o', strength: 0.85 };
        // な行
        case 0x306a: return { viseme: 'a', strength: 0.85 };
        case 0x306b: return { viseme: 'i', strength: 0.50 };
        case 0x306c: return { viseme: 'u', strength: 0.55 };
        case 0x306d: return { viseme: 'e', strength: 0.70 };
        case 0x306e: return { viseme: 'o', strength: 0.90 };
        // は行
        case 0x306f: return { viseme: 'a', strength: 0.80 };
        case 0x3072: return { viseme: 'i', strength: 0.50 };
        case 0x3075: return { viseme: 'u', strength: 0.50 };
        case 0x3078: return { viseme: 'e', strength: 0.70 };
        case 0x307b: return { viseme: 'o', strength: 0.85 };
        // ま行
        case 0x307e: return { viseme: 'a', strength: 0.85 };
        case 0x307f: return { viseme: 'i', strength: 0.50 };
        case 0x3080: return { viseme: 'u', strength: 0.50 };
        case 0x3081: return { viseme: 'e', strength: 0.70 };
        case 0x3082: return { viseme: 'o', strength: 0.90 };
        // や行
        case 0x3084: return { viseme: 'a', strength: 0.85 };
        case 0x3086: return { viseme: 'u', strength: 0.50 };
        case 0x3088: return { viseme: 'o', strength: 0.90 };
        // ら行
        case 0x3089: return { viseme: 'a', strength: 0.80 };
        case 0x308a: return { viseme: 'i', strength: 0.50 };
        case 0x308b: return { viseme: 'u', strength: 0.50 };
        case 0x308c: return { viseme: 'e', strength: 0.70 };
        case 0x308d: return { viseme: 'o', strength: 0.90 };
        // わ行
        case 0x308f: return { viseme: 'a', strength: 0.80 };
        case 0x3090: return { viseme: 'u', strength: 0.50 };
        case 0x3091: return { viseme: 'e', strength: 0.70 };
        case 0x3092: return { viseme: 'o', strength: 0.90 };
        // 非母音基本
        case 0x3093: return { viseme: 'sil', strength: 0.10 }; // ん（鼻音）
        case 0x3063: return { viseme: 'sil', strength: 0 };    // っ（促音）
        case 0x30fc: return { viseme: 'sil', strength: 0 };    // ー（長音）
        // 小書き母音
        case 0x3041: return { viseme: 'a', strength: 0.90 };
        case 0x3043: return { viseme: 'i', strength: 0.50 };
        case 0x3045: return { viseme: 'u', strength: 0.50 };
        case 0x3047: return { viseme: 'e', strength: 0.70 };
        case 0x3049: return { viseme: 'o', strength: 0.85 };
        // 小書き拗音
        case 0x3083: return { viseme: 'a', strength: 0.85 };
        case 0x3085: return { viseme: 'u', strength: 0.50 };
        case 0x3087: return { viseme: 'o', strength: 0.90 };
        case 0x308e: return { viseme: 'a', strength: 0.80 };
        // 外来音（ヴ → u）
        case 0x30f4: return { viseme: 'u', strength: 0.50 };
    }
    return { viseme: 'sil', strength: 0 };
}

/**
 * 歌詞フレーズ配列と現在時刻から、対応する文字の viseme を取得する。
 *
 * - 時刻がどのフレーズ区間にも属さなければ null を返す
 *   → 呼び出し側で C++ viseme へフォールバック
 * - フレーズ内：text を 1 文字ずつ均等時間スライスし、
 *   `t` が属する文字を採用（端数は前後の文字で線形補間しない：最小実装）
 * - text が空 / 空白のみ / duration 0 → null
 */
export function lyricsVisemeAtTime(
    lyrics: LyricItem[] | undefined,
    t: number,
): LyricsVisemeSnapshot | null {
    if (!lyrics || lyrics.length === 0) return null;
    if (!Number.isFinite(t)) return null;
    for (const phrase of lyrics) {
        const start = phrase.time;
        if (t < start) continue;
        const dur = phrase.duration ?? 0;
        if (!Number.isFinite(dur) || dur <= 0) continue;
        const end = start + dur;
        if (t >= end) continue;
        const text = (phrase.text ?? '').trim();
        if (text.length === 0) continue;
        const perChar = dur / text.length;
        if (perChar <= 0) continue;
        const charIdx = Math.min(text.length - 1, Math.max(0, Math.floor((t - start) / perChar)));
        const ch = text.charAt(charIdx);
        const { viseme: baseViseme, strength: baseStrength } = charToViseme(ch);

        // 自然さのための特例:
        // 「ー」（長音）は前の母音を保持する。"ハロー" の "ー" は "ハ" の a のまま
        // 口の形で滑らかに持続するのが自然。前の文字が無い / sil のときは弱口の i。
        if (ch === 'ー' || ch === '〜' || ch === '~') {
            if (charIdx > 0) {
                for (let j = charIdx - 1; j >= 0; j--) {
                    const prev = charToViseme(text.charAt(j));
                    if (prev.viseme !== 'sil' && prev.strength > 0) {
                        return {
                            viseme: prev.viseme,
                            visemeStrength: prev.strength * 0.85, // 持続は少し弱める
                            char: ch,
                            charIndex: charIdx,
                            charStrength: prev.strength * 0.85,
                        };
                    }
                }
            }
            // 前の母音が無い → 中立 i
            return { viseme: 'i', visemeStrength: 0.45, char: ch, charIndex: charIdx, charStrength: 0.45 };
        }

        // 「ん」「っ」「・」「、」「。」「 」（sil 文字）の直後の 1 文字は
        // 子音→母音への滑らかな繋ぎとして少しだけ strength を抑える。
        // （口の「溜め」を表現）
        let adjustedStrength = baseStrength;
        if (charIdx > 0) {
            const prevCh = text.charAt(charIdx - 1);
            if (prevCh === 'っ' || prevCh === '・' || prevCh === '、' || prevCh === '。' || prevCh === ' ') {
                adjustedStrength = Math.max(0, baseStrength * 0.7);
            }
        }

        return {
            viseme: baseViseme,
            visemeStrength: adjustedStrength,
            char: ch,
            charIndex: charIdx,
            charStrength: adjustedStrength,
        };
    }
    return null;
}

/**
 * 歌詞から推定される viseme を、C++ 側の viseme とマージする。
 *
 * マージ戦略 (歌詞ベースの口パクを厳格に守る):
 *  1. 歌詞が完全に未設定 (undefined / [] / 有効フレーズ 0) → C++ 波形 viseme にフォールバック
 *     （歌詞が無い状態 = 古いプロジェクト or 歌詞 OFF 設定 = 波形主導）
 *  2. 歌詞があり、区間内 → 歌詞 viseme を優先採用
 *  3. 歌詞があり、区間外 (= 歌詞にない区間) → **完全 sil**
 *     → これが重要。歌詞外で C++ 波形にフォールバックすると、
 *     環境音・BGV・休符で口がパカパカ動く事故が起きるため。
 */
export function mergeVisemeWithLyrics(
    cppViseme: VisemeKind,
    cppStrength: number,
    lyrics: LyricItem[] | undefined,
    t: number,
): { viseme: VisemeKind; visemeStrength: number } {
    // 歌詞が完全に無い / 空 → 波形モードにフォールバック
    const hasAnyLyrics = Array.isArray(lyrics) && lyrics.length > 0
        && lyrics.some(l => (l.text ?? '').trim().length > 0);
    if (!hasAnyLyrics) {
        return { viseme: cppViseme, visemeStrength: cppStrength };
    }
    // 歌詞がある → 歌詞区間内のみ viseme 採用、区間外は完全 sil
    const fromLyrics = lyricsVisemeAtTime(lyrics, t);
    if (fromLyrics) {
        return { viseme: fromLyrics.viseme, visemeStrength: fromLyrics.visemeStrength };
    }
    // 歌詞区間外 → 完全 sil（口を動かすな）
    return { viseme: 'sil', visemeStrength: 0 };
}
