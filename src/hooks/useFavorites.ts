import { useState, useCallback, useMemo } from 'react';
import type { FavoriteNode, FavoriteFolder, FavoriteChannel } from '../types';
import {
    findAndRemove,
    insertInto,
    updateNode,
    reorderInTree,
    moveNodeInTree,
    createFolderInTree,
    applyDisplayName,
    collectChannelIds,
    collectFolders,
} from '../utils/favoriteTree';
import type { FolderInfo } from '../utils/favoriteTree';

export type { FolderInfo } from '../utils/favoriteTree';
export { collectChannelsFromFolder } from '../utils/favoriteTree';

const STORAGE_KEY = 'favorites';

// ── localStorage 永続化 ──

function load(): FavoriteNode[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function save(tree: FavoriteNode[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    } catch { /* ignore */ }
}

// ── お気に入りコールバック型 ──

export interface FavoriteActions {
    addChannel: (ch: Omit<FavoriteChannel, 'id' | 'kind'>, parentFolderId?: string | null) => void;
    removeNode: (nodeId: string) => void;
    createFolder: (name: string, parentFolderId?: string | null) => void;
    renameFolder: (folderId: string, newName: string) => void;
    moveNode: (nodeId: string, targetFolderId: string | null) => void;
    toggleCollapse: (folderId: string) => void;
    reorderInParent: (fromId: string, toId: string) => void;
    setDisplayName: (type: 'youtube' | 'twitch', sourceId: string, displayName: string) => void;
}

// ── フック本体 ──
// ツリー操作そのものは utils/favoriteTree.ts の純粋関数に置いてある（テスト対象）。
// ここは state と localStorage への橋渡しだけを担う。

export function useFavorites() {
    const [tree, setTree] = useState<FavoriteNode[]>(load);

    const persist = useCallback((updater: (prev: FavoriteNode[]) => FavoriteNode[]) => {
        setTree(prev => {
            const next = updater(prev);
            save(next);
            return next;
        });
    }, []);

    const addChannel = useCallback((
        ch: Omit<FavoriteChannel, 'id' | 'kind'>,
        parentFolderId?: string | null,
    ) => {
        const node: FavoriteChannel = { ...ch, id: crypto.randomUUID(), kind: 'channel' };
        persist(prev => insertInto(prev, parentFolderId ?? null, node));
    }, [persist]);

    const removeNode = useCallback((nodeId: string) => {
        persist(prev => findAndRemove(prev, nodeId)[0]);
    }, [persist]);

    const createFolder = useCallback((name: string, parentFolderId?: string | null) => {
        const folder: FavoriteFolder = {
            id: crypto.randomUUID(),
            kind: 'folder',
            name,
            collapsed: false,
            children: [],
        };
        persist(prev => createFolderInTree(prev, folder, parentFolderId ?? null));
    }, [persist]);

    const renameFolder = useCallback((folderId: string, newName: string) => {
        persist(prev => updateNode(prev, folderId, n =>
            n.kind === 'folder' ? { ...n, name: newName } : n,
        ));
    }, [persist]);

    const moveNode = useCallback((nodeId: string, targetFolderId: string | null) => {
        persist(prev => moveNodeInTree(prev, nodeId, targetFolderId));
    }, [persist]);

    const toggleCollapse = useCallback((folderId: string) => {
        persist(prev => updateNode(prev, folderId, n =>
            n.kind === 'folder' ? { ...n, collapsed: !n.collapsed } : n,
        ));
    }, [persist]);

    const reorderInParent = useCallback((fromId: string, toId: string) => {
        persist(prev => reorderInTree(prev, fromId, toId));
    }, [persist]);

    /** 表示名が後から判明したときにお気に入り側へも反映する */
    const setDisplayName = useCallback((
        type: 'youtube' | 'twitch',
        sourceId: string,
        displayName: string,
    ) => {
        persist(prev => applyDisplayName(prev, type, sourceId, displayName).tree);
    }, [persist]);

    const allChannelIds = useMemo(() => {
        const ids = new Set<string>();
        collectChannelIds(tree, ids);
        return ids;
    }, [tree]);

    const getAllFolders = useCallback((): FolderInfo[] => {
        const out: FolderInfo[] = [];
        collectFolders(tree, out);
        return out;
    }, [tree]);

    /** インポート: ツリーを丸ごと置換（ID再生成で衝突防止） */
    const importTree = useCallback((nodes: FavoriteNode[]) => {
        const regen = (ns: FavoriteNode[]): FavoriteNode[] => ns.map(n =>
            n.kind === 'folder'
                ? { ...n, id: crypto.randomUUID(), children: regen(n.children) }
                : { ...n, id: crypto.randomUUID() }
        );
        const next = regen(nodes);
        save(next);
        setTree(next);
    }, []);

    const actions: FavoriteActions = useMemo(() => ({
        addChannel, removeNode, createFolder, renameFolder,
        moveNode, toggleCollapse, reorderInParent, setDisplayName,
    }), [addChannel, removeNode, createFolder, renameFolder, moveNode, toggleCollapse, reorderInParent, setDisplayName]);

    return { tree, allChannelIds, getAllFolders, actions, importTree };
}
