import { useState, useCallback } from 'react';
import {
    parseLayoutStore,
    getTemplateFor,
    setTemplateFor,
    setTracksFor,
    tracksFor,
    type LayoutStore,
    type ResolvedLayout,
    type TemplateId,
} from '../utils/layout';

const STORAGE_KEY = 'streamLayouts';

/**
 * 選択中のレイアウトと、境界ドラッグで調整したトラック幅を枠数ごとに保持する。
 *
 * 他の状態と同じく自動保存で、明示的な「保存」操作は作らない（設計思想6）。
 * 保存できなくてもレイアウトが既定に戻るだけなので、失敗は握りつぶす。
 */
export function useStreamLayout(streamCount: number) {
    const [store, setStore] = useState<LayoutStore>(
        () => parseLayoutStore(localStorage.getItem(STORAGE_KEY)),
    );

    const templateId = getTemplateFor(store, streamCount);

    const persist = (next: LayoutStore) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            /* 容量超過やプライベートモード。次回起動で既定に戻るだけ */
        }
        return next;
    };

    const setTemplate = useCallback((id: TemplateId) => {
        // テンプレートを変えると列数・行数が変わるので、調整済みの幅は捨てる
        setStore(prev => persist(setTemplateFor(prev, id)));
    }, []);

    const setTracks = useCallback((tracks: { cols: number[]; rows: number[] }) => {
        setStore(prev => persist(setTracksFor(prev, streamCount, tracks)));
    }, [streamCount]);

    /** 保存済みの幅を base に当ててよいかは tracksFor が判定する（本数が一致するときだけ） */
    const resolveTracks = useCallback(
        (base: ResolvedLayout) => tracksFor(store, streamCount, base),
        [store, streamCount],
    );

    return { templateId, setTemplate, setTracks, resolveTracks };
}
