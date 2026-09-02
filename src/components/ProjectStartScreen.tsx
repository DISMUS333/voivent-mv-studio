import { useEffect, useMemo, useState } from 'react';
import type { RecentProject } from '../project/ProjectTypes';
import { PROJECT_TAG_CANDIDATES, PROJECT_COLOR_PRESETS } from '../project/ProjectTypes';
import { native } from '../native';

type ProjectBackupItem = {
    fileName: string;
    filePath: string;
    sampleRate: number;
    numTracks: number;
    formattedTime: string;
    relativeTime: string;
    timestamp: number;
};

type ProjectStartScreenProps = {
    recentProjects: RecentProject[];
    onCreate: (name: string, tags: string[], color?: string) => void | Promise<void>;
    onOpen: () => void;
    onSelectRecent: (project: RecentProject) => void;
    onUpdateProject: (project: RecentProject) => void;
    onForgetRecent: (project: RecentProject) => void;
};

const cardStyle: React.CSSProperties = { border: '1px solid #343b48', borderRadius: 10, background: '#252a32', color: '#eef2f7', cursor: 'pointer' };

function normaliseTags(tags: string[]) {
    return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

async function copyText(text: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('copy failed');
    return true;
}

function formatBackupTime(timestamp: number) {
    const d = new Date(timestamp);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const daysDiff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

    const timeStr = d.toLocaleTimeString('ja-JP', { hour12: false });
    const dateStr = d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });

    if (isToday) {
        return `今日 - ${dateStr} ${timeStr}`;
    }
    if (daysDiff === 1) {
        return `昨日 - ${dateStr} ${timeStr}`;
    }
    if (daysDiff < 7 && daysDiff > 1) {
        return `${daysDiff}日前 - ${dateStr} ${timeStr}`;
    }
    return `${dateStr} ${timeStr}`;
}

export function ProjectStartScreen({ recentProjects, onCreate, onOpen, onSelectRecent, onUpdateProject, onForgetRecent }: ProjectStartScreenProps) {
    const [projectName, setProjectName] = useState('新規プロジェクト');
    const [projectTags, setProjectTags] = useState<string[]>([]);
    const [projectColor, setProjectColor] = useState<string>('#3b82f6');
    const [customTag, setCustomTag] = useState('');
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<'recent' | 'all'>('recent');
    const [tagFilter, setTagFilter] = useState<string | null>(null);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(recentProjects[0]?.id ?? null);
    const [isEditingTags, setIsEditingTags] = useState(false);
    const [editingTags, setEditingTags] = useState('');
    const [copiedPath, setCopiedPath] = useState(false);
    const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    // 🪟 右クリックコンテキストメニューステート
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: RecentProject } | null>(null);
    const [backups, setBackups] = useState<ProjectBackupItem[]>([]);
    const [isLoadingBackups, setIsLoadingBackups] = useState(false);

    // コンテキストメニューが開いた時にバックアップ一覧を取得
    useEffect(() => {
        if (!contextMenu || !contextMenu.project.path) {
            setBackups([]);
            return;
        }
        setIsLoadingBackups(true);
        native.getProjectBackups(contextMenu.project.path).then(
            (list) => {
                if (Array.isArray(list)) {
                    setBackups(list as ProjectBackupItem[]);
                } else {
                    setBackups([]);
                }
                setIsLoadingBackups(false);
            },
            () => {
                setBackups([]);
                setIsLoadingBackups(false);
            }
        );
    }, [contextMenu]);

    // 外側クリックでコンテキストメニューを閉じる
    useEffect(() => {
        const handleClickOutside = () => setContextMenu(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    const availableTags = useMemo<string[]>(() => recentProjects.reduce<string[]>((tags, project) => {
        (project.tags ?? []).forEach((tag) => {
            if (tags.indexOf(tag) < 0) tags.push(tag);
        });
        return tags;
    }, []), [recentProjects]);

    const filteredProjects = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return recentProjects.filter((project) => {
            if (category === 'recent' && project.isRecent === false) return false;
            const tags = project.tags ?? [];
            if (tagFilter && tags.indexOf(tagFilter) < 0) return false;
            return !query || `${project.name} ${project.path ?? ''} ${tags.join(' ')}`.toLocaleLowerCase().includes(query);
        });
    }, [category, recentProjects, search, tagFilter]);

    const selectedProject = recentProjects.find((project) => project.id === selectedProjectId) ?? filteredProjects[0] ?? null;

    const submitCreate = () => {
        if (!projectName.trim() || isCreating) return;
        setIsCreating(true);
        Promise.resolve(onCreate(projectName, normaliseTags(projectTags), projectColor)).then(() => setIsCreating(false), () => setIsCreating(false));
    };

    const addCustomTag = () => {
        const tag = customTag.trim();
        if (tag) setProjectTags((current) => normaliseTags([...current, tag]));
        setCustomTag('');
    };

    return (
        <div style={{ minHeight: '100vh', maxHeight: '100vh', overflowY: 'auto', background: '#17191d', color: '#eef2f7', fontFamily: 'system-ui, sans-serif' }}>
            <header style={{ height: 76, display: 'flex', alignItems: 'center', padding: '0 34px', borderBottom: '1px solid #2d323b', background: '#24272c' }}>
                <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1 }}>Voivent <span style={{ color: '#4d9fff' }}>DAW</span></div>
                <div style={{ marginLeft: 'auto', color: '#8f98a6', fontSize: 13 }}>プロジェクトを選択</div>
            </header>
            <main style={{ maxWidth: 1280, margin: '0 auto', padding: '42px 34px' }}>
                <section style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
                    <button type="button" onClick={() => setIsNewProjectModalOpen(true)} style={{ ...cardStyle, minHeight: 138, textAlign: 'left', padding: 24 }}><div style={{ fontSize: 42, color: '#4d9fff', lineHeight: 1, marginBottom: 18 }}>＋</div><div style={{ fontSize: 18, fontWeight: 800 }}>新規プロジェクト</div><div style={{ color: '#929baa', marginTop: 7 }}>名前とタグを決めて制作を開始</div></button>
                    <button type="button" onClick={onOpen} style={{ ...cardStyle, padding: '13px 20px', minHeight: 0, textAlign: 'left' }}>▱　開く</button>
                    <div style={{ marginLeft: 'auto', color: '#929baa', fontSize: 13 }}>{filteredProjects.length} 件を表示</div>
                </section>
                <section style={{ ...cardStyle, padding: 0, overflow: 'hidden', cursor: 'default' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '18px 22px', borderBottom: '1px solid #343b48' }}>
                        <strong style={{ fontSize: 19 }}>プロジェクトブラウザ</strong>
                        <div style={{ display: 'flex', gap: 4 }}>{([['recent', '最近使った項目'], ['all', 'すべて']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setCategory(id)} style={{ border: 0, borderRadius: 5, padding: '7px 10px', background: category === id ? '#354b68' : 'transparent', color: category === id ? '#fff' : '#8993a1', cursor: 'pointer' }}>{label}</button>)}</div>
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名前・タグ・保存場所を検索" style={{ marginLeft: 'auto', width: 230, padding: '9px 12px', borderRadius: 6, border: '1px solid #454e5d', background: '#1b1f25', color: '#fff' }} />
                        <div style={{ width: '100%', display: 'flex', gap: 6, flexWrap: 'wrap' }}><span style={{ color: '#929baa', fontSize: 13, padding: '6px 2px' }}>タグ:</span><button type="button" onClick={() => setTagFilter(null)} style={{ border: '1px solid #454e5d', borderRadius: 14, padding: '5px 10px', background: tagFilter === null ? '#347fc9' : '#252a32', color: '#eef2f7', cursor: 'pointer' }}>すべて</button>{availableTags.map((tag) => <button key={tag} type="button" onClick={() => setTagFilter(tag)} style={{ border: '1px solid #454e5d', borderRadius: 14, padding: '5px 10px', background: tagFilter === tag ? '#347fc9' : '#252a32', color: '#eef2f7', cursor: 'pointer' }}>{tag}</button>)}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 310px', minHeight: 420 }}>
                        <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                            <div style={{ display: 'grid', gap: 2, padding: 14 }}>
                                {filteredProjects.length === 0 ? (
                                    <div style={{ color: '#8993a1', padding: '38px 16px' }}>該当するプロジェクトはありません。</div>
                                ) : (
                                    filteredProjects.map((project) => {
                                        const pColor = project.color || '#3b82f6';
                                        return (
                                            <button
                                                key={project.id}
                                                type="button"
                                                onClick={() => setSelectedProjectId(project.id)}
                                                onDoubleClick={() => onSelectRecent(project)}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setSelectedProjectId(project.id);
                                                    setContextMenu({ x: e.clientX, y: e.clientY, project });
                                                }}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    padding: '14px 12px',
                                                    textAlign: 'left',
                                                    border: `1px solid ${selectedProject?.id === project.id ? '#4d9fff' : 'transparent'}`,
                                                    borderRadius: 7,
                                                    background: selectedProject?.id === project.id ? '#2d3747' : 'transparent',
                                                    color: '#eef2f7',
                                                    cursor: 'pointer',
                                                    position: 'relative',
                                                }}
                                            >
                                                {/* 🎨 カスタマイズ可能なプロジェクトアイコン (SVG) */}
                                                <span
                                                    style={{
                                                        width: 36,
                                                        height: 36,
                                                        display: 'grid',
                                                        placeItems: 'center',
                                                        marginRight: 14,
                                                        borderRadius: 8,
                                                        background: `${pColor}22`,
                                                        border: `1px solid ${pColor}55`,
                                                        color: pColor,
                                                        boxShadow: `0 0 10px ${pColor}20`,
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <rect x="3" y="3" width="18" height="18" rx="3" />
                                                        <circle cx="12" cy="12" r="3" />
                                                    </svg>
                                                </span>
                                                <span style={{ flex: 1, minWidth: 0 }}>
                                                    <strong style={{ display: 'block', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {project.name}
                                                    </strong>
                                                    <small style={{ color: '#8993a1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                                        {(project.tags ?? []).join(' · ') || 'タグなし'}　{project.path ?? ''}
                                                    </small>
                                                </span>
                                                <small style={{ color: '#8993a1', marginLeft: 12, flexShrink: 0 }}>
                                                    {new Date(project.updatedAt).toLocaleDateString('ja-JP')}
                                                </small>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                        <aside style={{ borderLeft: '1px solid #343b48', padding: 22, background: '#20242b' }}>
                            {selectedProject ? (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px' }}>
                                        <span
                                            style={{
                                                width: 32,
                                                height: 32,
                                                display: 'grid',
                                                placeItems: 'center',
                                                borderRadius: 8,
                                                background: `${selectedProject.color || '#3b82f6'}22`,
                                                border: `1px solid ${selectedProject.color || '#3b82f6'}55`,
                                                color: selectedProject.color || '#3b82f6',
                                                flexShrink: 0,
                                            }}
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <rect x="3" y="3" width="18" height="18" rx="3" />
                                                <circle cx="12" cy="12" r="3" />
                                            </svg>
                                        </span>
                                        <h2 style={{ margin: 0, fontSize: 19, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {selectedProject.name}
                                        </h2>
                                    </div>

                                    {/* 🎨 アイコンカラー変更パレット */}
                                    <div style={{ color: '#929baa', fontSize: 13, lineHeight: 1.7, marginBottom: 14 }}>
                                        アイコンカラー
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                            {PROJECT_COLOR_PRESETS.map((p) => {
                                                const isSelected = (selectedProject.color || '#3b82f6') === p.hex;
                                                return (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => onUpdateProject({ ...selectedProject, color: p.hex })}
                                                        title={p.label}
                                                        style={{
                                                            width: 22,
                                                            height: 22,
                                                            borderRadius: '50%',
                                                            background: p.hex,
                                                            border: isSelected ? '2px solid #ffffff' : '2px solid transparent',
                                                            boxShadow: isSelected ? `0 0 8px ${p.hex}` : 'none',
                                                            cursor: 'pointer',
                                                            transition: 'all 0.15s ease',
                                                            transform: isSelected ? 'scale(1.2)' : 'scale(1)',
                                                        }}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div style={{ color: '#929baa', fontSize: 13, lineHeight: 1.7 }}>
                                        タグ<br />
                                        {isEditingTags ? (
                                            <>
                                                <input autoFocus value={editingTags} onChange={(event) => setEditingTags(event.target.value)} placeholder="タグをカンマ区切りで入力" style={{ width: '100%', boxSizing: 'border-box', marginTop: 7, padding: '8px 9px', borderRadius: 6, border: '1px solid #4d9fff', background: '#1b1f25', color: '#fff' }} />
                                                <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                                                    <button type="button" onClick={() => { onUpdateProject({ ...selectedProject, tags: normaliseTags(editingTags.split(',')) }); setIsEditingTags(false); }} style={{ flex: 1, padding: '8px 10px', border: 0, borderRadius: 6, background: '#347fc9', color: '#fff', cursor: 'pointer' }}>保存</button>
                                                    <button type="button" onClick={() => setIsEditingTags(false)} style={{ flex: 1, padding: '8px 10px', border: '1px solid #4a5568', borderRadius: 6, background: 'transparent', color: '#d5dbe4', cursor: 'pointer' }}>キャンセル</button>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                                                    {(selectedProject.tags ?? []).map((tag) => <span key={tag} style={{ borderRadius: 14, padding: '3px 8px', background: '#354b68', color: '#eef2f7' }}>{tag}</span>)}
                                                    {!(selectedProject.tags ?? []).length && <span>タグなし</span>}
                                                </div>
                                                <button type="button" onClick={() => { setEditingTags((selectedProject.tags ?? []).join(', ')); setIsEditingTags(true); }} style={{ marginTop: 8, padding: '7px 10px', border: '1px solid #4a5568', borderRadius: 6, background: 'transparent', color: '#d5dbe4', cursor: 'pointer' }}>タグを編集</button>
                                            </>
                                        )}
                                    </div>
                                    <div style={{ color: '#929baa', fontSize: 13, lineHeight: 1.7, marginTop: 16 }}>
                                        更新日時<br />
                                        <strong style={{ color: '#eef2f7' }}>{new Date(selectedProject.updatedAt).toLocaleString('ja-JP')}</strong>
                                    </div>
                                    <div style={{ color: '#929baa', fontSize: 13, lineHeight: 1.7, marginTop: 16, wordBreak: 'break-all' }}>
                                        保存場所<br />
                                        <strong style={{ color: '#eef2f7' }}>{selectedProject.path ?? '未保存'}</strong>
                                        {selectedProject.path && (
                                            <>
                                                <button type="button" onClick={async () => { try { await copyText(selectedProject.path ?? ''); setCopiedPath(true); window.setTimeout(() => setCopiedPath(false), 1600); } catch { setCopiedPath(false); } }} style={{ display: 'block', marginTop: 8, padding: '7px 10px', border: '1px solid #4a5568', borderRadius: 6, background: 'transparent', color: '#d5dbe4', cursor: 'pointer' }}>
                                                    {copiedPath ? 'コピーしました' : '保存場所をコピー'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                    <button type="button" onClick={() => onSelectRecent(selectedProject)} style={{ width: '100%', marginTop: 24, padding: '12px 16px', border: 0, borderRadius: 6, background: '#347fc9', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>開く</button>
                                    {selectedProject.isRecent !== false && (
                                        <button type="button" onClick={() => { setSelectedProjectId(null); onForgetRecent(selectedProject); }} style={{ width: '100%', marginTop: 9, padding: '9px 12px', border: '1px solid #6c4b52', borderRadius: 6, background: 'transparent', color: '#e6a7ad', cursor: 'pointer' }}>最近使った項目から削除</button>
                                    )}
                                    {selectedProject.isRecent === false && (
                                        <button type="button" onClick={() => onSelectRecent(selectedProject)} style={{ width: '100%', marginTop: 9, padding: '9px 12px', border: '1px solid #4a5568', borderRadius: 6, background: 'transparent', color: '#d5dbe4', cursor: 'pointer' }}>最近に戻す</button>
                                    )}
                                </>
                            ) : (
                                <div style={{ color: '#8993a1', paddingTop: 40 }}>新規プロジェクトを作成するか、一覧から選択してください。</div>
                            )}
                        </aside>
                    </div>
                </section>
            </main>
            {isNewProjectModalOpen && (
                <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isCreating) setIsNewProjectModalOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0, 0, 0, 0.68)', backdropFilter: 'blur(5px)' }}>
                    <section role="dialog" aria-modal="true" style={{ width: 'min(620px, 100%)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', border: '1px solid #46536a', borderRadius: 14, background: '#252a32', color: '#eef2f7', boxShadow: '0 24px 80px rgba(0,0,0,0.55)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #343b48' }}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: 22 }}>新規プロジェクト</h2>
                                <div style={{ color: '#929baa', marginTop: 5, fontSize: 13 }}>名前、タグ、アイコンカラーを決めて保存場所を選択します。</div>
                            </div>
                            <button type="button" disabled={isCreating} onClick={() => setIsNewProjectModalOpen(false)} aria-label="閉じる" style={{ border: 0, background: 'transparent', color: '#aeb7c4', fontSize: 25, cursor: 'pointer' }}>×</button>
                        </div>
                        <div style={{ padding: 24 }}>
                            <label style={{ display: 'block', color: '#aeb7c4', fontSize: 13, marginBottom: 7 }}>プロジェクト名</label>
                            <input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 7, border: '1px solid #4d9fff', background: '#303640', color: '#fff', fontSize: 16 }} />

                            {/* 🎨 新規作成時のアイコンカラー選択 */}
                            <div style={{ marginTop: 20, color: '#aeb7c4', fontSize: 13 }}>アイコンカラー</div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                {PROJECT_COLOR_PRESETS.map((p) => {
                                    const isSelected = projectColor === p.hex;
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => setProjectColor(p.hex)}
                                            style={{
                                                width: 28,
                                                height: 28,
                                                borderRadius: '50%',
                                                background: p.hex,
                                                border: isSelected ? '2px solid #ffffff' : '2px solid transparent',
                                                boxShadow: isSelected ? `0 0 10px ${p.hex}` : 'none',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s ease',
                                                transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                                            }}
                                            title={p.label}
                                        />
                                    );
                                })}
                            </div>

                            <div style={{ marginTop: 22, color: '#aeb7c4', fontSize: 13 }}>分類タグ（複数選択可）</div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                                {PROJECT_TAG_CANDIDATES.map((tag) => <button key={tag} type="button" onClick={() => setProjectTags((current) => current.indexOf(tag) >= 0 ? current.filter((item) => item !== tag) : [...current, tag])} style={{ border: '1px solid #4a5568', borderRadius: 16, padding: '7px 12px', background: projectTags.indexOf(tag) >= 0 ? '#347fc9' : '#303640', color: '#fff', cursor: 'pointer' }}>{tag}</button>)}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <input value={customTag} onChange={(event) => setCustomTag(event.target.value)} placeholder="自由入力タグ" style={{ flex: 1, padding: '9px 11px', borderRadius: 6, border: '1px solid #454e5d', background: '#1b1f25', color: '#fff' }} />
                                <button type="button" onClick={addCustomTag} style={{ padding: '9px 13px', border: '1px solid #4a5568', borderRadius: 6, background: '#303640', color: '#fff', cursor: 'pointer' }}>追加</button>
                            </div>
                            {projectTags.length > 0 && <div style={{ marginTop: 12, color: '#9da8b8', fontSize: 13 }}>選択中: {projectTags.join(' · ')}</div>}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 26 }}>
                                <button type="button" disabled={isCreating} onClick={() => setIsNewProjectModalOpen(false)} style={{ padding: '11px 18px', border: '1px solid #4a5568', borderRadius: 7, background: 'transparent', color: '#d5dbe4', cursor: 'pointer' }}>キャンセル</button>
                                <button type="button" disabled={!projectName.trim() || isCreating} onClick={submitCreate} style={{ padding: '11px 20px', border: 0, borderRadius: 7, background: projectName.trim() && !isCreating ? '#347fc9' : '#46505e', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{isCreating ? '保存場所を開いています…' : '保存場所を選んで作成'}</button>
                            </div>
                        </div>
                    </section>
                </div>
            )}

            {/* 🪟 プロ仕様 右クリックコンテキストメニュー（自動バックアップ世代一覧＆Finder表示） */}
            {contextMenu && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'fixed',
                        left: Math.min(window.innerWidth - 440, Math.max(10, contextMenu.x)),
                        top: Math.min(window.innerHeight - 380, Math.max(10, contextMenu.y)),
                        width: 420,
                        backgroundColor: '#1b2028',
                        border: '1px solid #374151',
                        borderRadius: 8,
                        boxShadow: '0 16px 36px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06)',
                        zIndex: 999999,
                        color: '#e2e8f0',
                        fontSize: 12,
                        overflow: 'hidden',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    }}
                >
                    {/* 上部ヘッダー情報 */}
                    <div
                        style={{
                            padding: '10px 14px',
                            backgroundColor: '#13171e',
                            borderBottom: '1px solid #28313f',
                            color: '#94a3b8',
                            fontSize: 11,
                            lineHeight: 1.4,
                        }}
                    >
                        <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                            {contextMenu.project.name}
                        </div>
                        <div>
                            最終更新: {new Date(contextMenu.project.updatedAt).toLocaleString('ja-JP')}
                        </div>
                    </div>

                    {/* 自動バックアップ（Autosaved）世代一覧 */}
                    <div style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 0' }}>
                        {isLoadingBackups ? (
                            <div style={{ padding: '12px 14px', color: '#64748b' }}>バックアップを読み込み中...</div>
                        ) : backups.length === 0 ? (
                            <div style={{ padding: '10px 14px', color: '#64748b', fontStyle: 'italic' }}>
                                自動バックアップ（Autosaved）はまだありません
                            </div>
                        ) : (
                            backups.map((b) => (
                                <button
                                    key={b.fileName}
                                    type="button"
                                    onClick={async () => {
                                        if (contextMenu.project.path) {
                                            const ok = await native.loadProjectBackup(contextMenu.project.path, b.fileName);
                                            if (ok) {
                                                onSelectRecent(contextMenu.project);
                                                setContextMenu(null);
                                            }
                                        }
                                    }}
                                    style={{
                                        width: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        padding: '7px 14px',
                                        backgroundColor: 'transparent',
                                        border: 0,
                                        color: '#cbd5e1',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.12s',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
                                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                            <polyline points="14 2 14 8 20 8"/>
                                            <circle cx="12" cy="14" r="3"/>
                                            <polyline points="12 12 12 14 13.5 15"/>
                                        </svg>
                                    </span>
                                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        <strong style={{ color: '#fff' }}>{contextMenu.project.name} (Autosaved)</strong> - {formatBackupTime(b.timestamp)}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>

                    <div style={{ height: 1, backgroundColor: '#28313f', margin: '4px 0' }} />

                    {/* アクションメニュー項目 */}
                    <button
                        type="button"
                        onClick={async () => {
                            if (contextMenu.project.path) {
                                await native.revealInFinder(contextMenu.project.path);
                            }
                            setContextMenu(null);
                        }}
                        style={{
                            width: '100%',
                            padding: '8px 14px',
                            backgroundColor: 'transparent',
                            border: 0,
                            color: '#cbd5e1',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a3342')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        <span>Finder に表示</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => {
                            onForgetRecent(contextMenu.project);
                            setContextMenu(null);
                        }}
                        style={{
                            width: '100%',
                            padding: '8px 14px',
                            backgroundColor: 'transparent',
                            border: 0,
                            color: '#f87171',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3f1f23')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                        <span>最近使ったファイルリストから削除</span>
                    </button>
                </div>
            )}
        </div>
    );
}