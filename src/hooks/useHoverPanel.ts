import { useState, useCallback, useRef, useEffect } from 'react';

interface UseHoverPanelOptions {
    hideDelay?: number;   // mouseleave 後に隠すまでの遅延 (default: 500ms)
    idleTimeout?: number; // マウス静止で自動非表示になるまでの時間 (default: 5000ms)
    isPinned?: boolean;   // true のとき常時表示（hide しない）
}

/**
 * サイドパネルのホバー表示ロジックを共通化するフック。
 * - show / scheduleHide でパネルの表示・非表示を制御
 * - ブラウザウィンドウ外にマウスが出たとき自動的に scheduleHide を呼ぶ
 * - マウスが idleTimeout ミリ秒静止したとき自動的に非表示にする
 * - isPinned=true のとき常時表示、hide 系の処理をスキップ
 */
export function useHoverPanel({ hideDelay = 500, idleTimeout = 5000, isPinned = false }: UseHoverPanelOptions = {}) {
    const [visible, setVisible] = useState(false);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearHideTimer = () => {
        if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    };
    const clearIdleTimer = () => {
        if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    };

    // ピン留め中は state に関係なく表示する（描画時に導出し、effect で setState しない）
    const isVisible = visible || isPinned;

    // ピン留めされたら予約済みの非表示処理を取り消す
    useEffect(() => {
        if (!isPinned) return;
        clearHideTimer();
        clearIdleTimer();
    }, [isPinned]);

    const show = useCallback(() => {
        clearHideTimer();
        setVisible(true);
    }, []);

    const scheduleHide = useCallback(() => {
        if (isPinned) return; // ピン留め中は hide しない
        clearHideTimer();
        hideTimerRef.current = setTimeout(() => setVisible(false), hideDelay);
    }, [hideDelay, isPinned]);

    // ブラウザウィンドウ外にマウスが出たら scheduleHide（ピン留め時はスキップ）
    useEffect(() => {
        if (isPinned) return;
        const onMouseLeave = (e: MouseEvent) => {
            if (!e.relatedTarget) scheduleHide();
        };
        document.addEventListener('mouseleave', onMouseLeave);
        return () => document.removeEventListener('mouseleave', onMouseLeave);
    }, [scheduleHide, isPinned]);

    // マウスが idleTimeout ms 静止したら自動非表示（ピン留め時はスキップ）
    useEffect(() => {
        if (isPinned) return;
        if (!isVisible) {
            clearIdleTimer();
            return;
        }
        const resetIdle = () => {
            clearIdleTimer();
            idleTimerRef.current = setTimeout(() => setVisible(false), idleTimeout);
        };
        resetIdle(); // パネルが表示された瞬間からカウント開始
        window.addEventListener('mousemove', resetIdle);
        return () => {
            window.removeEventListener('mousemove', resetIdle);
            clearIdleTimer();
        };
    }, [isVisible, idleTimeout, isPinned]);

    return { visible: isVisible, show, scheduleHide };
}
