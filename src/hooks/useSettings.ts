import { useState, useCallback } from 'react';

export interface AppSettings {
    /** default: 配信管理=左, コメント=右 / swapped: 配信管理=右, コメント=左 */
    panelLayout: 'default' | 'swapped';
    /** ヘッダーを常時表示（false: 自動非表示） */
    headerAlwaysVisible: boolean;
    /** チャットパネル幅 (px) */
    chatWidth: 240 | 280 | 340;
    /** パネルのホバー感度 → useHoverPanel の hideDelay にマッピング */
    panelSensitivity: 'slow' | 'normal' | 'fast';
    /**
     * オフライン枠のライブ状態を定期的に自動再確認する。
     * 1回の確認でチャンネルページ（1〜2.7MB）を取得するため既定はOFF。
     */
    autoRefreshOffline: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
    panelLayout: 'default',
    headerAlwaysVisible: false,
    chatWidth: 280,
    panelSensitivity: 'normal',
    autoRefreshOffline: false,
};
const STORAGE_KEY = 'appSettings';

type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;

export function useSettings(): [AppSettings, UpdateSetting] {
    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    });

    const updateSetting: UpdateSetting = useCallback((key, value) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
        });
    }, []);

    return [settings, updateSetting];
}
