/**
 * YouTubeのチャンネル識別子（@ハンドル / UCチャンネルID）から
 * 現在配信中の video ID を解決する。
 *
 * 手順:
 *   1. CORSプロキシ経由で youtube.com/@handle/live （または /channel/UCxxx/live）を取得
 *   2. 応答が「使える」ものか検証する（後述の縮退ページを弾く）
 *   3. <link rel="canonical"> から video ID を抽出
 *   4. ライブ判定:
 *        "isLiveNow": true                        → 通常のライブ
 *        "isLive": true かつ "hlsManifestUrl" あり → 24/7ストリーム（ニュース等）
 *      予定配信は hlsManifestUrl を持たないため除外される
 *   5. ライブでなければ offline。取得・検証に失敗したら error
 *
 * APIキーもバックエンドも使わない。ライブ状態はキャッシュせず常に取得しに行く。
 *
 * ■ 縮退ページについて
 * YouTubeはプロキシ経由のリクエストに対し、200 を返しながら中身のない
 * ページ（canonical が "undefined"、title が空）を返すことがある。
 * これを普通に解析すると canonical が取れず「オフライン」と誤判定するため、
 * 明示的に検出して error 扱いにする。
 */

import { isYouTubeChannelId } from './parseInput';

/**
 * 1リクエストあたりの上限時間。
 * 死んだプロキシは応答までに20秒以上かかることがあり、
 * 直列フォールバックだと全体が固まるため必ず打ち切る。
 */
const FETCH_TIMEOUT_MS = 6000;

/** 実測で成功率の高い順に並べること */
const PROXIES: ((url: string) => string)[] = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
];

async function fetchOnce(proxyUrl: string, minLength: number): Promise<string> {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length < minLength) throw new Error(`Response too short (${text.length})`);
    return text;
}

/**
 * プロキシを順に試し、isUsable を満たす応答が得られたら返す。
 * すべて失敗したら例外を投げる。
 */
async function fetchViaProxy(
    targetUrl: string,
    opts: { minLength: number; isUsable?: (body: string) => boolean },
): Promise<string> {
    const { minLength, isUsable } = opts;
    let lastError: Error | null = null;

    for (const proxyFn of PROXIES) {
        try {
            const text = await fetchOnce(proxyFn(targetUrl), minLength);
            if (isUsable && !isUsable(text)) {
                throw new Error('Unusable response (degraded page)');
            }
            return text;
        } catch (err) {
            lastError = err as Error;
            console.warn(`[fetchViaProxy] failed for ${targetUrl}:`, err);
        }
    }

    throw lastError || new Error('All proxies failed');
}

// ── HTML 解析 ────────────────────────────────────────────────────────────────

function extractVideoIdFromCanonical(html: string): string | null {
    const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
    return m ? m[1] : null;
}

function checkIsLive(html: string): boolean {
    // 通常ライブ
    if (/"isLiveNow"\s*:\s*true/.test(html)) return true;
    // 24/7ストリーム: isLive:true かつ HLSマニフェストあり（予定配信は持たない）
    if (/"isLive"\s*:\s*true/.test(html) && /"hlsManifestUrl"/.test(html)) return true;
    return false;
}

/** YouTubeが返す中身のない縮退ページかどうか */
function isDegradedPage(html: string): boolean {
    if (/<link rel="canonical" href="undefined">/.test(html)) return true;
    if (/<title>\s*-\s*YouTube<\/title>/.test(html)) return true;
    return false;
}

/** 解析に必要な構造を備えた応答か */
function isUsableYouTubePage(html: string): boolean {
    if (isDegradedPage(html)) return false;
    return html.includes('ytInitialPlayerResponse') || html.includes('rel="canonical"');
}

function extractChannelId(html: string): string | undefined {
    const m = html.match(/"channelId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"/);
    return m ? m[1] : undefined;
}

/** YouTubeのHTMLに埋まっているJSON文字列のエスケープを戻す */
function decodeJsonString(raw: string): string {
    try {
        return JSON.parse(`"${raw}"`) as string;
    } catch {
        return raw;
    }
}

/** チャンネルの表示名。取れなければ undefined（呼び出し側で識別子にフォールバック） */
function extractChannelName(html: string): string | undefined {
    const patterns = [
        /"ownerChannelName"\s*:\s*"([^"]{1,80})"/,
        /"author"\s*:\s*"([^"]{1,80})"/,
        /<link itemprop="name" content="([^"]{1,80})">/,
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (m && m[1].trim()) return decodeJsonString(m[1]);
    }
    return undefined;
}

// ── 公開API ──────────────────────────────────────────────────────────────────

export type ResolveResult =
    /** 現在ライブ配信中。videoId をそのまま埋め込める */
    | { status: 'live'; videoId: string; channelId?: string; channelName?: string }
    /** 取得は成功したが配信していない（予定配信・オフライン） */
    | { status: 'offline'; channelId?: string; channelName?: string }
    /** プロキシ失敗・縮退ページなどで判定できなかった。現在の表示を維持すべき */
    | { status: 'error'; message: string };

/** 識別子から /live ページのURLを組み立てる */
function livePageUrl(identifier: string): string {
    if (isYouTubeChannelId(identifier)) {
        return `https://www.youtube.com/channel/${identifier}/live`;
    }
    const handle = identifier.startsWith('@') ? identifier.slice(1) : identifier;
    return `https://www.youtube.com/@${encodeURIComponent(handle)}/live`;
}

/**
 * チャンネル識別子（@ハンドル または UCチャンネルID）を現在のライブ video ID に解決する。
 * この関数は例外を投げない。判定できなかった場合は status: 'error' を返す。
 */
export async function resolveYouTubeChannel(identifier: string): Promise<ResolveResult> {
    let html: string;
    try {
        html = await fetchViaProxy(livePageUrl(identifier), {
            minLength: 1000,
            isUsable: isUsableYouTubePage,
        });
    } catch (err) {
        console.warn(`[resolveYouTubeChannel] /live fetch failed for ${identifier}:`, err);
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }

    const channelId = extractChannelId(html);
    const channelName = extractChannelName(html);
    const videoId = extractVideoIdFromCanonical(html);

    if (videoId && checkIsLive(html)) {
        return { status: 'live', videoId, channelId, channelName };
    }
    return { status: 'offline', channelId, channelName };
}

/** YouTubeの video ID からチャンネルのハンドルと表示名を取得する */
export async function resolveVideoToChannel(
    videoId: string,
): Promise<{ handle: string | null; channelName?: string } | null> {
    try {
        const html = await fetchViaProxy(`https://www.youtube.com/watch?v=${videoId}`, {
            minLength: 1000,
            isUsable: isUsableYouTubePage,
        });
        const m = html.match(/"canonicalBaseUrl"\s*:\s*"\/@([^"]{1,60})"/);
        return { handle: m ? m[1] : null, channelName: extractChannelName(html) };
    } catch (err) {
        console.warn(`[resolveVideoToChannel] failed for ${videoId}:`, err);
        return null;
    }
}

/**
 * Twitchチャンネルの表示名を取得する。
 * Twitchはライブ配信のURLが静的なのでライブ判定は不要で、表示名だけを取りに行く。
 * 取得できなければ null（呼び出し側はログイン名のまま表示する）。
 */
export async function resolveTwitchChannelName(login: string): Promise<string | null> {
    try {
        const html = await fetchViaProxy(`https://www.twitch.tv/${encodeURIComponent(login)}`, {
            minLength: 500,
        });
        const strip = (s: string) => s.replace(/\s*-\s*Twitch\s*$/i, '').trim();
        const og = html.match(/<meta property="og:title" content="([^"]{1,80})"/);
        if (og) {
            const name = strip(og[1]);
            if (name && name.toLowerCase() !== 'twitch') return name;
        }
        const title = html.match(/<title>([^<]{1,80})<\/title>/);
        if (title) {
            const name = strip(title[1]);
            if (name && name.toLowerCase() !== 'twitch') return name;
        }
        return null;
    } catch (err) {
        console.warn(`[resolveTwitchChannelName] failed for ${login}:`, err);
        return null;
    }
}
