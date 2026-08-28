import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronRight, Folder, FolderPlus, GripVertical, Plus, X, Check, CornerLeftUp } from 'lucide-react';
import type { FavoriteNode } from '../types';
import { toDisplayName } from '../types';
import type { FavoriteActions } from '../hooks/useFavorites';
import type { Locale } from '../i18n';
import { PlatformIcon } from './PlatformIcon';
import { canMoveInto, findParentId } from '../utils/favoriteTree';

/**
 * ドロップ先。行の「どこ」に落としたかで意味が変わる。
 *
 * - フォルダ行: 上端25% = 前に挿入 / 中央50% = フォルダの中へ / 下端25% = 後ろに挿入
 * - チャンネル行: 上半分 = 前に挿入 / 下半分 = 後ろに挿入
 *
 * 「前後に挿入」を用意しているのは、**ルート直下の項目の前後に落とすだけで
 * 階層を上げられる**ようにするため。これが無いと子要素をルートへ戻せない。
 */
type DropTarget =
    | { kind: 'into'; folderId: string }
    | { kind: 'relative'; targetId: string; position: 'before' | 'after' }
    | { kind: 'root' };

/** ドラッグ中の見た目を各階層へ配るための状態 */
interface DragState {
    draggingId: string | null;
    target: DropTarget | null;
    onHandleMouseDown: (e: React.MouseEvent, id: string) => void;
}

interface CommonProps {
    activeSourceIds: Set<string>;
    actions: FavoriteActions;
    onAddFromFavorite: (node: { type: 'youtube' | 'twitch'; title: string; sourceId: string; inputType: 'channel' | 'video' | 'url'; displayName?: string }) => void;
    locale: Locale;
    selectedIds: Set<string>;
    onSelect: (id: string, ctrlKey: boolean) => void;
    onBulkAddFromFolder: (folderId: string) => void;
    externalDragOverFolderId?: string | null;
}

interface FavoritesTreeProps extends CommonProps {
    nodes: FavoriteNode[];
}

// ── ヒットテスト ──────────────────────────────────────────────────────────────

/** カーソル位置から、その下にある行と「行内のどこか」を求める */
function hitTest(x: number, y: number): { rowId: string; isFolder: boolean; ratio: number } | { root: true } | null {
    let el: Element | null = document.elementFromPoint(x, y);
    while (el) {
        const ds = (el as HTMLElement).dataset;
        if (ds?.favRow) {
            const rect = el.getBoundingClientRect();
            const ratio = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
            return { rowId: ds.favRow, isFolder: ds.favFolder === '1', ratio };
        }
        if (ds?.favRootDrop) return { root: true };
        el = el.parentElement;
    }
    return null;
}

function resolveTarget(hit: ReturnType<typeof hitTest>): DropTarget | null {
    if (!hit) return null;
    if ('root' in hit) return { kind: 'root' };
    const { rowId, isFolder, ratio } = hit;
    if (isFolder) {
        if (ratio < 0.25) return { kind: 'relative', targetId: rowId, position: 'before' };
        if (ratio > 0.75) return { kind: 'relative', targetId: rowId, position: 'after' };
        return { kind: 'into', folderId: rowId };
    }
    return { kind: 'relative', targetId: rowId, position: ratio < 0.5 ? 'before' : 'after' };
}

/**
 * そこへ落としてよいか。**ハイライトの判定と実際の移動で同じ関数を使う。**
 * ずれると「光ったのに動かない」という一番わかりにくい挙動になる。
 */
function isAllowed(tree: FavoriteNode[], draggingId: string, target: DropTarget): boolean {
    switch (target.kind) {
        case 'into':
            return canMoveInto(tree, draggingId, target.folderId);
        case 'root':
            return canMoveInto(tree, draggingId, null);
        case 'relative': {
            if (target.targetId === draggingId) return false;
            const parentId = findParentId(tree, target.targetId);
            if (parentId === undefined) return false;
            return canMoveInto(tree, draggingId, parentId);
        }
    }
}

// ── ルート（ドラッグ状態を持つ） ──────────────────────────────────────────────

const FavoritesTree: React.FC<FavoritesTreeProps> = ({ nodes, ...common }) => {
    const { actions, locale } = common;
    const label = (ja: string, en: string) => locale === 'ja' ? ja : en;

    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [target, setTarget] = useState<DropTarget | null>(null);

    // stale closure 防止: mouseup 内で読む値は ref で持つ
    const draggingIdRef = useRef<string | null>(null);
    const targetRef = useRef<DropTarget | null>(null);
    // ドラッグ中に nodes が変わっても最新を参照できるようにする。
    // 描画中に ref を書くと React に怒られるので effect で同期する
    const treeRef = useRef(nodes);
    useEffect(() => { treeRef.current = nodes; }, [nodes]);

    const onHandleMouseDown = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        let isDragActive = false;

        const onMouseMove = (me: MouseEvent) => {
            if (!isDragActive) {
                if (Math.hypot(me.clientX - startX, me.clientY - startY) < 5) return;
                isDragActive = true;
                draggingIdRef.current = id;
                setDraggingId(id);
            }

            const next = resolveTarget(hitTest(me.clientX, me.clientY));
            const allowed = next && isAllowed(treeRef.current, id, next) ? next : null;
            targetRef.current = allowed;
            setTarget(allowed);
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            const fromId = draggingIdRef.current;
            const t = targetRef.current;
            if (fromId && t) {
                if (t.kind === 'into') actions.moveNode(fromId, t.folderId);
                else if (t.kind === 'root') actions.moveNode(fromId, null);
                else actions.moveRelative(fromId, t.targetId, t.position);
            }

            draggingIdRef.current = null;
            targetRef.current = null;
            setDraggingId(null);
            setTarget(null);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [actions]);

    const drag: DragState = { draggingId, target, onHandleMouseDown };

    return (
        <>
            <TreeLevel nodes={nodes} depth={0} drag={drag} {...common} />

            {/* ルートへ戻すための明示的なドロップ先。ドラッグ中だけ出す（設計思想1）。
                行の前後に落としても同じことはできるが、それだけでは操作が発見されない */}
            {draggingId && (
                <div
                    className={`fav-root-drop${target?.kind === 'root' ? ' active' : ''}`}
                    data-fav-root-drop="1"
                >
                    <CornerLeftUp size={12} />
                    <span>{label('ここへドロップで一番上の階層へ', 'Drop here to move to top level')}</span>
                </div>
            )}
        </>
    );
};

// ── 各階層 ───────────────────────────────────────────────────────────────────

interface TreeLevelProps extends CommonProps {
    nodes: FavoriteNode[];
    depth: number;
    drag: DragState;
}

const TreeLevel: React.FC<TreeLevelProps> = ({
    nodes, depth, drag, activeSourceIds, actions, onAddFromFavorite, locale,
    selectedIds, onSelect, onBulkAddFromFolder, externalDragOverFolderId,
}) => {
    const label = (ja: string, en: string) => locale === 'ja' ? ja : en;

    // ── フォルダ名入力 ──
    const [creatingInFolderId, setCreatingInFolderId] = useState<string | null>(null);
    const [newFolderName, setNewFolderName] = useState('');
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    const handleCreateFolder = (parentId: string | null) => {
        setCreatingInFolderId(parentId);
        setNewFolderName('');
    };

    const submitCreateFolder = () => {
        const name = newFolderName.trim();
        if (name) actions.createFolder(name, creatingInFolderId);
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

    /** その行に付ける挿入線のクラス */
    const insertClass = (id: string): string => {
        const t = drag.target;
        if (!t || t.kind !== 'relative' || t.targetId !== id) return '';
        return t.position === 'before' ? ' drop-before' : ' drop-after';
    };

    const commonProps: CommonProps = {
        activeSourceIds, actions, onAddFromFavorite, locale,
        selectedIds, onSelect, onBulkAddFromFolder, externalDragOverFolderId,
    };

    return (
        <div className="fav-tree" style={{ '--depth': depth } as React.CSSProperties}>
            {nodes.map(node => {
                if (node.kind === 'folder') {
                    const isDragging = drag.draggingId === node.id;
                    const isInto = drag.target?.kind === 'into' && drag.target.folderId === node.id;
                    const isExternalDropTarget = externalDragOverFolderId === node.id;

                    return (
                        <div key={node.id} className={`fav-folder${isDragging ? ' is-dragging-item' : ''}`}>
                            <div
                                className={[
                                    'fav-folder-header',
                                    isInto ? 'is-folder-drop-target' : '',
                                    isExternalDropTarget ? 'is-cross-drop-target' : '',
                                ].filter(Boolean).join(' ') + insertClass(node.id)}
                                data-fav-row={node.id}
                                data-fav-folder="1"
                                data-folder-drop={node.id}
                                style={{ paddingLeft: `${8 + depth * 16}px` }}
                            >
                                <button
                                    className="side-panel-drag-handle"
                                    onMouseDown={e => drag.onHandleMouseDown(e, node.id)}
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
                                    <TreeLevel
                                        nodes={node.children}
                                        depth={depth + 1}
                                        drag={drag}
                                        {...commonProps}
                                    />
                                </div>
                            )}
                        </div>
                    );
                }

                // ── チャンネルノード ──
                const isActive = activeSourceIds.has(`${node.type}:${node.sourceId}`);
                const isDragging = drag.draggingId === node.id;
                const isSelected = selectedIds.has(node.id);
                const chCls = [
                    'fav-channel-item',
                    isActive ? 'is-active' : '',
                    isDragging ? 'is-dragging-item' : '',
                    isSelected ? 'is-selected' : '',
                ].filter(Boolean).join(' ') + insertClass(node.id);

                return (
                    <div
                        key={node.id}
                        className={chCls}
                        data-fav-row={node.id}
                        style={{ paddingLeft: `${8 + depth * 16}px` }}
                    >
                        <button
                            className="side-panel-drag-handle"
                            onMouseDown={e => drag.onHandleMouseDown(e, node.id)}
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
