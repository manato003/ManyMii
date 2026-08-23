import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { EyeOff, Eye, Plus, X, Clock, GripVertical, ChevronRight, Star, FolderPlus, Pin, PinOff, ArrowRight, Trash2, RefreshCw } from 'lucide-react';
import type { Stream, FavoriteNode } from '../types';
import { toDisplayName } from '../types';
import type { Locale } from '../i18n';
import type { HistoryEntry } from '../hooks/useStreamHistory';
import type { FavoriteActions, FolderInfo } from '../hooks/useFavorites';
import { useDragReorder } from '../hooks/useDragReorder';
import { useHoverPanel } from '../hooks/useHoverPanel';
import { useResizable } from '../hooks/useResizable';
import { PlatformIcon } from './PlatformIcon';
import FavoritesTree from './FavoritesTree';

// ── セクション折りたたみ永続化 ──

interface SectionState { favorites: boolean; history: boolean }

const SECTION_KEY = 'panelSections';

function loadSections(): SectionState {
    try {
        const raw = localStorage.getItem(SECTION_KEY);
        return raw ? JSON.parse(raw) : { favorites: false, history: false };
    } catch {
        return { favorites: false, history: false };
    }
}

function saveSections(state: SectionState) {
    try { localStorage.setItem(SECTION_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

// ── Props ──

interface StreamSidePanelProps {
    streams: Stream[];
    onToggleHidden: (id: string) => void;
    onRemove: (id: string) => void;
    onReorder: (fromId: string, toId: string) => void;
    history: HistoryEntry[];
    onAddFromHistory: (entry: HistoryEntry) => void;
    onRemoveFromHistory: (historyId: string) => void;
    onReorderHistory: (fromId: string, toId: string) => void;
    locale: Locale;
    swapped?: boolean;
    hideDelay?: number;
    onOpenAddModal: () => void;
    favorites: FavoriteNode[];
    favoriteChannelIds: Set<string>;
    onFavoriteAction: FavoriteActions;
    onAddFromFavorite: (ch: { type: 'youtube' | 'twitch'; title: string; sourceId: string; inputType: 'channel' | 'video' | 'url' }) => void;
    onAddToFavorites: (entry: HistoryEntry, folderId?: string | null) => void;
    onBulkAddFromFolder: (folderId: string) => void;
    isPinned?: boolean;
    onPinChange?: (pinned: boolean) => void;
    getFavFolders?: () => FolderInfo[];
    onAddStreamToFavorites?: (stream: Stream) => void;
    /** ライブ状態を再確認できる枠の数（0 のときボタンは無効） */
    offlineChannelCount: number;
    onRefreshOffline: () => void;
}

const StreamSidePanel: React.FC<StreamSidePanelProps> = ({
    streams, onToggleHidden, onRemove, onReorder,
    history, onAddFromHistory, onRemoveFromHistory, onReorderHistory,
    locale, swapped = false, hideDelay = 500,
    onOpenAddModal, favorites, favoriteChannelIds, onFavoriteAction, onAddFromFavorite,
    onAddToFavorites, onBulkAddFromFolder,
    isPinned = false, onPinChange, getFavFolders,
    onAddStreamToFavorites,
    offlineChannelCount, onRefreshOffline,
}) => {
    const { visible, show, scheduleHide } = useHoverPanel({ hideDelay, idleTimeout: 5000, isPinned });

    // ── リサイズ ──
    const { width: panelWidth, handleMouseDown: handleResizeMouseDown } = useResizable({
        storageKey: 'streamPanelWidth',
        defaultWidth: 260,
        min: 200,
        max: 480,
        direction: swapped ? 'left' : 'right',
    });

    useEffect(() => {
        document.documentElement.style.setProperty('--stream-panel-width', `${panelWidth}px`);
    }, [panelWidth]);

    // ── セクション折りたたみ ──
    const [sections, setSections] = useState<SectionState>(loadSections);

    const toggleSection = (key: keyof SectionState) => {
        setSections(prev => {
            const next = { ...prev, [key]: !prev[key] };
            saveSections(next);
            return next;
        });
    };

    // ── Explorer 風選択 ──
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectedSection, setSelectedSection] = useState<'favorites' | 'history' | null>(null);
    const [moveTargetFolder, setMoveTargetFolder] = useState('__root__');

    const handleSelect = useCallback((id: string, ctrlKey: boolean, section: 'favorites' | 'history') => {
        if (section !== selectedSection) {
            setSelectedIds(new Set([id]));
            setSelectedSection(section);
            return;
        }
        if (ctrlKey) {
            setSelectedIds(prev => {
                const next = new Set(prev);
                next.has(id) ? next.delete(id) : next.add(id);
                if (next.size === 0) setSelectedSection(null);
                return next;
            });
        } else {
            setSelectedIds(new Set([id]));
        }
    }, [selectedSection]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setSelectedSection(null);
        setMoveTargetFolder('__root__');
    }, []);

    // ESC で選択解除
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && selectedIds.size > 0) {
                clearSelection();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedIds.size, clearSelection]);

    // ── アクションバーのバルク操作 ──
    const handleBulkMove = useCallback(() => {
        const target = moveTargetFolder === '__root__' ? null : moveTargetFolder;
        selectedIds.forEach(id => onFavoriteAction.moveNode(id, target));
        clearSelection();
    }, [selectedIds, moveTargetFolder, onFavoriteAction, clearSelection]);

    const handleBulkRemove = useCallback(() => {
        selectedIds.forEach(id => onFavoriteAction.removeNode(id));
        clearSelection();
    }, [selectedIds, onFavoriteAction, clearSelection]);

    const handleBulkAddHistoryToFavorites = useCallback(() => {
        selectedIds.forEach(historyId => {
            const entry = history.find(e => e.historyId === historyId);
            if (entry) onAddToFavorites(entry);
        });
        clearSelection();
    }, [selectedIds, history, onAddToFavorites, clearSelection]);

    // ── ドラッグ（Active セクション内の並べ替え） ──
    const { draggingId, dragOverId, handleMouseDown: handleStreamMouseDown } =
        useDragReorder('streamId', onReorder);

    // ── 履歴ドラッグ（セクション内並べ替え + お気に入りへのクロスドロップ） ──
    const handleHistoryCrossDrop = useCallback((historyId: string, folderId: string) => {
        const entry = history.find(e => e.historyId === historyId);
        if (!entry) return;
        onAddToFavorites(entry, folderId === '__fav_root__' ? null : folderId);
    }, [history, onAddToFavorites]);

    const handleHistoryCrossDropToRoot = useCallback((historyId: string, _targetId: string) => {
        const entry = history.find(e => e.historyId === historyId);
        if (entry) onAddToFavorites(entry, null);
    }, [history, onAddToFavorites]);

    const crossDropTargets = useMemo(() => [
        { datasetKey: 'folderDrop', onDrop: handleHistoryCrossDrop },
        { datasetKey: 'favSectionDrop', onDrop: handleHistoryCrossDropToRoot },
    ], [handleHistoryCrossDrop, handleHistoryCrossDropToRoot]);

    const {
        draggingId: draggingHistoryId,
        dragOverId: dragOverHistoryId,
        crossDropTargetId: historyCrossDropId,
        handleMouseDown: handleHistoryMouseDown,
    } = useDragReorder('historyId', onReorderHistory, { crossDropTargets });

    // ── フィルタ ──
    const activeSourceIds = useMemo(() => {
        const ids = new Set<string>();
        streams.forEach(s => {
            ids.add(`${s.type}:${s.sourceId}`);
            if (s.channelHandle) ids.add(`${s.type}:${s.channelHandle}`);
        });
        return ids;
    }, [streams]);

    // 履歴: 追加済・お気に入り両方を除外
    const availableHistory = useMemo(
        () => history.filter(e => {
            const key = `${e.type}:${e.sourceId}`;
            return !activeSourceIds.has(key) && !favoriteChannelIds.has(key);
        }),
        [history, activeSourceIds, favoriteChannelIds],
    );

    // ── お気に入りチャンネル数 ──
    const favChannelCount = favoriteChannelIds.size;

    const label = (ja: string, en: string) => locale === 'ja' ? ja : en;

    // ── ルートフォルダ作成のトリガー ──
    const [creatingRootFolder, setCreatingRootFolder] = useState(false);
    const [rootFolderName, setRootFolderName] = useState('');

    // ── お気に入りセクションヘッダーがドロップターゲットか ──
    const isFavSectionDropTarget = historyCrossDropId === '__fav_root__' || historyCrossDropId === 'root';

    const renderStreamItem = (stream: Stream, isHidden: boolean) => {
        const isDragging = draggingId === stream.id;
        const isDragTarget = dragOverId === stream.id && draggingId !== stream.id;
        const cls = [
            'side-panel-item',
            isHidden ? 'is-hidden' : '',
            isDragging ? 'is-dragging-item' : '',
            isDragTarget ? 'is-drag-target' : '',
        ].filter(Boolean).join(' ');

        // お気に入り登録チェック（channelHandle も含む）
        const isFaved =
            favoriteChannelIds.has(`${stream.type}:${stream.sourceId}`) ||
            (stream.channelHandle ? favoriteChannelIds.has(`${stream.type}:${stream.channelHandle}`) : false);

        return (
            <div key={stream.id} className={cls} data-stream-id={stream.id}>
                <button
                    className="side-panel-drag-handle"
                    onMouseDown={(e) => handleStreamMouseDown(e, stream.id)}
                    title={label('ドラッグして並べ替え', 'Drag to reorder')}
                    aria-label={label('ドラッグして並べ替え', 'Drag to reorder')}
                >
                    <GripVertical size={12} />
                </button>
                <PlatformIcon type={stream.type} size={14} />
                <span className="side-panel-item-title" title={stream.title}>
                    {toDisplayName(stream)}
                </span>
                {/* お気に入り未登録時のみ★ボタンを表示 */}
                {!isFaved && onAddStreamToFavorites && (
                    <button
                        className="side-panel-toggle-btn"
                        onClick={() => onAddStreamToFavorites(stream)}
                        title={label('お気に入りに追加', 'Add to favorites')}
                        aria-label={label('お気に入りに追加', 'Add to favorites')}
                    >
                        <Star size={12} />
                    </button>
                )}
                <button
                    className="side-panel-toggle-btn"
                    onClick={() => onToggleHidden(stream.id)}
                    title={isHidden ? label('再表示', 'Show') : label('非表示', 'Hide')}
                    aria-label={isHidden ? label('再表示', 'Show') : label('非表示', 'Hide')}
                >
                    {isHidden ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                {!isHidden && (
                    <button
                        className="side-panel-toggle-btn danger"
                        onClick={() => onRemove(stream.id)}
                        title={label('閉じる', 'Close')}
                        aria-label={label('閉じる', 'Close')}
                    >
                        <X size={11} />
                    </button>
                )}
            </div>
        );
    };

    return (
        <>
            <div
                className={`side-panel-trigger${swapped ? ' right' : ''}`}
                onMouseEnter={show}
                onMouseLeave={scheduleHide}
            />
            <div
                className={`side-panel${visible ? ' visible' : ''}${swapped ? ' right' : ''}`}
                style={{ width: `${panelWidth}px` }}
                onMouseEnter={show}
                onMouseLeave={scheduleHide}
            >
                <div
                    className={`panel-resize-handle${swapped ? ' left' : ''}`}
                    onMouseDown={handleResizeMouseDown}
                />
                {/* ── ヘッダー ── */}
                <div className="side-panel-header">
                    <div className="side-panel-header-row">
                        <span className="side-panel-title">{label('配信管理', 'Streams')}</span>
                        <div className="side-panel-header-actions">
                            <button
                                className="side-panel-pin"
                                onClick={onRefreshOffline}
                                disabled={offlineChannelCount === 0}
                                title={offlineChannelCount > 0
                                    ? label(`オフライン枠を再確認 (${offlineChannelCount})`, `Re-check offline streams (${offlineChannelCount})`)
                                    : label('再確認できる枠がありません', 'Nothing to re-check')}
                                aria-label={label('オフライン枠を再確認', 'Re-check offline streams')}
                            >
                                <RefreshCw size={13} />
                            </button>
                            <button
                                className={`side-panel-pin${isPinned ? ' active' : ''}`}
                                onClick={() => onPinChange?.(!isPinned)}
                                title={isPinned ? label('ピン解除', 'Unpin') : label('ピン留め', 'Pin')}
                                aria-label={isPinned ? label('ピン解除', 'Unpin') : label('ピン留め', 'Pin')}
                            >
                                {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                            </button>
                        </div>
                    </div>
                    {/* 追加ボタン（中央配置） */}
                    <button
                        className="side-panel-add-btn side-panel-add-btn--center"
                        onClick={onOpenAddModal}
                        title={label('配信を追加', 'Add stream')}
                        aria-label={label('配信を追加', 'Add stream')}
                    >
                        <Plus size={13} />
                        <span>{label('追加', 'Add')}</span>
                    </button>
                    <span className="side-panel-count">
                        {(() => {
                            const hiddenCount = streams.filter(s => s.hidden).length;
                            return label(
                                `${streams.length}件${hiddenCount > 0 ? `（うち${hiddenCount}非表示）` : ''}`,
                                `${streams.length} stream${streams.length !== 1 ? 's' : ''}${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}`,
                            );
                        })()}
                    </span>
                </div>

                <div className="side-panel-list">
                    {/* ── 追加済セクション（常時展開） ── */}
                    {streams.length > 0 && (
                        <div className="side-panel-section-label">{label('追加済', 'Active')}</div>
                    )}
                    {streams.map(stream => renderStreamItem(stream, !!stream.hidden))}

                    {streams.length === 0 && (
                        <div className="side-panel-empty">{label('配信なし', 'No streams')}</div>
                    )}

                    {/* ── お気に入りセクション（折りたたみ可） ── */}
                    <div
                        className={`section-header${sections.favorites ? ' collapsed' : ''}${isFavSectionDropTarget ? ' is-drop-target' : ''}`}
                        onClick={() => toggleSection('favorites')}
                        data-fav-section-drop="root"
                    >
                        <ChevronRight size={12} className="section-chevron" />
                        <Star size={11} className="section-icon" />
                        <span className="section-header-text">
                            {label('お気に入り', 'Favorites')}
                            {favChannelCount > 0 && ` (${favChannelCount})`}
                        </span>
                        <button
                            className="section-header-action"
                            onClick={(e) => {
                                e.stopPropagation();
                                setCreatingRootFolder(true);
                                if (sections.favorites) toggleSection('favorites');
                            }}
                            title={label('フォルダを追加', 'Add folder')}
                            aria-label={label('フォルダを追加', 'Add folder')}
                        >
                            <FolderPlus size={12} />
                        </button>
                    </div>
                    {!sections.favorites && (
                        <div className="section-content">
                            {creatingRootFolder && (
                                <div className="fav-new-folder-row" style={{ paddingLeft: '8px' }}>
                                    <FolderPlus size={13} className="fav-folder-icon" />
                                    <input
                                        className="fav-folder-name-input"
                                        value={rootFolderName}
                                        onChange={e => setRootFolderName(e.target.value)}
                                        onBlur={() => {
                                            const name = rootFolderName.trim();
                                            if (name) onFavoriteAction.createFolder(name, null);
                                            setCreatingRootFolder(false);
                                            setRootFolderName('');
                                        }}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                const name = rootFolderName.trim();
                                                if (name) onFavoriteAction.createFolder(name, null);
                                                setCreatingRootFolder(false);
                                                setRootFolderName('');
                                            }
                                            if (e.key === 'Escape') {
                                                setCreatingRootFolder(false);
                                                setRootFolderName('');
                                            }
                                        }}
                                        placeholder={label('フォルダ名', 'Folder name')}
                                        autoFocus
                                    />
                                </div>
                            )}
                            <FavoritesTree
                                nodes={favorites}
                                activeSourceIds={activeSourceIds}
                                actions={onFavoriteAction}
                                onAddFromFavorite={onAddFromFavorite}
                                locale={locale}
                                selectedIds={selectedSection === 'favorites' ? selectedIds : new Set<string>()}
                                onSelect={(id, ctrlKey) => handleSelect(id, ctrlKey, 'favorites')}
                                onBulkAddFromFolder={onBulkAddFromFolder}
                                externalDragOverFolderId={historyCrossDropId}
                            />
                            {favorites.length === 0 && !creatingRootFolder && (
                                <div className="side-panel-empty" style={{ fontSize: '0.68rem' }}>
                                    {label(
                                        '履歴からドラッグしてチャンネルを追加',
                                        'Drag channels from history to add',
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── 履歴セクション（折りたたみ可） ── */}
                    {(availableHistory.length > 0 || history.length > 0) && (
                        <div
                            className={`section-header${sections.history ? ' collapsed' : ''}`}
                            onClick={() => toggleSection('history')}
                        >
                            <ChevronRight size={12} className="section-chevron" />
                            <Clock size={11} className="section-icon" />
                            <span className="section-header-text">
                                {label('履歴', 'History')}
                                {availableHistory.length > 0 && ` (${availableHistory.length})`}
                            </span>
                        </div>
                    )}
                    {!sections.history && availableHistory.map(entry => {
                        const isHistDragging = draggingHistoryId === entry.historyId;
                        const isHistTarget = dragOverHistoryId === entry.historyId && draggingHistoryId !== entry.historyId;
                        const isSelected = selectedSection === 'history' && selectedIds.has(entry.historyId);
                        const histCls = [
                            'side-panel-item is-history',
                            isHistDragging ? 'is-dragging-item' : '',
                            isHistTarget ? 'is-drag-target' : '',
                            isSelected ? 'is-selected' : '',
                        ].filter(Boolean).join(' ');
                        return (
                            <div key={entry.historyId} className={histCls} data-history-id={entry.historyId}>
                                <button
                                    className="side-panel-drag-handle"
                                    onMouseDown={(e) => handleHistoryMouseDown(e, entry.historyId)}
                                    title={label('ドラッグして並べ替え（お気に入りフォルダにドロップ可）', 'Drag to reorder or drop onto favorites folder')}
                                    aria-label={label('ドラッグして並べ替え', 'Drag to reorder')}
                                >
                                    <GripVertical size={12} />
                                </button>
                                <PlatformIcon type={entry.type} size={14} />
                                <span
                                    className="side-panel-item-title"
                                    title={entry.title}
                                    onClick={(e) => handleSelect(entry.historyId, e.ctrlKey || e.metaKey, 'history')}
                                >
                                    {toDisplayName(entry)}
                                </span>
                                <button
                                    className="side-panel-toggle-btn"
                                    onClick={() => onAddToFavorites(entry)}
                                    title={label('お気に入りに追加', 'Add to favorites')}
                                    aria-label={label('お気に入りに追加', 'Add to favorites')}
                                >
                                    <Star size={12} />
                                </button>
                                <button
                                    className="side-panel-toggle-btn"
                                    onClick={() => onAddFromHistory(entry)}
                                    title={label('追加', 'Add')}
                                    aria-label={label('追加', 'Add')}
                                >
                                    <Plus size={13} />
                                </button>
                                <button
                                    className="side-panel-toggle-btn danger"
                                    onClick={() => onRemoveFromHistory(entry.historyId)}
                                    title={label('履歴から削除', 'Remove from history')}
                                    aria-label={label('履歴から削除', 'Remove from history')}
                                >
                                    <X size={11} />
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* ── コンテキストアクションバー（選択時のみ表示） ── */}
                {selectedIds.size > 0 && (
                    <div className="context-action-bar">
                        <span className="context-action-count">
                            {label(`${selectedIds.size}件選択`, `${selectedIds.size} selected`)}
                        </span>
                        {selectedSection === 'favorites' && (
                            <>
                                <select
                                    className="context-action-select"
                                    value={moveTargetFolder}
                                    onChange={e => setMoveTargetFolder(e.target.value)}
                                    aria-label={label('移動先フォルダ', 'Target folder')}
                                >
                                    <option value="__root__">{label('ルート', 'Root')}</option>
                                    {(getFavFolders?.() ?? []).map(f => (
                                        <option key={f.id} value={f.id}>
                                            {'  '.repeat(f.depth)}{f.name}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    className="context-action-btn"
                                    onClick={handleBulkMove}
                                    disabled={selectedIds.size === 0}
                                    title={label('移動', 'Move')}
                                >
                                    <ArrowRight size={11} />
                                    <span>{label('移動', 'Move')}</span>
                                </button>
                                <button
                                    className="context-action-btn danger"
                                    onClick={handleBulkRemove}
                                    title={label('削除', 'Remove')}
                                >
                                    <Trash2 size={11} />
                                </button>
                            </>
                        )}
                        {selectedSection === 'history' && (
                            <button
                                className="context-action-btn"
                                onClick={handleBulkAddHistoryToFavorites}
                                title={label('お気に入りに追加', 'Add to favorites')}
                            >
                                <Star size={11} />
                                <span>{label('お気に入りに追加', 'Favorites')}</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </>
    );
};

export default StreamSidePanel;
