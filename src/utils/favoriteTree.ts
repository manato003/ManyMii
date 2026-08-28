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

/** ノードの親フォルダ ID。ルート直下なら null、ツリーに無ければ undefined */
export function findParentId(
    tree: FavoriteNode[],
    id: string,
    parent: string | null = null,
): string | null | undefined {
    for (const node of tree) {
        if (node.id === id) return parent;
        if (node.kind === 'folder') {
            const found = findParentId(node.children, id, node.id);
            if (found !== undefined) return found;
        }
    }
    return undefined;
}

/**
 * nodeId を targetFolderId の直下へ移動してよいか。
 *
 * ドロップ可否の見た目（ハイライトを出すか）と実際の移動で同じ判定を使うため、
 * 移動処理から切り出してある。**判定と実行がずれると「光ったのに動かない」**
 * という一番たちの悪い挙動になる。
 */
export function canMoveInto(
    tree: FavoriteNode[],
    nodeId: string,
    targetFolderId: string | null,
): boolean {
    if (nodeId === targetFolderId) return false;

    const [cleaned, removed] = findAndRemove(tree, nodeId);
    if (!removed) return false;

    // 移動先が自分の子孫だと findAndRemove で一緒に切り離されるので、
    // cleaned の中に残っていないことで検出できる
    if (targetFolderId !== null && !hasFolder(cleaned, targetFolderId)) return false;

    // フォルダ移動時は MAX_DEPTH を超えないことを保証する
    // （UI 側のサブフォルダ追加ボタン非表示だけではドラッグ経由で破れるため）
    if (removed.kind === 'folder') {
        const targetDepth = targetFolderId === null ? -1 : getDepth(cleaned, targetFolderId);
        if (targetDepth === -1 && targetFolderId !== null) return false;
        if (targetDepth + 1 + folderHeight(removed) > MAX_DEPTH - 1) return false;
    }
    return true;
}

/**
 * ノードを別フォルダの末尾へ移動する。移動できない場合は元のツリーをそのまま返す。
 * targetFolderId が null ならルート直下へ。
 */
export function moveNodeInTree(
    tree: FavoriteNode[],
    nodeId: string,
    targetFolderId: string | null,
): FavoriteNode[] {
    if (!canMoveInto(tree, nodeId, targetFolderId)) return tree;
    const [cleaned, removed] = findAndRemove(tree, nodeId);
    if (!removed) return tree;
    return insertInto(cleaned, targetFolderId, removed);
}

/** targetId を含む配列の、その位置に node を差し込む */
function insertRelative(
    tree: FavoriteNode[],
    parentId: string | null,
    targetId: string,
    position: 'before' | 'after',
    node: FavoriteNode,
): FavoriteNode[] {
    const put = (arr: FavoriteNode[]): FavoriteNode[] => {
        const i = arr.findIndex(n => n.id === targetId);
        if (i === -1) return arr;
        const next = [...arr];
        next.splice(position === 'before' ? i : i + 1, 0, node);
        return next;
    };

    if (parentId === null) return put(tree);
    return tree.map(n => {
        if (n.kind !== 'folder') return n;
        if (n.id === parentId) return { ...n, children: put(n.children) };
        return { ...n, children: insertRelative(n.children, parentId, targetId, position, node) };
    });
}

/**
 * targetId の直前／直後へ移動する。**親をまたいでもよい。**
 *
 * 入れ替え（swap）ではなく挿入にしてあるのは、
 * 「A を C に落としたら C B A になる」という直感に反する動きを避けるため。
 * これによりルート直下の項目の前後に落とすだけで階層を上げられる。
 */
export function moveNodeRelative(
    tree: FavoriteNode[],
    nodeId: string,
    targetId: string,
    position: 'before' | 'after',
): FavoriteNode[] {
    if (nodeId === targetId) return tree;

    const parentId = findParentId(tree, targetId);
    if (parentId === undefined) return tree;          // 移動先が存在しない
    if (!canMoveInto(tree, nodeId, parentId)) return tree;

    const [cleaned, removed] = findAndRemove(tree, nodeId);
    if (!removed) return tree;
    return insertRelative(cleaned, parentId, targetId, position, removed);
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
