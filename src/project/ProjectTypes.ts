export type RecentProject = {
    id: string;
    name: string;
    path?: string;
    updatedAt: string;
    tags?: string[];
    color?: string;
    isRecent?: boolean;
    // 旧履歴との互換用。新規作成では使用しない。
    templateId?: string;
};

export const PROJECT_TAG_CANDIDATES = ['効果音', 'BGM', 'オリジナル曲', '依頼案件', 'ゲーム制作'];

export const PROJECT_COLOR_PRESETS = [
    { id: 'blue', label: 'ブルー', hex: '#3b82f6', bg: 'rgba(59, 130, 246, 0.2)' },
    { id: 'emerald', label: 'エメラルド', hex: '#10b981', bg: 'rgba(16, 185, 129, 0.2)' },
    { id: 'purple', label: 'パープル', hex: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.2)' },
    { id: 'rose', label: 'ローズ', hex: '#f43f5e', bg: 'rgba(244, 63, 94, 0.2)' },
    { id: 'amber', label: 'アンバー', hex: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)' },
    { id: 'cyan', label: 'シアン', hex: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)' },
    { id: 'pink', label: 'ピンク', hex: '#ec4899', bg: 'rgba(236, 72, 153, 0.2)' },
    { id: 'slate', label: 'スレート', hex: '#94a3b8', bg: 'rgba(148, 163, 184, 0.2)' },
];