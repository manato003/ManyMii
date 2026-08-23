export type Locale = 'en' | 'ja';

export interface Translations {
    appTitle: string;
    addStream: string;
    noStreams: string;
    modalTitle: string;
    popout: string;
    closeStream: string;
    language: string;
    reload: string;
    shareLayout: string;
    exportCode: string;
    importCode: string;
    importPlaceholder: string;
    help: string;
    helpTitle: string;
    guideText: string;
}

const en: Translations = {
    appTitle: 'Multistream Nexus',
    addStream: 'Add Stream',
    noStreams: 'Hover top edge to add streams',
    modalTitle: 'Add Stream',
    popout: 'Popout',
    closeStream: 'Close',
    language: 'Language',
    reload: 'Reload',
    shareLayout: 'Share/Import Layout',
    exportCode: 'Export (Copy Code)',
    importCode: 'Import (Apply Code)',
    importPlaceholder: 'Paste layout code here...',
    help: 'Help Guide',
    helpTitle: 'How to use Multistream Nexus',
    guideText: '• Hover top edge → Menu (add streams, settings, share)\n• Hover left edge → Stream panel (reorder, show/hide, favorites, history)\n• Hover right edge → Chat panel (pin 📌 to keep visible)\n• Double-click stream → Fullscreen / restore\n• Drag handle (⋮⋮) to reorder streams or history\n• Paste a share code in bulk input to load streams\n• Settings (⚙) to swap panel sides',
};

const ja: Translations = {
    appTitle: 'マルチストリーム Nexus',
    addStream: '配信を追加',
    noStreams: '画面上端にホバーして配信を追加',
    modalTitle: '配信を追加',
    popout: 'ポップアウト',
    closeStream: '閉じる',
    language: '言語',
    reload: 'リロード',
    shareLayout: 'レイアウト共有・読込',
    exportCode: 'コードを書き出し(コピー)',
    importCode: 'コードから読み込み',
    importPlaceholder: 'ここにレイアウトコードを貼り付けてください...',
    help: '操作ガイド',
    helpTitle: 'Multistream Nexus の使い方',
    guideText: '・画面上端にホバー → メニュー（配信追加・設定・共有）\n・画面左端にホバー → 配信管理パネル（並べ替え・表示切替・お気に入り・履歴）\n・画面右端にホバー → コメントパネル（📌 ピン留めで常時表示）\n・配信枠をダブルクリック → 全画面拡大 / 復帰\n・ハンドル(⋮⋮)をドラッグして配信・履歴を並べ替え\n・まとめて追加欄に共有コードを貼り付けて読み込み可\n・設定(⚙)でパネルの左右配置を入れ替え可',
};

export const translations: Record<Locale, Translations> = { en, ja };

export function t(locale: Locale, key: keyof Translations): string {
    return translations[locale][key];
}
