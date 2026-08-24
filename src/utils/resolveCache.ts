/**
 * ライブ解決結果のキャッシュ。
 *
 * YouTubeの解決は r.jina.ai という無料の第三者サービス1つに依存しており、
 * これがこのアプリの単一障害点になっている。
 * - 無料枠にレート制限があり、連続で叩くと HTTP 429 になる
 * - 1レスポンスが 1.2〜2.7MB と重い
 *
 * 依存そのものは外せない（素のCORSプロキシはYouTubeが縮退ページを返すため
 * 機能しない）ので、**叩く回数を減らす**ことで緩和する。
 * とくにページのリロードや同じチャンネルの再追加で毎回取りに行っていたのを止める。
 *
 * 純粋関数と localStorage への橋渡しを分けてあるのは、前者をテストするため。
 */

// ── 純粋なキャッシュ操作 ──────────────────────────────────────────────────────

export interface CacheEntry {
    /** キャッシュした値 */
    v: unknown;
    /** 有効期限（epoch ms） */
    e: number;
}

export type CacheMap = Record<string, CacheEntry>;

/** これを超えたら古い順に捨てる。localStorage を圧迫しないための上限 */
export const MAX_ENTRIES = 100;

/**
 * 有効なエントリを読む。期限切れ・不在なら undefined。
 * 呼び出し側が型を知っているので、値の妥当性検証はしない。
 */
export function readEntry<T>(map: CacheMap, key: string, now: number): T | undefined {
    const hit = map[key];
    if (!hit) return undefined;
    if (hit.e <= now) return undefined;
    return hit.v as T;
}

/**
 * エントリを書いた新しいマップを返す（引数は変更しない）。
 * 期限切れの掃除と件数の上限適用もここで行う。
 */
export function writeEntry(map: CacheMap, key: string, value: unknown, ttlMs: number, now: number): CacheMap {
    const next: CacheMap = { ...map, [key]: { v: value, e: now + ttlMs } };
    return pruneCache(next, now);
}

/**
 * 期限切れを落とし、残りが MAX_ENTRIES を超えていたら
 * 有効期限の近いもの（＝もっとも早く無価値になるもの）から捨てる。
 */
export function pruneCache(map: CacheMap, now: number, maxEntries: number = MAX_ENTRIES): CacheMap {
    const alive = Object.entries(map).filter(([, entry]) => entry.e > now);
    if (alive.length <= maxEntries) return Object.fromEntries(alive);
    alive.sort((a, b) => b[1].e - a[1].e); // 期限が遠い順
    return Object.fromEntries(alive.slice(0, maxEntries));
}

// ── localStorage への橋渡し ──────────────────────────────────────────────────

const STORAGE_KEY = 'resolveCache';

function load(): CacheMap {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return parsed as CacheMap;
    } catch {
        return {};
    }
}

function save(map: CacheMap): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        // 容量超過やプライベートモード。キャッシュは無くても動くので握りつぶす
    }
}

export function getCached<T>(key: string): T | undefined {
    return readEntry<T>(load(), key, Date.now());
}

export function setCached(key: string, value: unknown, ttlMs: number): void {
    const now = Date.now();
    save(writeEntry(load(), key, value, ttlMs, now));
}
