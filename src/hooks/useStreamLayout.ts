import { useState, useCallback } from 'react';
import {
    parseLayoutStore,
    getTemplateFor,
    setTemplateFor,
    type LayoutStore,
    type TemplateId,
} from '../utils/layout';

const STORAGE_KEY = 'streamLayouts';

/**
 * 選択中のレイアウトテンプレートを枠数ごとに保持する。
 *
 * 他の状態と同じく自動保存で、明示的な「保存」操作は作らない（設計思想6）。
 * 保存できなくてもレイアウトが既定に戻るだけなので、失敗は握りつぶす。
 */
export function useStreamLayout(streamCount: number) {
    const [store, setStore] = useState<LayoutStore>(
        () => parseLayoutStore(localStorage.getItem(STORAGE_KEY)),
    );

    const templateId = getTemplateFor(store, streamCount);

    const setTemplate = useCallback((id: TemplateId) => {
        setStore(prev => {
            const next = setTemplateFor(prev, streamCount, id);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                /* 容量超過やプライベートモード。次回起動で既定に戻るだけ */
            }
            return next;
        });
    }, [streamCount]);

    return { templateId, setTemplate };
}
