import { describe, it, expect } from 'vitest';
import type { FavoriteNode, FavoriteFolder, FavoriteChannel } from '../types';
import {
    moveNodeInTree,
    createFolderInTree,
    findAndRemove,
    insertInto,
    reorderInTree,
    applyDisplayName,
    collectChannelsFromFolder,
    collectChannelIds,
    collectFolders,
} from './favoriteTree';

const ch = (id: string, sourceId = id): FavoriteChannel => ({
    id, kind: 'channel', type: 'youtube', title: `YouTube: @${sourceId}`, sourceId, inputType: 'channel',
});
const folder = (id: string, children: FavoriteNode[] = []): FavoriteFolder => ({
    id, kind: 'folder', name: id, collapsed: false, children,
});

/** ツリー内の全ノードIDを集める（消失検出用） */
function allIds(tree: FavoriteNode[]): string[] {
    return tree.flatMap(n => n.kind === 'folder' ? [n.id, ...allIds(n.children)] : [n.id]);
}

describe('moveNodeInTree', () => {
    it('フォルダを自分の子孫へ移動してもサブツリーを失わない', () => {
        // 回帰防止: findAndRemove → insertInto の順で処理するため、移動先が
        // 自分の子孫だと移動先ごと切り離され、ツリーが空になっていた
        const tree = [folder('A', [folder('B', [ch('c1')])])];
        const next = moveNodeInTree(tree, 'A', 'B');
        expect(next).toBe(tree);                       // 何も変えない
        expect(allIds(next).sort()).toEqual(['A', 'B', 'c1']);
    });

    it('自分自身への移動は何もしない', () => {
        const tree = [folder('A', [ch('c1')])];
        expect(moveNodeInTree(tree, 'A', 'A')).toBe(tree);
    });

    it('存在しない移動先には移動しない', () => {
        const tree = [folder('A'), ch('c1')];
        expect(moveNodeInTree(tree, 'c1', 'NOPE')).toBe(tree);
    });

    it('存在しないノードの移動は何もしない', () => {
        const tree = [folder('A')];
        expect(moveNodeInTree(tree, 'NOPE', 'A')).toBe(tree);
    });

    it('チャンネルをフォルダへ移動できる', () => {
        const tree = [folder('A'), ch('c1')];
        const next = moveNodeInTree(tree, 'c1', 'A');
        expect(allIds(next)).toEqual(['A', 'c1']);
        expect((next[0] as FavoriteFolder).children.map(n => n.id)).toEqual(['c1']);
    });

    it('チャンネルをルートへ戻せる', () => {
        const tree = [folder('A', [ch('c1')])];
        const next = moveNodeInTree(tree, 'c1', null);
        expect(next.map(n => n.id)).toEqual(['A', 'c1']);
    });

    it('MAX_DEPTH を超えるフォルダ移動を拒否する', () => {
        // A(depth0) と B(depth0)。B を A へ入れると B は depth1 で可
        const ok = moveNodeInTree([folder('A'), folder('B')], 'B', 'A');
        expect(allIds(ok)).toEqual(['A', 'B']);
        expect((ok[0] as FavoriteFolder).children.map(n => n.id)).toEqual(['B']);

        // サブフォルダを持つ B を A へ入れると子が depth2 になるので拒否
        const tree = [folder('A'), folder('B', [folder('B1')])];
        expect(moveNodeInTree(tree, 'B', 'A')).toBe(tree);

        // depth1 のフォルダの中へさらにフォルダを入れるのも拒否
        const deep = [folder('A', [folder('A1')]), folder('B')];
        expect(moveNodeInTree(deep, 'B', 'A1')).toBe(deep);
    });

    it('チャンネルは深さ制限の対象外（フォルダではないため）', () => {
        const tree = [folder('A', [folder('A1')]), ch('c1')];
        const next = moveNodeInTree(tree, 'c1', 'A1');
        expect(allIds(next).sort()).toEqual(['A', 'A1', 'c1']);
    });
});

describe('createFolderInTree', () => {
    it('ルートに作れる', () => {
        const next = createFolderInTree([], folder('new'), null);
        expect(next.map(n => n.id)).toEqual(['new']);
    });

    it('depth1 のフォルダの下には作れない', () => {
        const tree = [folder('A', [folder('A1')])];
        expect(createFolderInTree(tree, folder('new'), 'A1')).toBe(tree);
    });

    it('存在しない親には作らない', () => {
        const tree = [folder('A')];
        expect(createFolderInTree(tree, folder('new'), 'NOPE')).toBe(tree);
    });
});

describe('findAndRemove / insertInto', () => {
    it('ネストしたノードを取り出せる', () => {
        const [rest, removed] = findAndRemove([folder('A', [ch('c1'), ch('c2')])], 'c1');
        expect(removed?.id).toBe('c1');
        expect(allIds(rest)).toEqual(['A', 'c2']);
    });

    it('存在しない親への挿入はツリーを変えない', () => {
        const tree = [folder('A')];
        expect(allIds(insertInto(tree, 'NOPE', ch('c1')))).toEqual(['A']);
    });
});

describe('reorderInTree', () => {
    it('同じ親の中で入れ替える', () => {
        const next = reorderInTree([ch('a'), ch('b'), ch('c')], 'a', 'c');
        expect(next.map(n => n.id)).toEqual(['c', 'b', 'a']);
    });

    it('フォルダ内でも入れ替えられる', () => {
        const next = reorderInTree([folder('F', [ch('a'), ch('b')])], 'a', 'b');
        expect((next[0] as FavoriteFolder).children.map(n => n.id)).toEqual(['b', 'a']);
    });
});

describe('collect 系', () => {
    it('フォルダ配下の全チャンネルを再帰的に集める', () => {
        const tree = [folder('A', [ch('c1'), folder('A1', [ch('c2')])]), ch('c3')];
        expect(collectChannelsFromFolder(tree, 'A').map(c => c.id)).toEqual(['c1', 'c2']);
    });

    it('type:sourceId の集合を作る', () => {
        const ids = new Set<string>();
        collectChannelIds([folder('A', [ch('c1', 'handle1')]), ch('c2', 'handle2')], ids);
        expect([...ids].sort()).toEqual(['youtube:handle1', 'youtube:handle2']);
    });

    it('フォルダ一覧を深さつきで集める', () => {
        const out: { id: string; name: string; depth: number }[] = [];
        collectFolders([folder('A', [folder('A1')]), folder('B')], out);
        expect(out.map(f => `${f.id}:${f.depth}`)).toEqual(['A:0', 'A1:1', 'B:0']);
    });
});

describe('applyDisplayName', () => {
    it('該当チャンネルだけ更新し、変化がなければ同一参照を返す', () => {
        const tree = [folder('A', [ch('c1', 'handle1')]), ch('c2', 'handle2')];
        const r1 = applyDisplayName(tree, 'youtube', 'handle1', '紡木こかげ');
        expect(r1.changed).toBe(true);
        const updated = (r1.tree[0] as FavoriteFolder).children[0] as FavoriteChannel;
        expect(updated.displayName).toBe('紡木こかげ');
        expect((r1.tree[1] as FavoriteChannel).displayName).toBeUndefined();

        const r2 = applyDisplayName(r1.tree, 'youtube', 'handle1', '紡木こかげ');
        expect(r2.changed).toBe(false);
        expect(r2.tree).toBe(r1.tree);
    });

    it('プラットフォームが違えば更新しない', () => {
        const tree = [ch('c1', 'name')];
        expect(applyDisplayName(tree, 'twitch', 'name', 'X').changed).toBe(false);
    });
});
