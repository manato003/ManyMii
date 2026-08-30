/**
 * 外から入ってきたデータの検証。
 *
 * 対象は「共有コード」と「localStorage」の2つ。どちらも
 * **アプリの外で書き換えられる可能性がある**のに、これまで型キャストするだけで
 * 素通ししていた。結果、壊れたデータを1回読ませるとアプリが起動しなくなった:
 *
 *   1. 検証せず localStorage に保存する
 *   2. その後の描画で `toDisplayName` が `undefined.replace` で落ちる
 *   3. 例外は描画中に起きるので、読み込み処理の try/catch では捕まらない
 *   4. データは保存済みなので、リロードしても落ち続ける
 *
 * **描画で使う値が揃っていることを、保存する前に保証する。**
 * 壊れた要素は捨てる（読めるところまで読む）。全体を拒否すると、
 * 1件の破損で全部を失うことになるため。
 *
 * ここは純粋関数だけを置く。
 */

import type { Stream, FavoriteNode, FavoriteFolder, FavoriteChannel } from './../types';

// ── 基本 ──────────────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 空でない文字列。長さ上限は暴走したデータで DOM を膨らませないため */
function str(v: unknown, max = 500): string | null {
    return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

function platform(v: unknown): 'youtube' | 'twitch' | null {
    return v === 'youtube' || v === 'twitch' ? v : null;
}

function inputType(v: unknown): 'channel' | 'video' | 'url' | null {
    return v === 'channel' || v === 'video' || v === 'url' ? v : null;
}

/** true / false のときだけ拾う。未設定と false は意味が違うので undefined を返す */
function bool(v: unknown): boolean | undefined {
    return typeof v === 'boolean' ? v : undefined;
}

// ── 配信 ──────────────────────────────────────────────────────────────────────

/**
 * 描画に必要な値が揃っている配信だけを取り出す。id は呼び出し側で振る。
 *
 * **許可リストなので、追加した項目はここにも足すこと。**
 * `hidden` を落として「非表示にした枠が起動時に復活する」不具合を出したことがある。
 * `isLive` を落とすと、オフラインの枠が起動時にオフライン表示にならない。
 */
export function sanitizeStreams(v: unknown): Omit<Stream, 'id'>[] {
    if (!Array.isArray(v)) return [];
    const out: Omit<Stream, 'id'>[] = [];
    for (const raw of v) {
        if (!isObject(raw)) continue;
        const type = platform(raw.type);
        const sourceId = str(raw.sourceId, 200);
        if (!type || !sourceId) continue;

        const it = inputType(raw.inputType) ?? 'channel';
        out.push({
            type,
            sourceId,
            inputType: it,
            // title は toDisplayName が必ず触るので、欠けていたら補う
            title: str(raw.title) ?? `${type === 'youtube' ? 'YouTube' : 'Twitch'}: ${sourceId}`,
            ...(str(raw.channelHandle, 200) ? { channelHandle: raw.channelHandle as string } : {}),
            ...(str(raw.channelId, 100) ? { channelId: raw.channelId as string } : {}),
            ...(str(raw.displayName) ? { displayName: raw.displayName as string } : {}),
            ...(bool(raw.hidden) !== undefined ? { hidden: bool(raw.hidden) } : {}),
            ...(bool(raw.isLive) !== undefined ? { isLive: bool(raw.isLive) } : {}),
            ...(bool(raw.resolveError) !== undefined ? { resolveError: bool(raw.resolveError) } : {}),
        });
    }
    return out;
}

// ── お気に入り ────────────────────────────────────────────────────────────────

/** これ以上の深さは受け付けない。壊れた入力での無限再帰を止める */
const MAX_IMPORT_DEPTH = 8;

function sanitizeFavoriteNode(raw: unknown, depth: number): FavoriteNode | null {
    if (!isObject(raw) || depth > MAX_IMPORT_DEPTH) return null;

    if (raw.kind === 'folder') {
        const folder: FavoriteFolder = {
            id: str(raw.id, 100) ?? '',
            kind: 'folder',
            name: str(raw.name, 200) ?? 'folder',
            collapsed: raw.collapsed === true,
            children: sanitizeFavorites(raw.children, depth + 1),
        };
        return folder;
    }

    if (raw.kind === 'channel') {
        const type = platform(raw.type);
        const sourceId = str(raw.sourceId, 200);
        if (!type || !sourceId) return null;
        const channel: FavoriteChannel = {
            id: str(raw.id, 100) ?? '',
            kind: 'channel',
            type,
            sourceId,
            inputType: inputType(raw.inputType) ?? 'channel',
            title: str(raw.title) ?? `${type === 'youtube' ? 'YouTube' : 'Twitch'}: ${sourceId}`,
            ...(str(raw.displayName) ? { displayName: raw.displayName as string } : {}),
        };
        return channel;
    }

    return null;
}

/** お気に入りツリーを検証する。壊れたノードは捨て、読めるところまで残す */
export function sanitizeFavorites(v: unknown, depth = 0): FavoriteNode[] {
    if (!Array.isArray(v)) return [];
    const out: FavoriteNode[] = [];
    for (const raw of v) {
        const node = sanitizeFavoriteNode(raw, depth);
        if (node) out.push(node);
    }
    return out;
}

// ── 履歴 ──────────────────────────────────────────────────────────────────────

export interface SanitizedHistoryEntry {
    type: 'youtube' | 'twitch';
    title: string;
    sourceId: string;
    inputType: 'channel' | 'video' | 'url';
    displayName?: string;
}

/** 履歴を検証する。historyId は呼び出し側で振り直す */
export function sanitizeHistory(v: unknown): SanitizedHistoryEntry[] {
    if (!Array.isArray(v)) return [];
    const out: SanitizedHistoryEntry[] = [];
    for (const raw of v) {
        if (!isObject(raw)) continue;
        const type = platform(raw.type);
        const sourceId = str(raw.sourceId, 200);
        if (!type || !sourceId) continue;
        out.push({
            type,
            sourceId,
            inputType: inputType(raw.inputType) ?? 'channel',
            title: str(raw.title) ?? `${type === 'youtube' ? 'YouTube' : 'Twitch'}: ${sourceId}`,
            ...(str(raw.displayName) ? { displayName: raw.displayName as string } : {}),
        });
    }
    return out;
}

// ── 共有コード ────────────────────────────────────────────────────────────────

export interface ShareContents {
    streams: Omit<Stream, 'id'>[];
    favorites: FavoriteNode[];
    history: SanitizedHistoryEntry[];
    /** そのセクションがコードに含まれていたか（空配列と「無い」を区別する） */
    has: { streams: boolean; favorites: boolean; history: boolean };
}

/**
 * 共有コードを復号して検証する。読めなければ null。
 * v1 = 配信の配列そのもの / v2 = { v: 2, streams?, favorites?, history? }
 */
export function parseShareCode(code: string): ShareContents | null {
    let decoded: unknown;
    try {
        decoded = JSON.parse(decodeURIComponent(atob(code.trim())));
    } catch {
        return null;
    }

    if (Array.isArray(decoded)) {
        const streams = sanitizeStreams(decoded);
        if (streams.length === 0) return null;      // v1 で中身が無いなら失敗扱い
        return { streams, favorites: [], history: [], has: { streams: true, favorites: false, history: false } };
    }

    if (isObject(decoded) && decoded.v === 2) {
        // **配列が入っているときだけ「そのセクションがある」とみなす。**
        // undefined でないだけで true にすると、favorites: null のような壊れた値が
        // 「空で置き換える」と解釈され、既存のお気に入りが消えてしまう
        const has = {
            streams: Array.isArray(decoded.streams),
            favorites: Array.isArray(decoded.favorites),
            history: Array.isArray(decoded.history),
        };
        if (!has.streams && !has.favorites && !has.history) return null;
        return {
            streams: sanitizeStreams(decoded.streams),
            favorites: sanitizeFavorites(decoded.favorites),
            history: sanitizeHistory(decoded.history),
            has,
        };
    }

    return null;
}

// ── ID の補完 ────────────────────────────────────────────────────────────────

/**
 * ID が欠けているノードに ID を振る。
 * 検証では ID を捏造せず空文字のままにしてあるので、保存前に必ず通すこと。
 * ID が重複・欠落したままだと React の key が壊れ、選択や移動が誤爆する。
 */
export function assignMissingIds(nodes: FavoriteNode[], gen: () => string): FavoriteNode[] {
    const seen = new Set<string>();
    const walk = (list: FavoriteNode[]): FavoriteNode[] => list.map(n => {
        const id = n.id && !seen.has(n.id) ? n.id : gen();
        seen.add(id);
        return n.kind === 'folder'
            ? { ...n, id, children: walk(n.children) }
            : { ...n, id };
    });
    return walk(nodes);
}
