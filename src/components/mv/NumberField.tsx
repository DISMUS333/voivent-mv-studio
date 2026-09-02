//==============================================================================
// 数値入力フィールド（編集中は自由入力・確定時に検証）。
//
// 状態値を直接バインドした実装だと、空欄や「最後の 1 文字を消した」途中状態が
// その場で不正値として弾かれ、表示が即座に戻されるため
// 「1 文字残って消せない」「一旦消して打ち直せない」という入力体験になる。
// これを防ぐため、編集中はローカルドラフトを保持し、
// フォーカスアウト / Enter 確定時のみ min〜max へクランプして通知する。
// フォーカス時は全選択するので、既存数字を消さずそのまま打ち直せる。
//==============================================================================
import React, { useEffect, useState } from 'react';

export interface NumberFieldProps {
    /** 現在の確定済み値 */
    value: number;
    /** 確定時（フォーカスアウト / Enter）に呼ばれる。クランプ済みの値を渡す */
    onCommit: (v: number) => void;
    /** 最小値（既定 0） */
    min?: number;
    /** 最大値（既定上限なし） */
    max?: number;
    /** 不正入力（空欄等）を確定したときのフォールバック値 */
    fallback?: number;
    title?: string;
    style?: React.CSSProperties;
}

/** 表示用整形（小数第 2 位で丸め、末尾の 0 を詰めた文字列） */
function formatNumberValue(v: number): string {
    return String(Number((Number.isFinite(v) ? v : 0).toFixed(2)));
}

export const NumberField: React.FC<NumberFieldProps> = ({
    value,
    onCommit,
    min = 0,
    max = Number.POSITIVE_INFINITY,
    fallback = min,
    title,
    style,
}) => {
    const [draft, setDraft] = useState<string>(formatNumberValue(value));
    const [editing, setEditing] = useState(false);

    // 非編集中のみ外部更新（▲▼ボタン等）を表示へ反映。編集中は上書きしない
    useEffect(() => {
        if (!editing) setDraft(formatNumberValue(value));
    }, [value, editing]);

    const commitDraft = () => {
        if (!editing) return;
        setEditing(false);
        const v = parseFloat(draft.trim());
        if (Number.isFinite(v)) {
            onCommit(Math.max(min, Math.min(max, v)));
        } else {
            onCommit(fallback);
            setDraft(formatNumberValue(fallback));
        }
    };

    const cancelEdit = () => {
        setEditing(false);
        setDraft(formatNumberValue(value));
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            value={editing ? draft : formatNumberValue(value)}
            onFocus={(e) => {
                setEditing(true);
                setDraft(formatNumberValue(value));
                // 全選択: 既存数字を削除せずそのまま打ち直せる
                e.target.select();
            }}
            onChange={(e) => {
                setEditing(true);
                setDraft(e.target.value);
            }}
            onBlur={commitDraft}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEdit();
                    (e.target as HTMLInputElement).blur();
                }
            }}
            style={{ MozAppearance: 'textfield', WebkitAppearance: 'none', ...style } as React.CSSProperties}
            title={title}
        />
    );
};