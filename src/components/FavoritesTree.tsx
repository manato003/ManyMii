import React, { useState, useRef, useCallback } from 'react';
import { ChevronRight, Folder, FolderPlus, GripVertical, Plus, X, Check } from 'lucide-react';
import type { FavoriteNode } from '../types';
import { toDisplayName } from '../types';
import type { FavoriteActions } from '../hooks/useFavorites';
import type { Locale } from '../i18n';
import { PlatformIcon } from './PlatformIcon';

interface FavoritesTreeProps {
    nodes: FavoriteNode[];
    depth?: number;
    activeSourceIds: Set<string>;
    actions: FavoriteActions;
    onAddFromFavorite: (node: { type: 'youtube' | 'twitch'; title: string; sourceId: string; inputType: 'channel' | 'video' | 'url'; displayName?: string }) => void;
    locale: Locale;
    // Explorer 風選択
    selectedIds: Set<string>;
    onSelect: (id: string, ctrlKey: boolean) => void;
    onBulkAddFromFolder: (folderId: string) => void;
    externalDragOverFolderId?: string | null;
}



const FavoritesTree: React.FC<FavoritesTreeProps> = ({
    nodes, depth = 0, activeSourceIds, actions, onAddFromFavorite, locale,
    selectedIds, onSelect, onBulkAddFromFolder, externalDragOverFolderId,
}) => {
    const label = (ja: string, en: string) => locale === 'ja' ? ja : en;

    // ── ドラッグ状態（ツリー内部の並べ替え・フォルダ移動用） ──
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
    const draggingIdRef = useRef<string | null>(null);
    // stale closure 防止: onMouseUp内で読む値はrefで管理する
    const dragOverIdRef = useRef<string | null>(null);
    const dragOverFolderIdRef = useRef<string | null>(null);

    // ── フォルダ名入力 ──
    const [creatingInFolderId, setCreatingInFolderId] = useState<string | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        let isDragActive = false;

        const onMouseMove = (me: MouseEvent) => {
            if (!isDragActive) {
                const d = Math.hypot(me.clientX - startX, me.clientY - startY);
                if (d < 5) return;
                isDragActive = true;
                draggingIdRef.current = id;
                setDraggingId(id);
            }

            const el = document.elementFromPoint(me.clientX, me.clientY);
            let target: Element | null = el;
            let favId: string | null = null;
            let folderId: string | null = null;

            while (target) {
                const ds = (target as HTMLElement).dataset;
                if (!favId && ds?.favId) favId = ds.favId;
                if (!folderId && ds?.folderDrop) folderId = ds.folderDrop;
                target = target.parentElement;
            }

            // refも同期更新（onMouseUpのstale closure防止）
            dragOverIdRef.current = favId;
            dragOverFolderIdRef.current = folderId;
            setDragOverId(favId);
            setDragOverFolderId(folderId);
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            const fromId = draggingIdRef.current;

            // stale closure防止: state変数ではなくrefから読む
            if (fromId && dragOverFolderIdRef.current && fromId !== dragOverFolderIdRef.current) {
                actions.moveNode(fromId, dragOverFolderIdRef.current);
            } else if (fromId && dragOverIdRef.current && fromId !== dragOverIdRef.current) {
                actions.reorderInParent(fromId, dragOverIdRef.current);
            }

            draggingIdRef.current = null;
            dragOverIdRef.current = null;
            dragOverFolderIdRef.current = null;
            setDraggingId(null);
            setDragOverId(null);
            setDragOverFolderId(null);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [actions]); // dragOverId/dragOverFolderIdはrefで管理するため依存から除外

    const handleCreateFolder = (parentId: string | null) => {
        setCreatingInFolderId(parentId);
        setNewFolderName('');
    };

    const submitCreateFolder = () => {
        const name = newFolderName.trim();
        if (name) {
            actions.createFolder(name, creatingInFolderId);
        }
        setCreatingInFolderId(null);
        setNewFolderName('');
    };

    const startRename = (folderId: string, currentName: string) => {
        setRenamingFolderId(folderId);
        setRenameValue(currentName);
    };

    const submitRename = () => {
        if (renamingFolderId && renameValue.trim()) {
            actions.renameFolder(renamingFolderId, renameValue.trim());
        }
        setRenamingFolderId(null);
        setRenameValue('');
    };

    return (
        <div className="fav-tree" style={{ '--depth': depth } as React.CSSProperties}>
            {nodes.map(node => {
                if (node.kind === 'folder') {
                    const isDragging = draggingId === node.id;
                    const isInternalDropTarget = dragOverFolderId === node.id && draggingId !== node.id;
                    const isExternalDropTarget = externalDragOverFolderId === node.id;
                    const folderCls = [
                        'fav-folder',
                        isDragging ? 'is-dragging-item' : '',
                        isInternalDropTarget ? 'is-folder-drop-target' : '',
                        isExternalDropTarget ? 'is-cross-drop-target' : '',
                    ].filter(Boolean).join(' ');

                    return (
                        <div key={node.id} className={folderCls} data-fav-id={node.id}>
                            <div
                                className="fav-folder-header"
                                data-folder-drop={node.id}
                                style={{ paddingLeft: `${8 + depth * 16}px` }}
                            >
                                <button
                                    className="side-panel-drag-handle"
                                    onMouseDown={e => handleDragStart(e, node.id)}
                                    title={label('ドラッグして移動', 'Drag to move')}
                                    aria-label={label('ドラッグして移動', 'Drag to move')}
                                >
                                    <GripVertical size={12} />
                                </button>
                                <button
                                    className="fav-folder-toggle"
                                    onClick={() => actions.toggleCollapse(node.id)}
                                    aria-label={node.collapsed ? label('展開', 'Expand') : label('折りたたむ', 'Collapse')}
                                >
                                    <ChevronRight
                                        size={12}
                                        className={`fav-chevron${node.collapsed ? '' : ' expanded'}`}
                                    />
                                </button>
                                <Folder size={13} className="fav-folder-icon" />
                                {renamingFolderId === node.id ? (
                                    <input
                                        className="fav-folder-name-input"
                                        value={renameValue}
                                        onChange={e => setRenameValue(e.target.value)}
                                        onBlur={submitRename}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') submitRename();
                                            if (e.key === 'Escape') setRenamingFolderId(null);
                                        }}
                                        autoFocus
                                    />
                                ) : (
                                    <span
                                        className="fav-folder-name"
                                        onDoubleClick={() => startRename(node.id, node.name)}
                                        title={label('ダブルクリックで名前変更', 'Double-click to rename')}
                                    >
                                        {node.name}
                                    </span>
                                )}
                                {/* フォルダ内全チャンネルを一括追加 */}
                                <button
                                    className="fav-folder-bulk-add"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onBulkAddFromFolder(node.id);
                                    }}
                                    title={label('フォルダ内の全チャンネルを追加', 'Add all channels in folder')}
                                    aria-label={label('フォルダ内の全チャンネルを追加', 'Add all channels in folder')}
                                >
                                    <Plus size={11} />
                                </button>
                                {depth < 1 && (
                                    <button
                                        className="side-panel-toggle-btn"
                                        onClick={() => handleCreateFolder(node.id)}
                                        title={label('サブフォルダを追加', 'Add subfolder')}
                                        aria-label={label('サブフォルダを追加', 'Add subfolder')}
                                    >
                                        <FolderPlus size={11} />
                                    </button>
                                )}
                                <button
                                    className="side-panel-toggle-btn danger"
                                    onClick={() => actions.removeNode(node.id)}
                                    title={label('フォルダを削除', 'Delete folder')}
                                    aria-label={label('フォルダを削除', 'Delete folder')}
                                >
                                    <X size={11} />
                                </button>
                            </div>
                            {!node.collapsed && (
                                <div className="fav-folder-children">
                                    {creatingInFolderId === node.id && (
                                        <div className="fav-new-folder-row" style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}>
                                            <Folder size={13} className="fav-folder-icon" />
                                            <input
                                                className="fav-folder-name-input"
                                                value={newFolderName}
                                                onChange={e => setNewFolderName(e.target.value)}
                                                onBlur={submitCreateFolder}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') submitCreateFolder();
                                                    if (e.key === 'Escape') setCreatingInFolderId(null);
                                                }}
                                                placeholder={label('フォルダ名', 'Folder name')}
                                                autoFocus
                                            />
                                        </div>
                                    )}
                                    <FavoritesTree
                                        nodes={node.children}
                                        depth={depth + 1}
                                        activeSourceIds={activeSourceIds}
                                        actions={actions}
                                        onAddFromFavorite={onAddFromFavorite}
                                        locale={locale}
                                        selectedIds={selectedIds}
                                        onSelect={onSelect}
                                        onBulkAddFromFolder={onBulkAddFromFolder}
                                        externalDragOverFolderId={externalDragOverFolderId}
                                    />
                                </div>
                            )}
                        </div>
                    );
                }

                // ── チャンネルノード ──
                const isActive = activeSourceIds.has(`${node.type}:${node.sourceId}`);
                const isDragging = draggingId === node.id;
                const isDragTarget = dragOverId === node.id && draggingId !== node.id;
                const isSelected = selectedIds.has(node.id);
                const chCls = [
                    'fav-channel-item',
                    isActive ? 'is-active' : '',
                    isDragging ? 'is-dragging-item' : '',
                    isDragTarget ? 'is-drag-target' : '',
                    isSelected ? 'is-selected' : '',
                ].filter(Boolean).join(' ');

                return (
                    <div
                        key={node.id}
                        className={chCls}
                        data-fav-id={node.id}
                        style={{ paddingLeft: `${8 + depth * 16}px` }}
                    >
                        <button
                            className="side-panel-drag-handle"
                            onMouseDown={e => handleDragStart(e, node.id)}
                            title={label('ドラッグして移動', 'Drag to move')}
                            aria-label={label('ドラッグして移動', 'Drag to move')}
                        >
                            <GripVertical size={12} />
                        </button>
                        <PlatformIcon type={node.type} size={14} />
                        <span
                            className="fav-channel-title"
                            title={node.title}
                            onClick={(e) => onSelect(node.id, e.ctrlKey || e.metaKey)}
                        >
                            {toDisplayName(node)}
                        </span>
                        {isActive ? (
                            <span className="fav-active-check" title={label('追加済', 'Already added')}>
                                <Check size={13} />
                            </span>
                        ) : (
                            <button
                                className="side-panel-toggle-btn"
                                onClick={() => onAddFromFavorite({
                                    type: node.type,
                                    title: node.title,
                                    sourceId: node.sourceId,
                                    inputType: node.inputType,
                                    displayName: node.displayName,
                                })}
                                title={label('配信を追加', 'Add stream')}
                                aria-label={label('配信を追加', 'Add stream')}
                            >
                                <Plus size={13} />
                            </button>
                        )}
                        <button
                            className="side-panel-toggle-btn danger"
                            onClick={() => actions.removeNode(node.id)}
                            title={label('お気に入りから削除', 'Remove from favorites')}
                            aria-label={label('お気に入りから削除', 'Remove from favorites')}
                        >
                            <X size={11} />
                        </button>
                    </div>
                );
            })}

            {/* ルートレベルの新規フォルダ入力 */}
            {creatingInFolderId === '__root__' && depth === 0 && (
                <div className="fav-new-folder-row" style={{ paddingLeft: `${8 + depth * 16}px` }}>
                    <Folder size={13} className="fav-folder-icon" />
                    <input
                        className="fav-folder-name-input"
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                        onBlur={() => {
                            const name = newFolderName.trim();
                            if (name) actions.createFolder(name, null);
                            setCreatingInFolderId(null);
                            setNewFolderName('');
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                const name = newFolderName.trim();
                                if (name) actions.createFolder(name, null);
                                setCreatingInFolderId(null);
                                setNewFolderName('');
                            }
                            if (e.key === 'Escape') {
                                setCreatingInFolderId(null);
                                setNewFolderName('');
                            }
                        }}
                        placeholder={label('フォルダ名', 'Folder name')}
                        autoFocus
                    />
                </div>
            )}
        </div>
    );
};

export default FavoritesTree;

/** ルートレベルのフォルダ作成をトリガーするための sentinel ID */
export const ROOT_FOLDER_SENTINEL = '__root__';
