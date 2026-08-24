import { describe, it, expect } from 'vitest';
import { readEntry, writeEntry, pruneCache, MAX_ENTRIES, type CacheMap } from './resolveCache';

const NOW = 1_000_000;

function entry(value: unknown, expiresAt: number) {
    return { v: value, e: expiresAt };
}

describe('readEntry', () => {
    it('有効なエントリを返す', () => {
        const map: CacheMap = { a: entry('hit', NOW + 1000) };
        expect(readEntry<string>(map, 'a', NOW)).toBe('hit');
    });

    it('存在しないキーは undefined', () => {
        expect(readEntry({}, 'a', NOW)).toBeUndefined();
    });

    it('期限切れは undefined', () => {
        const map: CacheMap = { a: entry('stale', NOW - 1) };
        expect(readEntry(map, 'a', NOW)).toBeUndefined();
    });

    it('有効期限ちょうどは期限切れ扱い', () => {
        const map: CacheMap = { a: entry('edge', NOW) };
        expect(readEntry(map, 'a', NOW)).toBeUndefined();
    });

    it('オブジェクトもそのまま復元できる', () => {
        const value = { status: 'live', videoId: 'abc' };
        const map: CacheMap = { a: entry(value, NOW + 1) };
        expect(readEntry(map, 'a', NOW)).toEqual(value);
    });
});

describe('writeEntry', () => {
    it('TTL を足した有効期限で書き込む', () => {
        const next = writeEntry({}, 'a', 'v', 5000, NOW);
        expect(next.a).toEqual({ v: 'v', e: NOW + 5000 });
    });

    it('元のマップを変更しない', () => {
        const map: CacheMap = {};
        writeEntry(map, 'a', 'v', 5000, NOW);
        expect(map).toEqual({});
    });

    it('同じキーは上書きされる', () => {
        const first = writeEntry({}, 'a', 'old', 1000, NOW);
        const second = writeEntry(first, 'a', 'new', 2000, NOW);
        expect(second.a).toEqual({ v: 'new', e: NOW + 2000 });
    });

    it('書き込みのついでに期限切れを掃除する', () => {
        const map: CacheMap = { stale: entry('x', NOW - 1), alive: entry('y', NOW + 1000) };
        const next = writeEntry(map, 'new', 'z', 1000, NOW);
        expect(Object.keys(next).sort()).toEqual(['alive', 'new']);
    });
});

describe('pruneCache', () => {
    it('期限切れだけを落とす', () => {
        const map: CacheMap = { a: entry(1, NOW - 1), b: entry(2, NOW + 1) };
        expect(pruneCache(map, NOW)).toEqual({ b: entry(2, NOW + 1) });
    });

    it('上限以内なら何も捨てない', () => {
        const map: CacheMap = {};
        for (let i = 0; i < MAX_ENTRIES; i++) map[`k${i}`] = entry(i, NOW + 1000);
        expect(Object.keys(pruneCache(map, NOW))).toHaveLength(MAX_ENTRIES);
    });

    it('上限を超えたら有効期限が近いものから捨てる', () => {
        const map: CacheMap = {
            soon: entry('soon', NOW + 10),
            later: entry('later', NOW + 1000),
            latest: entry('latest', NOW + 100000),
        };
        const next = pruneCache(map, NOW, 2);
        expect(Object.keys(next).sort()).toEqual(['later', 'latest']);
    });

    it('期限切れの掃除が先に効くので、上限判定は生存分だけで行う', () => {
        const map: CacheMap = {
            dead1: entry('x', NOW - 1),
            dead2: entry('x', NOW - 1),
            alive: entry('ok', NOW + 1000),
        };
        expect(pruneCache(map, NOW, 2)).toEqual({ alive: entry('ok', NOW + 1000) });
    });

    it('空のマップでも壊れない', () => {
        expect(pruneCache({}, NOW)).toEqual({});
    });
});
