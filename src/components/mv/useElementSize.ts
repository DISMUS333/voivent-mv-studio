//==============================================================================
// 要素サイズ追跡フック。ResizeObserver でコンテナ実寸を監視し、
// レターボックスフレーム計算などレイアウト依存の処理へ供給する。
//==============================================================================
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface ElementSize {
    width: number;
    height: number;
}

/**
 * 指定要素のクライアントサイズを追跡する。
 * ResizeObserver 未対応環境では window resize イベントへフォールバックする。
 * 戻り値は [ref, size]。初期計測前は { width: 0, height: 0 }。
 */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, ElementSize] {
    const ref = useRef<T | null>(null);
    const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        if (typeof ResizeObserver === 'undefined') {
            const onResize = () => setSize({ width: el.clientWidth, height: el.clientHeight });
            onResize();
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }

        const ro = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            const cr = entry.contentRect;
            setSize({ width: Math.round(cr.width), height: Math.round(cr.height) });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return [ref, size];
}
