import { describe, it, expect } from 'vitest';
import {
    sanitizeStreams,
    sanitizeFavorites,
    sanitizeHistory,
    parseShareCode,
    assignMissingIds,
} from './validate';
import { toDisplayName } from '../types';
import { collectChannelIds } from './favoriteTree';
import type { FavoriteNode, FavoriteFolder } from '../types';

/** 実際に共有コードとして渡される形にエンコードする */
function encode(data: unknown): string {
    return btoa(encodeURIComponent(JSON.stringify(data)));
}

describe('sanitizeStreams', () => {
    it('配列でなければ空', () => {
        for (const v of [null, undefined, {}, 'x', 42]) {
            expect(sanitizeStreams(v)).toEqual([]);
        }
    });

    it('type / sourceId が無い要素は捨てる', () => {
        expect(sanitizeStreams([{}, { type: 'youtube' }, { sourceId: 'a' }])).toEqual([]);
    });

    it('未知のプラットフォームは捨てる', () => {
        expect(sanitizeStreams([{ type: 'niconico', sourceId: 'a' }])).toEqual([]);
    });

    // title が欠けていると toDisplayName が undefined.replace で落ちる
    it('title が無ければ補う', () => {
        const [s] = sanitizeStreams([{ type: 'youtube', sourceId: 'abc' }]);
        expect(s.title).toBe('YouTube: abc');
        expect(() => toDisplayName(s)).not.toThrow();
    });

    it('未知の inputType は channel に落とす', () => {
        const [s] = sanitizeStreams([{ type: 'twitch', sourceId: 'a', inputType: 'evil' }]);
        expect(s.inputType).toBe('channel');
    });

    it('正常な要素はそのまま通す', () => {
        const [s] = sanitizeStreams([
            { type: 'twitch', sourceId: 'foo', inputType: 'channel', title: 'Twitch: foo' },
        ]);
        expect(s).toEqual({ type: 'twitch', sourceId: 'foo', inputType: 'channel', title: 'Twitch: foo' });
    });

    it('極端に長い文字列は捨てる（DOM を膨らませない）', () => {
        const huge = 'x'.repeat(100000);
        expect(sanitizeStreams([{ type: 'youtube', sourceId: huge }])).toEqual([]);
    });
});

describe('sanitizeFavorites', () => {
    it('配列でなければ空', () => {
        for (const v of [null, {}, 'x']) expect(sanitizeFavorites(v)).toEqual([]);
    });

    // 報告された不具合の中核: これを保存すると描画で落ちて起動不能になっていた
    it('type / sourceId の無いチャンネルは捨てる', () => {
        expect(sanitizeFavorites([{ kind: 'channel' }])).toEqual([]);
    });

    it('kind が無い要素は捨てる', () => {
        expect(sanitizeFavorites([{ title: 'x' }])).toEqual([]);
    });

    it('children が配列でないフォルダも壊れず空の children になる', () => {
        const [f] = sanitizeFavorites([{ kind: 'folder', name: 'F', children: null }]);
        expect((f as FavoriteFolder).children).toEqual([]);
    });

    it('チャンネルの未知の inputType は channel に落とす', () => {
        const [c] = sanitizeFavorites([{ kind: 'channel', type: 'youtube', sourceId: 'a', inputType: 'evil' }]);
        expect((c as { inputType: string }).inputType).toBe('channel');
    });

    it('未知のプラットフォームのチャンネルは捨てる', () => {
        expect(sanitizeFavorites([{ kind: 'channel', type: 'niconico', sourceId: 'a' }])).toEqual([]);
    });

    it('name の無いフォルダは補う', () => {
        const [f] = sanitizeFavorites([{ kind: 'folder' }]);
        expect(typeof (f as FavoriteFolder).name).toBe('string');
    });

    it('壊れた子だけを捨てて、読めるものは残す', () => {
        const tree = sanitizeFavorites([
            { kind: 'folder', name: 'F', children: [{ kind: 'channel' }, { kind: 'channel', type: 'youtube', sourceId: 'ok' }] },
        ]);
        expect((tree[0] as FavoriteFolder).children.map(n => (n as { sourceId: string }).sourceId)).toEqual(['ok']);
    });

    it('深すぎる入れ子は打ち切る（無限再帰を防ぐ）', () => {
        let node: Record<string, unknown> = { kind: 'channel', type: 'youtube', sourceId: 'deep' };
        for (let i = 0; i < 50; i++) node = { kind: 'folder', name: 'F', children: [node] };
        const depth = (n: FavoriteNode, d = 1): number =>
            n.kind === 'folder' && n.children.length > 0 ? depth(n.children[0], d + 1) : d;
        expect(() => sanitizeFavorites([node])).not.toThrow();
        expect(depth(sanitizeFavorites([node])[0])).toBeLessThanOrEqual(10);
    });

    it('検証後のツリーは描画系の関数を落とさない', () => {
        const tree = sanitizeFavorites([
            { kind: 'channel' },
            { kind: 'folder', children: 'broken' },
            { kind: 'channel', type: 'twitch', sourceId: 'ok' },
        ]);
        const ids = new Set<string>();
        expect(() => collectChannelIds(tree, ids)).not.toThrow();
        for (const n of tree) {
            if (n.kind === 'channel') expect(() => toDisplayName(n)).not.toThrow();
        }
    });
});

describe('sanitizeHistory', () => {
    it('壊れた項目は捨てる', () => {
        expect(sanitizeHistory([{}, { type: 'youtube' }, null, 'x'])).toEqual([]);
    });

    it('title を補い、toDisplayName が落ちない', () => {
        const [e] = sanitizeHistory([{ type: 'twitch', sourceId: 'foo' }]);
        expect(() => toDisplayName(e)).not.toThrow();
    });
});

describe('parseShareCode', () => {
    it('壊れたコードは null', () => {
        for (const v of ['', 'not-base64!!!', btoa('{{{'), encode(42), encode('x')]) {
            expect(parseShareCode(v)).toBeNull();
        }
    });

    it('v1（配列）を読める', () => {
        const parsed = parseShareCode(encode([{ type: 'youtube', sourceId: 'a' }]));
        expect(parsed?.streams).toHaveLength(1);
        expect(parsed?.has).toEqual({ streams: true, favorites: false, history: false });
    });

    it('v1 で有効な配信が1つも無ければ null', () => {
        expect(parseShareCode(encode([{ bogus: true }]))).toBeNull();
    });

    it('v2 の各セクションを読める', () => {
        const parsed = parseShareCode(encode({
            v: 2,
            streams: [{ type: 'twitch', sourceId: 'a' }],
            favorites: [{ kind: 'channel', type: 'youtube', sourceId: 'b' }],
            history: [{ type: 'youtube', sourceId: 'c' }],
        }));
        expect(parsed?.streams).toHaveLength(1);
        expect(parsed?.favorites).toHaveLength(1);
        expect(parsed?.history).toHaveLength(1);
        expect(parsed?.has).toEqual({ streams: true, favorites: true, history: true });
    });

    // 「セクションが無い」と「空だった」を区別しないと、
    // 配信だけのコードでお気に入りまで消えてしまう
    it('含まれていないセクションは has が false', () => {
        const parsed = parseShareCode(encode({ v: 2, streams: [{ type: 'twitch', sourceId: 'a' }] }));
        expect(parsed?.has.favorites).toBe(false);
        expect(parsed?.has.history).toBe(false);
    });

    it('セクションが1つも無い v2 は null', () => {
        expect(parseShareCode(encode({ v: 2 }))).toBeNull();
    });

    // これを読み込むとアプリが起動不能になっていた
    it('起動不能を起こしていたペイロードを無害化する', () => {
        const parsed = parseShareCode(encode({ v: 2, favorites: [{ kind: 'channel' }] }));
        expect(parsed).not.toBeNull();
        expect(parsed?.favorites).toEqual([]);
        expect(parsed?.has.favorites).toBe(true);
    });

    it('中身が配列でなくても落ちない', () => {
        const parsed = parseShareCode(encode({ v: 2, favorites: 'boom', history: 42, streams: [] }));
        expect(parsed?.favorites).toEqual([]);
        expect(parsed?.history).toEqual([]);
        expect(parsed?.streams).toEqual([]);
    });

    // 壊れた値を「空のセクション」と解釈すると、既存のデータが消える
    it('配列でないセクションは has を false にして触らない', () => {
        const parsed = parseShareCode(encode({ v: 2, streams: [{ type: 'twitch', sourceId: 'a' }], favorites: null, history: 'boom' }));
        expect(parsed?.has.streams).toBe(true);
        expect(parsed?.has.favorites).toBe(false);
        expect(parsed?.has.history).toBe(false);
    });

    it('空配列のセクションは has が true（明示的に空で置き換える）', () => {
        const parsed = parseShareCode(encode({ v: 2, favorites: [] }));
        expect(parsed?.has.favorites).toBe(true);
    });
});

describe('assignMissingIds', () => {
    let n = 0;
    const gen = () => `gen-${++n}`;

    it('ID が無いノードに振る', () => {
        n = 0;
        const out = assignMissingIds([{ id: '', kind: 'channel', type: 'youtube', title: 't', sourceId: 's', inputType: 'channel' }], gen);
        expect(out[0].id).toBe('gen-1');
    });

    it('既存の ID は保つ', () => {
        n = 0;
        const out = assignMissingIds([{ id: 'keep', kind: 'channel', type: 'youtube', title: 't', sourceId: 's', inputType: 'channel' }], gen);
        expect(out[0].id).toBe('keep');
    });

    // ID が重複すると React の key が壊れ、選択や移動が別の行に効く
    it('重複した ID は振り直す', () => {
        n = 0;
        const dup = (id: string): FavoriteNode => ({ id, kind: 'channel', type: 'youtube', title: 't', sourceId: 's', inputType: 'channel' });
        const out = assignMissingIds([dup('same'), dup('same')], gen);
        expect(out[0].id).not.toBe(out[1].id);
    });

    it('入れ子にも効く', () => {
        n = 0;
        const out = assignMissingIds([
            { id: '', kind: 'folder', name: 'F', collapsed: false, children: [{ id: '', kind: 'channel', type: 'youtube', title: 't', sourceId: 's', inputType: 'channel' }] },
        ], gen);
        expect(out[0].id).toBeTruthy();
        expect((out[0] as FavoriteFolder).children[0].id).toBeTruthy();
    });
});
