import { useEffect } from 'react';

interface ShortcutHandlers {
    onAddStream: () => void;
    onOpenSettings: () => void;
    onOpenHelp: () => void;
    onToggleChatPin: () => void;
    onCloseModal: () => void;
}

/**
 * グローバルキーボードショートカット
 *   A       → 配信追加モーダル
 *   ,       → 設定モーダル
 *   ?       → ヘルプモーダル
 *   P       → チャットピン留め切替
 *   Escape  → 開いているモーダルを閉じる
 *
 * input / textarea / contenteditable にフォーカス中はスキップ
 * Ctrl / Cmd / Alt との組み合わせ（Ctrl+A の全選択など）もスキップ
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
    const {
        onAddStream,
        onOpenSettings,
        onOpenHelp,
        onToggleChatPin,
        onCloseModal,
    } = handlers;

    useEffect(() => {
        const handle = (e: KeyboardEvent) => {
            // ブラウザ標準のショートカット（Ctrl+A 全選択、Cmd+P 印刷など）を奪わない
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            const el = e.target as HTMLElement;
            if (
                el.tagName === 'INPUT' ||
                el.tagName === 'TEXTAREA' ||
                el.isContentEditable
            ) return;

            switch (e.key) {
                case 'a':
                case 'A':
                    e.preventDefault();
                    onAddStream();
                    break;
                case ',':
                    e.preventDefault();
                    onOpenSettings();
                    break;
                case '?':
                    e.preventDefault();
                    onOpenHelp();
                    break;
                case 'p':
                case 'P':
                    e.preventDefault();
                    onToggleChatPin();
                    break;
                case 'Escape':
                    onCloseModal();
                    break;
            }
        };

        window.addEventListener('keydown', handle);
        return () => window.removeEventListener('keydown', handle);
    }, [onAddStream, onOpenSettings, onOpenHelp, onToggleChatPin, onCloseModal]);
}
