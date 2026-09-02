//==============================================================================
// ステムオファーの表示制御ロジック (localStorage 永続化) のテスト。
//==============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { isStemOfferDismissed, setStemOfferDismissed } from './MvStemOfferDialog';

describe('stem offer dismissal', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('初期状態は未.dismissed (オファーを表示する)', () => {
        expect(isStemOfferDismissed()).toBe(false);
    });

    it('setStemOfferDismissed 後は true (二度と表示しない)', () => {
        setStemOfferDismissed();
        expect(isStemOfferDismissed()).toBe(true);
    });

    it('永続化される (ページ再読込相当でも維持)', () => {
        setStemOfferDismissed();
        // localStorage モックはメモリ保持なので同一インスタンスで検証
        expect(localStorage.getItem('voivent.mv.stemOffer.dismissed')).toBe('1');
    });
});
