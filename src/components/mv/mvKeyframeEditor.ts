//==============================================================================
// MV シーン キーフレーム編集用の純粋関数群。
// UI（KeyframeEditor）から分離し、単体テスト可能な形で保持する。
//==============================================================================
import type { KeyframeProperty, MvKeyframe, SceneKeyframes } from './types';
import { getDict } from '../../i18n';

/** キーフレーム制御可能プロパティの表示定義（表示ラベルは現在言語で解決） */
export function getKeyframePropertyDefs(): Array<{
    id: KeyframeProperty;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
}> {
    const t = getDict();
    return [
        { id: 'opacity', label: t.kfOpacity, min: 0, max: 1, step: 0.01, defaultValue: 1 },
        { id: 'scale', label: t.kfScale, min: 0, max: 4, step: 0.01, defaultValue: 1 },
        { id: 'rotateDeg', label: t.kfRotate, min: -360, max: 360, step: 1, defaultValue: 0 },
        { id: 'translateXPct', label: t.kfMoveX, min: -100, max: 100, step: 0.5, defaultValue: 0 },
        { id: 'translateYPct', label: t.kfMoveY, min: -100, max: 100, step: 0.5, defaultValue: 0 },
        { id: 'blurPx', label: t.kfBlur, min: 0, max: 40, step: 0.5, defaultValue: 0 },
        { id: 'brightness', label: t.kfBrightness, min: 0, max: 3, step: 0.01, defaultValue: 1 },
    ];
}

/** 互換用の既定プロパティ定義（言語切替反映は getKeyframePropertyDefs() を使用） */
export const KEYFRAME_PROPERTY_DEFS = getKeyframePropertyDefs();

/** イージング種別一覧（表示ラベルは現在言語で解決） */
export function getEasingOptions(): Array<{ id: NonNullable<MvKeyframe['easing']>; label: string }> {
    const t = getDict();
    return [
        { id: 'linear', label: t.easingLinear },
        { id: 'easeIn', label: t.easingIn },
        { id: 'easeOut', label: t.easingOut },
        { id: 'easeInOut', label: t.easingInOut },
    ];
}

/**
 * キーフレーム列を t 昇順へソートした配列を返す（元配列は破壊しない）。
 */
export function sortKeyframeList(list: MvKeyframe[]): MvKeyframe[] {
    return [...list].sort((a, b) => a.t - b.t);
}

/**
 * 指定プロパティへキーフレームを追加する（t 昇順に挿入）。
 * 同一 t の既存フレームがある場合は値を上書きする。
 */
export function addKeyframe(
    keyframes: SceneKeyframes,
    prop: KeyframeProperty,
    kf: MvKeyframe,
): SceneKeyframes {
    const list = sortKeyframeList([...(keyframes[prop] ?? []), { ...kf }]);
    return { ...keyframes, [prop]: list };
}

/**
 * 指定プロパティの index 番目キーフレームを部分更新する。
 * 更新後も t 昇順を維持する。
 */
export function updateKeyframe(
    keyframes: SceneKeyframes,
    prop: KeyframeProperty,
    index: number,
    patch: Partial<MvKeyframe>,
): SceneKeyframes {
    const list = keyframes[prop] ?? [];
    if (index < 0 || index >= list.length) return keyframes;
    const next = list.map((kf, i) => (i === index ? { ...kf, ...patch } : kf));
    return { ...keyframes, [prop]: sortKeyframeList(next) };
}

/**
 * 指定プロパティの index 番目キーフレームを削除する。
 * プロパティのフレーム列が空になった場合はプロパティ自体を除去する。
 */
export function removeKeyframe(
    keyframes: SceneKeyframes,
    prop: KeyframeProperty,
    index: number,
): SceneKeyframes {
    const list = keyframes[prop] ?? [];
    if (index < 0 || index >= list.length) return keyframes;
    const next = list.filter((_, i) => i !== index);
    if (next.length === 0) {
        const rest = { ...keyframes };
        delete rest[prop];
        return rest;
    }
    return { ...keyframes, [prop]: next };
}

/**
 * 指定プロパティのキーフレーム列全体を削除する。
 */
export function clearKeyframeProperty(
    keyframes: SceneKeyframes,
    prop: KeyframeProperty,
): SceneKeyframes {
    const rest = { ...keyframes };
    delete rest[prop];
    return rest;
}

/**
 * キーフレーム定義の妥当性検証。
 * - t は 0〜1 の範囲内であること
 * - 各プロパティに最低 1 フレームあること
 * 戻り値: エラーメッセージ配列（空なら正常）
 */
export function validateKeyframes(keyframes: SceneKeyframes | undefined): string[] {
    if (!keyframes) return [];
    const t = getDict();
    const errors: string[] = [];
    for (const [prop, list] of Object.entries(keyframes) as Array<[KeyframeProperty, MvKeyframe[]]>) {
        if (!Array.isArray(list) || list.length === 0) {
            errors.push(t.kfErrNoFrames(prop));
            continue;
        }
        for (let i = 0; i < list.length; i++) {
            const kf = list[i];
            if (!Number.isFinite(kf.t) || kf.t < 0 || kf.t > 1) {
                errors.push(t.kfErrRange(prop, i));
            }
            if (!Number.isFinite(kf.value)) {
                errors.push(t.kfErrValue(prop, i));
            }
        }
    }
    return errors;
}