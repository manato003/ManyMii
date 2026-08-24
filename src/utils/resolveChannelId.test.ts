import { describe, it, expect } from 'vitest';
import { parseChannelPage, parseWatchPage } from './resolveChannelId';

/**
 * フィクスチャは実際の ytInitialData の形を縮めたもの。
 * 「一度実装を間違えた罠」を必ず含めること（下の watch ページの順序など）。
 */

const head = (name: string) =>
    `<html><head><meta property="og:title" content="${name}">` +
    `<link rel="canonical" href="undefined"></head><body>` +
    `<script>var ytInitialData = {"header":{"pageHeaderRenderer":{}},` +
    `"metadata":{"channelMetadataRenderer":{"externalId":"UC-WX1CXssCtCtc2TNIRnJzg"}},`;

const featuredLive = (videoId: string, withTargetId: boolean) =>
    `"contents":[{"channelFeaturedContentRenderer":{"items":[{"lockupViewModel":{` +
    `"contentImage":{"thumbnailViewModel":{"image":{"sources":[` +
    `{"url":"https://i.ytimg.com/vi/${videoId}/hqdefault.jpg?v=6a8a9c55","width":336,"height":188}]},` +
    `"overlays":[{"thumbnailBottomOverlayViewModel":{"badges":[{"thumbnailBadgeViewModel":{` +
    `"icon":{"sources":[{"clientResource":{"imageName":"LIVE"}}]},"text":"LIVE",` +
    `"badgeStyle":"THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"` +
    (withTargetId ? `,"animationActivationTargetId":"${videoId}"` : ``) +
    `}}]}}]}}}}]}}]`;

const featuredNotLive = (videoId: string) =>
    `"contents":[{"channelFeaturedContentRenderer":{"items":[{"lockupViewModel":{` +
    `"contentImage":{"thumbnailViewModel":{"image":{"sources":[` +
    `{"url":"https://i.ytimg.com/vi/${videoId}/hqdefault.jpg"}]},` +
    `"overlays":[{"thumbnailBottomOverlayViewModel":{"badges":[{"thumbnailBadgeViewModel":{` +
    `"text":"12:34","badgeStyle":"THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT"}}]}}]}}}}]}}]`;

const tail = `};</script></body></html>`;

describe('parseChannelPage', () => {
    it('注目コンテンツがライブなら video ID を返す', () => {
        const info = parseChannelPage(head('紡木こかげ') + featuredLive('kvAsk9cf4n4', true) + tail);
        expect(info.videoId).toBe('kvAsk9cf4n4');
        expect(info.channelName).toBe('紡木こかげ');
        expect(info.channelId).toBe('UC-WX1CXssCtCtc2TNIRnJzg');
    });

    it('animationActivationTargetId がなければサムネイルURLから拾う', () => {
        const info = parseChannelPage(head('紡木こかげ') + featuredLive('kvAsk9cf4n4', false) + tail);
        expect(info.videoId).toBe('kvAsk9cf4n4');
    });

    it('注目コンテンツがない（=配信していない）ときは null', () => {
        const info = parseChannelPage(head('家入ポポ / Popo Channel【ななしいんく】') + `"contents":[]` + tail);
        expect(info.videoId).toBeNull();
        // 配信していなくても表示名とチャンネルIDは取れる
        expect(info.channelName).toBe('家入ポポ / Popo Channel【ななしいんく】');
        expect(info.channelId).toBe('UC-WX1CXssCtCtc2TNIRnJzg');
    });

    it('注目コンテンツが通常動画（LIVEバッジなし）なら null', () => {
        const info = parseChannelPage(head('紡木こかげ') + featuredNotLive('CTFmzc2g4LU') + tail);
        expect(info.videoId).toBeNull();
    });

    it('何も取れなくても例外を投げない', () => {
        const info = parseChannelPage('<html></html>');
        expect(info.videoId).toBeNull();
        expect(info.channelName).toBeUndefined();
    });
});

/**
 * watch ページの罠:
 * 文書内では最初の "videoOwnerRenderer" のほうが videoPrimaryInfoRenderer（動画タイトル）
 * より先に出現する。videoOwnerRenderer を起点に「次の title.runs[0].text」を取る実装だと
 * チャンネル名ではなく動画タイトルを拾ってしまう（実際に一度そう実装して失敗した）。
 */
const watchPage = (opts: { withChannelLink: boolean }) =>
    `<html><head><link rel="canonical" href="undefined"></head><body><script>` +
    `var ytInitialPlayerResponse = {"videoDetails":{"videoId":"oH4JN3aR4mQ"}};` +
    `var ytInitialData = {"contents":{"twoColumnWatchNextResults":{"results":{"contents":[` +
    // ① 先に出現する videoOwnerRenderer（タイトルを持たない）
    `{"videoOwnerRenderer":{"thumbnail":{"thumbnails":[{"url":"https://yt3.ggpht.com/x=s48"}]}}},` +
    // ② 動画タイトル ← 素朴な実装がこれを拾ってしまう
    `{"videoPrimaryInfoRenderer":{"title":{"runs":[{"text":"【アークナイツ】また会えるのかアルダシル【藍沢エマ】"}]}}},` +
    // ③ 本命: 表示名・チャンネルID・ハンドルが隣接している
    `{"videoSecondaryInfoRenderer":{"owner":{"videoOwnerRenderer":{` +
    (opts.withChannelLink
        ? `"title":{"runs":[{"text":"藍沢エマ / Aizawa Ema","navigationEndpoint":` +
          `{"commandMetadata":{"webCommandMetadata":{"url":"/@AizawaEma"}},` +
          `"browseEndpoint":{"browseId":"UCPkKpOHxEDcwmUAnRpIu-Ng","canonicalBaseUrl":"/@AizawaEma"}}}]}`
        : `"channelId":"UCPkKpOHxEDcwmUAnRpIu-Ng","canonicalBaseUrl":"/@AizawaEma"`) +
    `}}}}]}}}};</script></body></html>`;

describe('parseWatchPage', () => {
    it('動画タイトルではなくチャンネル表示名を返す', () => {
        const info = parseWatchPage(watchPage({ withChannelLink: true }));
        expect(info.channelName).toBe('藍沢エマ / Aizawa Ema');
        expect(info.channelName).not.toContain('アークナイツ');
        expect(info.handle).toBe('AizawaEma');
        expect(info.channelId).toBe('UCPkKpOHxEDcwmUAnRpIu-Ng');
    });

    it('構造が変わっていてもハンドルとチャンネルIDは拾う（表示名は諦める）', () => {
        const info = parseWatchPage(watchPage({ withChannelLink: false }));
        expect(info.handle).toBe('AizawaEma');
        expect(info.channelId).toBe('UCPkKpOHxEDcwmUAnRpIu-Ng');
        expect(info.channelName).toBeUndefined();
    });

    it('何も取れなくても例外を投げない', () => {
        const info = parseWatchPage('<html></html>');
        expect(info.handle).toBeNull();
        expect(info.channelId).toBeUndefined();
    });
});
