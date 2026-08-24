/**
 * お気に入りツリーの純粋な操作。
 * React に依存しないので単体でテストできる（useFavorites はこれを呼ぶだけ）。
 */

import type { FavoriteNode, FavoriteChannel, FavoriteFolder } from '../types';

/** ルート(0) + 1階層(1) まで */
export const MAX_DEPTH = 2;


/** ノードを ID で検索して削除。削除されたノードも返す */
export function findAndRemove(tree: FavoriteNode[], id: string): [FavoriteNode[], FavoriteNode | null] {
    let removed: FavoriteNode | null = null;
    const result: FavoriteNode[] = [];
    for (const node of tree) {
        if (node.id === id) {
            removed = node;
            continue;
        }
        if (node.kind === 'folder') {
            const [children, found] = findAndRemove(node.children, id);
            if (found) removed = found;
            result.push({ ...node, children });
        } else {
            result.push(node);
        }
    }
    return [result, removed];
}

/** 指定フォルダの children に末尾追加。parentId が null ならルート末尾 */
export function insertInto(tree: FavoriteNode[], parentId: string | null, node: FavoriteNode): FavoriteNode[] {
    if (parentId === null) return [...tree, node];
    return tree.map(n => {
        if (n.kind === 'folder' && n.id === parentId) {
            return { ...n, children: [...n.children, node] };
        }
        if (n.kind === 'folder') {
            return { ...n, children: insertInto(n.children, parentId, node) };
        }
        return n;
    });
}

/** 指定 ID のノードを更新 */
export function updateNode(tree: FavoriteNode[], id: string, updater: (n: FavoriteNode) => FavoriteNode): FavoriteNode[] {
    return tree.map(n => {
        if (n.id === id) return updater(n);
        if (n.kind === 'folder') {
            return { ...n, children: updateNode(n.children, id, updater) };
        }
        return n;
    });
}

/** 指定 ID のフォルダがツリー内に存在するか */
export function hasFolder(tree: FavoriteNode[], id: string): boolean {
    for (const node of tree) {
        if (node.kind !== 'folder') continue;
        if (node.id === id) return true;
        if (hasFolder(node.children, id)) return true;
    }
    return false;
}

/** フォルダの入れ子の高さ（サブフォルダを持たないフォルダ = 0） */
export function folderHeight(node: FavoriteNode): number {
    if (node.kind !== 'folder') return 0;
    let h = 0;
    for (const child of node.children) {
        if (child.kind === 'folder') h = Math.max(h, folderHeight(child) + 1);
    }
    return h;
}

/** ノードの深度を取得（0 = ルート） */
export function getDepth(tree: FavoriteNode[], id: string, depth = 0): number {
    for (const node of tree) {
        if (node.id === id) return depth;
        if (node.kind === 'folder') {
            const d = getDepth(node.children, id, depth + 1);
            if (d >= 0) return d;
        }
    }
    return -1;
}

/** フォルダ一覧を収集（編集モードの移動先ドロップダウン用） */
export interface FolderInfo { id: string; name: string; depth: number }

export function collectFolders(tree: FavoriteNode[], out: FolderInfo[], depth = 0) {
    for (const node of tree) {
        if (node.kind === 'folder') {
            out.push({ id: node.id, name: node.name, depth });
            collectFolders(node.children, out, depth + 1);
        }
    }
}

/** 指定フォルダ配下の全チャンネルを再帰的に収集 */
export function collectChannelsFromFolder(tree: FavoriteNode[], folderId: string): FavoriteChannel[] {
    for (const node of tree) {
        if (node.kind === 'folder') {
            if (node.id === folderId) {
                const channels: FavoriteChannel[] = [];
                const collect = (nodes: FavoriteNode[]) => {
                    for (const n of nodes) {
                        if (n.kind === 'channel') channels.push(n);
                        else collect(n.children);
                    }
                };
                collect(node.children);
                return channels;
            }
            const result = collectChannelsFromFolder(node.children, folderId);
            if (result.length > 0) return result;
        }
    }
    return [];
}

/** ツリー内の全チャンネルを "type:sourceId" 形式で収集 */
export function collectChannelIds(tree: FavoriteNode[], out: Set<string>) {
    for (const node of tree) {
        if (node.kind === 'channel') {
            out.add(`${node.type}:${node.sourceId}`);
        } else {
            collectChannelIds(node.children, out);
        }
    }
}

/** 同じ親配列内の2要素をスワップ */
export function swapInArray(arr: FavoriteNode[], fromId: string, toId: string): FavoriteNode[] {
    const result = [...arr];
    const fi = result.findIndex(n => n.id === fromId);
    const ti = result.findIndex(n => n.id === toId);
    if (fi === -1 || ti === -1) return arr;
    [result[fi], result[ti]] = [result[ti], result[fi]];
    return result;
}

/** ツリー内で同一親の並べ替え */
export function reorderInTree(tree: FavoriteNode[], fromId: string, toId: string): FavoriteNode[] {
    // まずルート直下を試す
    const fi = tree.findIndex(n => n.id === fromId);
    const ti = tree.findIndex(n => n.id === toId);
    if (fi !== -1 && ti !== -1) return swapInArray(tree, fromId, toId);

    // フォルダ内を再帰
    return tree.map(n => {
        if (n.kind === 'folder') {
            return { ...n, children: reorderInTree(n.children, fromId, toId) };
        }
        return n;
    });
}



export function applyDisplayName(
    tree: FavoriteNode[],
    type: 'youtube' | 'twitch',
    sourceId: string,
    displayName: string,
): { tree: FavoriteNode[]; changed: boolean } {
    let changed = false;
    const next = tree.map(n => {
        if (n.kind === 'folder') {
            const r = applyDisplayName(n.children, type, sourceId, displayName);
            if (!r.changed) return n;
            changed = true;
            return { ...n, children: r.tree };
        }
        if (n.type === type && n.sourceId === sourceId && n.displayName !== displayName) {
            changed = true;
            return { ...n, displayName };
        }
        return n;
    });
    return { tree: changed ? next : tree, changed };
}

/**
 * ノードを別フォルダへ移動する。移動できない場合は元のツリーをそのまま返す。
 *
 * 移動先が自分自身の子孫だと findAndRemove で移動先ごと切り離されてしまい、
 * insertInto が親を見つけられずサブツリーが丸ごと消える。存在確認で防ぐ。
 */
export function moveNodeInTree(
    tree: FavoriteNode[],
    nodeId: string,
    targetFolderId: string | null,
): FavoriteNode[] {
    if (nodeId === targetFolderId) return tree;

    const [cleaned, removed] = findAndRemove(tree, nodeId);
    if (!removed) return tree;

    if (targetFolderId !== null && !hasFolder(cleaned, targetFolderId)) return tree;

    // フォルダ移動時は MAX_DEPTH を超えないことを保証する
    // （UI 側のサブフォルダ追加ボタン非表示だけではドラッグ経由で破れるため）
    if (removed.kind === 'folder') {
        const targetDepth = targetFolderId === null ? -1 : getDepth(cleaned, targetFolderId);
        if (targetDepth === -1 && targetFolderId !== null) return tree;
        if (targetDepth + 1 + folderHeight(removed) > MAX_DEPTH - 1) return tree;
    }

    return insertInto(cleaned, targetFolderId, removed);
}

/** フォルダを作成する。深度制限を超える場合は元のツリーをそのまま返す */
export function createFolderInTree(
    tree: FavoriteNode[],
    folder: FavoriteFolder,
    parentId: string | null,
): FavoriteNode[] {
    if (parentId !== null) {
        const parentDepth = getDepth(tree, parentId);
        if (parentDepth === -1 || parentDepth >= MAX_DEPTH - 1) return tree;
    }
    return insertInto(tree, parentId, folder);
}
