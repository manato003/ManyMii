// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
import ChatSidePanel from './ChatSidePanel';
import type { Stream } from '../types';

/**
 * 実際に取り逃した回帰の再発防止。
 * ChatSidePanel が useHoverPanel に isPinned を渡し忘れると、ピン留めしても
 * マウスアウトでパネルが隠れ、app-main の余白だけが残る状態になる。
 * フックのテストだけでは配線の欠落は検出できないため、ここで押さえる。
 */

const HIDE_DELAY = 500;

function makeStream(over: Partial<Stream> = {}): Stream {
    return {
        id: 's1',
        type: 'twitch',
        title: 'Twitch: tototmix',
        sourceId: 'tototmix',
        inputType: 'channel',
        ...over,
    };
}

function setup(isPinned: boolean, streams: Stream[] = [makeStream()]) {
    const utils = render(
        <ChatSidePanel
            streams={streams}
            locale="ja"
            isPinned={isPinned}
            onPinChange={() => {}}
            hideDelay={HIDE_DELAY}
        />,
    );
    const panel = utils.container.querySelector('.chat-panel') as HTMLElement;
    return { ...utils, panel };
}

function advance(ms: number) {
    act(() => { vi.advanceTimersByTime(ms); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ChatSidePanel の表示・非表示', () => {
    it('ピン留めなしなら初期状態で隠れている', () => {
        const { panel } = setup(false);
        expect(panel.classList.contains('visible')).toBe(false);
    });

    it('ホバーで表示され、マウスアウトで hideDelay 後に隠れる', () => {
        const { panel } = setup(false);

        fireEvent.mouseEnter(panel);
        expect(panel.classList.contains('visible')).toBe(true);

        fireEvent.mouseLeave(panel);
        advance(HIDE_DELAY);
        expect(panel.classList.contains('visible')).toBe(false);
    });

    it('ピン留め中は初期状態から表示されている', () => {
        const { panel } = setup(true);
        expect(panel.classList.contains('visible')).toBe(true);
    });

    it('ピン留め中はマウスアウトしても表示されたままになる', () => {
        const { panel } = setup(true);

        fireEvent.mouseEnter(panel);
        fireEvent.mouseLeave(panel);
        advance(HIDE_DELAY * 10);

        expect(panel.classList.contains('visible')).toBe(true);
    });

    it('ピン留め中はマウスが静止しても隠れない', () => {
        const { panel } = setup(true);
        fireEvent.mouseEnter(panel);
        advance(30000);
        expect(panel.classList.contains('visible')).toBe(true);
    });
});

describe('ChatSidePanel のチャンネル選択', () => {
    const twitch = makeStream({ id: 'a', sourceId: 'aaa', displayName: 'ちゃんねるA' });
    const youtube = makeStream({
        id: 'b', type: 'youtube', inputType: 'video',
        sourceId: 'vvvvvvvvvvv', title: 'YouTube: vvvvvvvvvvv',
        displayName: 'ちゃんねるB', isLive: true,
    });

    it('未選択のときは先頭のチャンネルが選ばれる', () => {
        setup(true, [twitch, youtube]);
        expect(screen.getByText('ちゃんねるA')).toBeTruthy();
    });

    it('選択中の配信が閉じられたら残った先頭に切り替わる', () => {
        const { rerender, container } = render(
            <ChatSidePanel streams={[twitch, youtube]} locale="ja" isPinned onPinChange={() => {}} hideDelay={HIDE_DELAY} />,
        );
        expect(container.querySelector('.chat-selector-title')?.textContent).toBe('ちゃんねるA');

        // twitch を閉じる
        rerender(
            <ChatSidePanel streams={[youtube]} locale="ja" isPinned onPinChange={() => {}} hideDelay={HIDE_DELAY} />,
        );
        expect(container.querySelector('.chat-selector-title')?.textContent).toBe('ちゃんねるB');
    });

    it('チャット非対応の配信（オフラインのYouTube）は候補に出ない', () => {
        const offline = makeStream({
            id: 'c', type: 'youtube', inputType: 'video',
            sourceId: 'wwwwwwwwwww', title: 'YouTube: wwwwwwwwwww',
            displayName: 'オフライン', isLive: false,
        });
        const { container } = setup(true, [offline]);
        expect(container.querySelector('.chat-panel-no-streams')).not.toBeNull();
    });

    it('チャット対応の配信が無いときは空状態を出す', () => {
        const { container } = setup(true, []);
        expect(container.querySelector('.chat-panel-no-streams')).not.toBeNull();
        expect(container.querySelector('iframe')).toBeNull();
    });

    it('ピン留めボタンのクリックで onPinChange が反転値で呼ばれる', () => {
        const onPinChange = vi.fn();
        const { container } = render(
            <ChatSidePanel streams={[twitch]} locale="ja" isPinned onPinChange={onPinChange} hideDelay={HIDE_DELAY} />,
        );
        fireEvent.click(container.querySelector('.chat-panel-pin') as HTMLElement);
        expect(onPinChange).toHaveBeenCalledWith(false);
    });
});
