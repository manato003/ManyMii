import React from 'react';

/**
 * 最後の砦。
 *
 * 描画中に例外が出ると React はツリーごと投げ捨て、**白画面**になる。
 * このアプリは状態を localStorage に自動保存しているので、保存済みのデータが
 * 原因で落ちる場合はリロードしても直らず、**手動で localStorage を消すまで
 * 起動できなくなる**（実際に共有コード経由でそうなる不具合があった）。
 *
 * 入口の検証（utils/validate.ts）で防ぐのが本筋で、これはそれを抜けた
 * 想定外に備える保険。**復旧手段をユーザーに見せることが目的**なので、
 * 保存データを消すボタンを必ず置く。
 */

const STORAGE_KEYS = [
    'activeStreams',
    'favorites',
    'streamHistory',
    'appSettings',
    'streamLayouts',
    'panelSections',
    'streamPanelWidth',
    'resolveCache',
    'chatPinned',
    'streamPinned',
];

interface Props {
    children: React.ReactNode;
    locale: 'ja' | 'en';
}

interface State {
    error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[ErrorBoundary]', error, info.componentStack);
    }

    private handleReset = () => {
        for (const key of STORAGE_KEYS) {
            try { localStorage.removeItem(key); } catch { /* ignore */ }
        }
        window.location.reload();
    };

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        const ja = this.props.locale === 'ja';
        return (
            <div className="crash-screen">
                <h1>{ja ? '表示できませんでした' : 'Something went wrong'}</h1>
                <p>
                    {ja
                        ? '保存されたデータが原因の場合、リロードしても直りません。下のボタンで保存データを消すと復旧します。'
                        : 'If saved data caused this, reloading will not help. Clearing the saved data below will recover the app.'}
                </p>
                <pre className="crash-detail">{error.message}</pre>
                <div className="crash-actions">
                    <button className="paste-btn" onClick={() => window.location.reload()}>
                        {ja ? 'リロード' : 'Reload'}
                    </button>
                    <button className="add-btn" onClick={this.handleReset}>
                        {ja ? '保存データを消して復旧' : 'Clear saved data and recover'}
                    </button>
                </div>
                <p className="crash-note">
                    {ja
                        ? '※ 配信リスト・お気に入り・履歴・設定がすべて消えます'
                        : 'This deletes your streams, favorites, history and settings.'}
                </p>
            </div>
        );
    }
}

export default ErrorBoundary;
