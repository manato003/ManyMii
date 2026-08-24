// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHoverPanel } from './useHoverPanel';

/**
 * ピン留めの挙動は純粋関数テストでは守れない。
 * 実際に「ピン留めしてもマウスアウトで隠れる」回帰を取り逃したため、
 * ここでフックの契約を固定する。
 */

const HIDE_DELAY = 500;
const IDLE_TIMEOUT = 5000;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** window/document のイベントは act で包まないと state 更新が反映されない */
function dispatch(target: Window | Document, event: Event) {
    act(() => { target.dispatchEvent(event); });
}

function advance(ms: number) {
    act(() => { vi.advanceTimersByTime(ms); });
}

describe('useHoverPanel（ピン留めなし）', () => {
    it('初期状態は非表示', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT }));
        expect(result.current.visible).toBe(false);
    });

    it('show() で表示される', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT }));
        act(() => { result.current.show(); });
        expect(result.current.visible).toBe(true);
    });

    it('scheduleHide() は hideDelay 経過後に隠す（経過前は表示のまま）', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT }));
        act(() => { result.current.show(); });
        act(() => { result.current.scheduleHide(); });

        advance(HIDE_DELAY - 1);
        expect(result.current.visible).toBe(true);

        advance(1);
        expect(result.current.visible).toBe(false);
    });

    it('scheduleHide() の予約中に show() すると隠れない', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT }));
        act(() => { result.current.show(); });
        act(() => { result.current.scheduleHide(); });
        advance(HIDE_DELAY - 100);
        act(() => { result.current.show(); });

        advance(HIDE_DELAY);
        expect(result.current.visible).toBe(true);
    });

    it('マウスが idleTimeout 静止すると自動的に隠れる', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT }));
        act(() => { result.current.show(); });

        advance(IDLE_TIMEOUT - 1);
        expect(result.current.visible).toBe(true);

        advance(1);
        expect(result.current.visible).toBe(false);
    });

    it('マウスが動いている間は idle タイマーが延長される', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT }));
        act(() => { result.current.show(); });

        advance(IDLE_TIMEOUT - 100);
        dispatch(window, new MouseEvent('mousemove'));
        advance(IDLE_TIMEOUT - 100);

        expect(result.current.visible).toBe(true);
    });

    it('ブラウザウィンドウ外へマウスが出ると隠れる', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT }));
        act(() => { result.current.show(); });

        // relatedTarget が null＝ウィンドウの外へ出た
        dispatch(document, new MouseEvent('mouseleave', { relatedTarget: null }));
        advance(HIDE_DELAY);

        expect(result.current.visible).toBe(false);
    });

    it('要素間の移動（relatedTarget あり）では隠れない', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT }));
        act(() => { result.current.show(); });

        dispatch(document, new MouseEvent('mouseleave', { relatedTarget: document.body }));
        advance(HIDE_DELAY);

        expect(result.current.visible).toBe(true);
    });
});

describe('useHoverPanel（ピン留めあり）', () => {
    it('isPinned=true なら show() を呼ばなくても表示される', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT, isPinned: true }));
        expect(result.current.visible).toBe(true);
    });

    it('isPinned=true なら scheduleHide() しても隠れない', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT, isPinned: true }));
        act(() => { result.current.scheduleHide(); });
        advance(HIDE_DELAY * 10);
        expect(result.current.visible).toBe(true);
    });

    it('isPinned=true なら idleTimeout が経過しても隠れない', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT, isPinned: true }));
        act(() => { result.current.show(); });
        advance(IDLE_TIMEOUT * 3);
        expect(result.current.visible).toBe(true);
    });

    it('isPinned=true ならウィンドウ外にマウスが出ても隠れない', () => {
        const { result } = renderHook(() => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT, isPinned: true }));
        dispatch(document, new MouseEvent('mouseleave', { relatedTarget: null }));
        advance(HIDE_DELAY * 10);
        expect(result.current.visible).toBe(true);
    });

    it('非表示の予約中にピン留めすると予約が取り消される', () => {
        const { result, rerender } = renderHook(
            ({ isPinned }) => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT, isPinned }),
            { initialProps: { isPinned: false } },
        );
        act(() => { result.current.show(); });
        act(() => { result.current.scheduleHide(); });

        advance(HIDE_DELAY - 100);
        rerender({ isPinned: true });
        advance(HIDE_DELAY * 10);

        expect(result.current.visible).toBe(true);
    });

    it('ピン留めを解除すると通常のホバー挙動に戻る', () => {
        const { result, rerender } = renderHook(
            ({ isPinned }) => useHoverPanel({ hideDelay: HIDE_DELAY, idleTimeout: IDLE_TIMEOUT, isPinned }),
            { initialProps: { isPinned: true } },
        );
        expect(result.current.visible).toBe(true);

        rerender({ isPinned: false });
        act(() => { result.current.scheduleHide(); });
        advance(HIDE_DELAY);

        expect(result.current.visible).toBe(false);
    });
});
