// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import AddStreamModal from './AddStreamModal';

/**
 * ペーストボタンの配線。
 * readText() は権限拒否・非対応で必ず例外を投げうるので、
 * 「失敗したことがユーザーに見える」ところまで押さえる。
 */

function setClipboard(impl: () => Promise<string>) {
    Object.defineProperty(navigator, 'clipboard', {
        value: { readText: vi.fn(impl) },
        configurable: true,
    });
}

function setup() {
    const onAdd = vi.fn();
    const utils = render(
        <AddStreamModal
            onClose={() => {}}
            onAdd={onAdd}
            locale="ja"
            addedStreams={[]}
            onRemove={() => {}}
        />,
    );
    const buttons = Array.from(utils.container.querySelectorAll('.paste-btn')) as HTMLElement[];
    return {
        ...utils,
        onAdd,
        singlePaste: buttons[0],
        bulkPaste: buttons[1],
        single: utils.container.querySelector('.input-row .form-input') as HTMLInputElement,
        bulk: utils.container.querySelector('textarea') as HTMLTextAreaElement,
    };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('ペーストボタン', () => {
    it('単一入力と一括入力の両方にボタンがある', () => {
        setClipboard(async () => '');
        const { singlePaste, bulkPaste } = setup();
        expect(singlePaste).toBeTruthy();
        expect(bulkPaste).toBeTruthy();
    });

    it('クリップボードの内容を単一入力欄に入れる', async () => {
        setClipboard(async () => 'https://www.twitch.tv/foo');
        const { singlePaste, single } = setup();

        fireEvent.click(singlePaste);
        await waitFor(() => expect(single.value).toBe('https://www.twitch.tv/foo'));
    });

    it('貼り付けただけでは配信を追加しない（誤爆防止）', async () => {
        setClipboard(async () => 'https://www.twitch.tv/foo');
        const { singlePaste, single, onAdd } = setup();

        fireEvent.click(singlePaste);
        await waitFor(() => expect(single.value).not.toBe(''));
        expect(onAdd).not.toHaveBeenCalled();
    });

    it('単一入力欄には複数行のうち先頭行だけを入れる', async () => {
        setClipboard(async () => 'https://www.twitch.tv/a\nhttps://www.twitch.tv/b');
        const { singlePaste, single } = setup();

        fireEvent.click(singlePaste);
        await waitFor(() => expect(single.value).toBe('https://www.twitch.tv/a'));
    });

    it('一括入力は既存の内容に行を足す（上書きしない）', async () => {
        setClipboard(async () => 'https://www.twitch.tv/b');
        const { bulkPaste, bulk } = setup();

        fireEvent.change(bulk, { target: { value: 'https://www.twitch.tv/a' } });
        fireEvent.click(bulkPaste);

        await waitFor(() =>
            expect(bulk.value).toBe('https://www.twitch.tv/a\nhttps://www.twitch.tv/b'));
    });

    it('一括入力が空なら貼り付けた内容だけになる', async () => {
        setClipboard(async () => 'https://www.twitch.tv/a');
        const { bulkPaste, bulk } = setup();

        fireEvent.click(bulkPaste);
        await waitFor(() => expect(bulk.value).toBe('https://www.twitch.tv/a'));
    });

    it('読み取りに失敗したらエラーを表示する（握りつぶさない）', async () => {
        setClipboard(async () => { throw new Error('NotAllowedError'); });
        const { singlePaste, container } = setup();

        fireEvent.click(singlePaste);
        await waitFor(() =>
            expect(container.textContent).toContain('クリップボードを読み取れませんでした'));
    });

    it('一括入力側の失敗も一括入力側に表示される', async () => {
        setClipboard(async () => { throw new Error('NotAllowedError'); });
        const { bulkPaste, container } = setup();

        fireEvent.click(bulkPaste);
        await waitFor(() =>
            expect(container.textContent).toContain('クリップボードを読み取れませんでした'));
    });

    it('クリップボードが空なら何も入れずエラーを出す', async () => {
        setClipboard(async () => '   ');
        const { singlePaste, single, container } = setup();

        fireEvent.click(singlePaste);
        await waitFor(() =>
            expect(container.textContent).toContain('クリップボードを読み取れませんでした'));
        expect(single.value).toBe('');
    });
});
