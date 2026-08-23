import { useState, useCallback } from 'react';
import type { Stream } from '../types';

const HISTORY_KEY = 'streamHistory';
const MAX_HISTORY = 50;

export interface HistoryEntry {
    historyId: string;
    type: Stream['type'];
    title: string;
    sourceId: string;
    inputType: Stream['inputType'];
    displayName?: string;
}

function load(): HistoryEntry[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function save(entries: HistoryEntry[]) {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch { /* ignore */ }
}

export function useStreamHistory() {
    const [history, setHistory] = useState<HistoryEntry[]>(load);

    const addToHistory = useCallback((stream: Stream) => {
        setHistory(prev => {
            const filtered = prev.filter(
                e => !(e.sourceId === stream.sourceId && e.type === stream.type)
            );
            const entry: HistoryEntry = {
                historyId: crypto.randomUUID(),
                type: stream.type,
                title: stream.title,
                sourceId: stream.sourceId,
                inputType: stream.inputType,
                displayName: stream.displayName,
            };
            const next = [entry, ...filtered].slice(0, MAX_HISTORY);
            save(next);
            return next;
        });
    }, []);

    const removeFromHistory = useCallback((historyId: string) => {
        setHistory(prev => {
            const next = prev.filter(e => e.historyId !== historyId);
            save(next);
            return next;
        });
    }, []);

    const reorderHistory = useCallback((fromId: string, toId: string) => {
        setHistory(prev => {
            const arr = [...prev];
            const fi = arr.findIndex(e => e.historyId === fromId);
            const ti = arr.findIndex(e => e.historyId === toId);
            if (fi === -1 || ti === -1) return prev;
            [arr[fi], arr[ti]] = [arr[ti], arr[fi]];
            save(arr);
            return arr;
        });
    }, []);

    /** 表示名が後から判明したときに履歴側へも反映する */
    const setDisplayName = useCallback((type: Stream['type'], sourceId: string, displayName: string) => {
        setHistory(prev => {
            let changed = false;
            const next = prev.map(e => {
                if (e.type === type && e.sourceId === sourceId && e.displayName !== displayName) {
                    changed = true;
                    return { ...e, displayName };
                }
                return e;
            });
            if (!changed) return prev;
            save(next);
            return next;
        });
    }, []);

    const importHistory = useCallback((entries: HistoryEntry[]) => {
        const next = entries.map(e => ({ ...e, historyId: crypto.randomUUID() }));
        save(next);
        setHistory(next);
    }, []);

    return { history, addToHistory, removeFromHistory, reorderHistory, importHistory, setDisplayName };
}
