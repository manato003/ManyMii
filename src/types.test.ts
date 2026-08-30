import { describe, it, expect } from 'vitest';
import { toDisplayName, isRefreshable } from './types';
import type { Stream } from './types';

const mk = (over: Partial<Stream> = {}): Stream => ({
    id: 'x', type: 'youtube', title: 'YouTube: @foo', sourceId: 'foo', inputType: 'channel', ...over,
});

describe('toDisplayName', () => {
    it('displayName があればそれを使う', () => {
        expect(toDisplayName({ title: 'YouTube: @foo', displayName: 'ふー' })).toBe('ふー');
    });

    it('接頭辞と先頭の @ を落とす', () => {
        expect(toDisplayName({ title: 'YouTube: @foo' })).toBe('foo');
        expect(toDisplayName({ title: 'Twitch: bar' })).toBe('bar');
    });

    it('接頭辞が無ければそのまま', () => {
        expect(toDisplayName({ title: 'plain' })).toBe('plain');
    });

    it('空の displayName は無視して title から導く', () => {
        expect(toDisplayName({ title: 'YouTube: @foo', displayName: '' })).toBe('foo');
    });
});

describe('isRefreshable', () => {
    it('channelHandle が無い枠は再解決できない', () => {
        expect(isRefreshable(mk({ channelHandle: undefined }))).toBe(false);
    });

    it('Twitch の枠は対象外（channelHandle を持たない）', () => {
        expect(isRefreshable(mk({ type: 'twitch', channelHandle: undefined }))).toBe(false);
    });

    it('解決中の枠は対象外（二重に走らせない）', () => {
        expect(isRefreshable(mk({ channelHandle: 'foo', isResolving: true }))).toBe(false);
    });

    it('オフラインの枠は対象', () => {
        expect(isRefreshable(mk({ channelHandle: 'foo', isLive: false }))).toBe(true);
    });

    it('取得失敗の枠は対象', () => {
        expect(isRefreshable(mk({ channelHandle: 'foo', resolveError: true }))).toBe(true);
    });

    // 配信の仕切り直しで video ID が変わると、古い ID の埋め込みは
    // 「配信終了」のサムネイルになる。ライブ中を除外していたため直せなかった
    it('ライブ中の枠も対象にする', () => {
        expect(isRefreshable(mk({ channelHandle: 'foo', isLive: true }))).toBe(true);
    });
});
