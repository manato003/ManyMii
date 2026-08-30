/**
 * 観測ログ。
 *
 * 「ライブ配信が続いているのに埋め込みが配信終了の表示になる」現象を追うための仕組み。
 * **時折しか起きない**ため、発生した瞬間に devtools を開いていないと捕まえられない。
 * そこで localStorage にリングバッファで残し、後から読めるようにする。
 *
 * **これは観測専用で、アプリの挙動を一切変えない。**
 * 原因が特定できたら丸ごと削除する（`docs/SPEC.md` の「観測ログ」を参照）。
 */

const STORAGE_KEY = 'eventLog';

/** これ以上は古いものから捨てる。localStorage を圧迫させない */
export const MAX_EVENTS = 300;

export interface LoggedEvent {
    /** epoch ms */
    t: number;
    /** 何が起きたか。'yt-state' / 'expand' / 'hide' / 'close' など */
    kind: string;
    /** 対象の配信（分かるときだけ） */
    id?: string;
    /** 補足。プレイヤーの状態番号など */
    detail?: string | number;
}

// ── 純粋部分 ────────────────────────────────────────────────────────────────

/** 末尾に足して上限を超えたぶんを先頭から捨てる。元の配列は変更しない */
export function appendEvent(list: LoggedEvent[], entry: LoggedEvent, max = MAX_EVENTS): LoggedEvent[] {
    const next = [...list, entry];
    return next.length <= max ? next : next.slice(next.length - max);
}

/** 保存されているログを復元する。壊れていれば空にする（観測用なので黙って捨ててよい） */
export function parseEventLog(raw: string | null): LoggedEvent[] {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((e): e is LoggedEvent =>
            typeof e === 'object' && e !== null
            && typeof (e as LoggedEvent).t === 'number'
            && typeof (e as LoggedEvent).kind === 'string',
        );
    } catch {
        return [];
    }
}

/** 読みやすいテキストにする。報告用にそのままコピーできる形 */
export function formatEventLog(list: LoggedEvent[]): string {
    return list.map(e => {
        const time = new Date(e.t).toISOString().slice(11, 23);
        const id = e.id ? ` ${e.id.slice(0, 8)}` : '';
        const detail = e.detail !== undefined ? ` ${e.detail}` : '';
        return `${time} ${e.kind}${id}${detail}`;
    }).join('\n');
}

// ── localStorage への橋渡し ──────────────────────────────────────────────────

export function logEvent(kind: string, id?: string, detail?: string | number): void {
    try {
        const list = parseEventLog(localStorage.getItem(STORAGE_KEY));
        const next = appendEvent(list, { t: Date.now(), kind, ...(id ? { id } : {}), ...(detail !== undefined ? { detail } : {}) });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        /* 容量超過やプライベートモード。観測できないだけなので握りつぶす */
    }
}

export function readEventLog(): LoggedEvent[] {
    return parseEventLog(localStorage.getItem(STORAGE_KEY));
}

export function clearEventLog(): void {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
