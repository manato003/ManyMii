/**
 * Resolve a YouTube channel handle (@xxx) to a video ID.
 *
 * Strategy:
 *   1. Fetch youtube.com/@handle/live via CORS proxy
 *   2. Extract video ID from <link rel="canonical">
 *   3. Accept if "isLiveNow":true OR ("isLive":true AND "hlsManifestUrl") is present
 *      - "isLiveNow":true  → standard live stream
 *      - "isLive":true + hlsManifestUrl → 24/7 streams (e.g. news channels)
 *      - hlsManifestUrl alone not checked: only present when actively streaming,
 *        so it guards against scheduled streams that have isLive:true but haven't started
 *   4. Not live → status: 'offline'（オフライン画面を表示。最新動画へのフォールバックはしない）
 *   5. プロキシが全滅した場合は status: 'error'。
 *      「オフライン」と同じ扱いにすると、実際は配信中でも取得に失敗しただけで
 *      「配信していません」と表示されてしまうため、必ず区別する。
 *
 * No API key or backend required.
 * Always fetches fresh data (no localStorage caching).
 */

const PROXIES = [
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

async function fetchViaProxy(targetUrl: string): Promise<string> {
    let lastError: Error | null = null;

    for (const proxyFn of PROXIES) {
        try {
            const proxyUrl = proxyFn(targetUrl);
            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            if (text.length < 100) throw new Error('Response too short (likely empty)');
            return text;
        } catch (err) {
            lastError = err as Error;
            console.warn(`[fetchViaProxy] Proxy failed for ${targetUrl}:`, err);
        }
    }

    throw lastError || new Error('All proxies failed');
}

function extractVideoIdFromCanonical(html: string): string | null {
    // <link rel="canonical" href="https://www.youtube.com/watch?v=VIDEO_ID">
    const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/);
    return m ? m[1] : null;
}

function checkIsLive(html: string): boolean {
    // 通常ライブ
    if (/"isLiveNow"\s*:\s*true/.test(html)) return true;
    // 24/7ストリーム（ニュース等）: isLive:true かつ HLSマニフェストあり（予定配信は hlsManifestUrl を持たない）
    if (/"isLive"\s*:\s*true/.test(html) && /"hlsManifestUrl"/.test(html)) return true;
    return false;
}

export type ResolveResult =
    /** 現在ライブ配信中。videoId をそのまま埋め込める */
    | { status: 'live'; videoId: string }
    /** 取得は成功したが配信していない（予定配信・オフライン） */
    | { status: 'offline' }
    /** プロキシ失敗などで判定できなかった。現在の表示を維持すべき */
    | { status: 'error'; message: string };

/**
 * Resolve a YouTube video ID to the channel handle.
 * Uses allorigins proxy (codetabs returns bot-detection page for /watch URLs).
 * @param videoId - 11-char YouTube video ID
 * @returns channel handle without @ (e.g. "tbsnewsdig"), or null if resolution fails
 */
export async function resolveVideoToChannel(videoId: string): Promise<string | null> {
    try {
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(watchUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) return null;
        const html = await res.text();
        if (html.length < 1000) return null;
        const m = html.match(/"canonicalBaseUrl"\s*:\s*"\/@([^"]+)"/);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

/**
 * Resolve a YouTube channel handle to a live video ID.
 * この関数は例外を投げない。判定できなかった場合は status: 'error' を返す。
 * @param handle - e.g. "@Popo_Ieiri" or "Popo_Ieiri"
 */
export async function resolveYouTubeChannel(handle: string): Promise<ResolveResult> {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

    let html: string;
    try {
        html = await fetchViaProxy(`https://www.youtube.com/@${cleanHandle}/live`);
    } catch (err) {
        // プロキシ全滅。オフラインと区別がつかないので error として返す
        console.warn(`[resolveYouTubeChannel] /live fetch failed:`, err);
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }

    // /live ページから canonical の video ID とライブ指標を読む（予定配信は弾かれる）
    const videoId = extractVideoIdFromCanonical(html);
    if (videoId && checkIsLive(html)) {
        console.log(`[resolveYouTubeChannel] ✓ Live: ${videoId}`);
        return { status: 'live', videoId };
    }

    console.log(`[resolveYouTubeChannel] Not live (no live indicator or no canonical)`);
    return { status: 'offline' };
}
