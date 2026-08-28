import React, { useState, useMemo } from 'react';
import { X, Copy, Check, Download, AlertTriangle } from 'lucide-react';
import { t } from '../i18n';
import type { Locale } from '../i18n';
import type { Stream, FavoriteNode } from '../types';
import type { HistoryEntry } from '../hooks/useStreamHistory';
import { parseShareCode, type ShareContents } from '../utils/validate';

// ── v2 share format ──────────────────────────────────────────────────────────

type StreamExport = Pick<Stream, 'type' | 'title' | 'sourceId' | 'inputType' | 'channelHandle'>;

interface ShareDataV2 {
    v: 2;
    streams?: StreamExport[];
    favorites?: FavoriteNode[];
    history?: HistoryEntry[];
}

function encode(data: ShareDataV2): string {
    return btoa(encodeURIComponent(JSON.stringify(data)));
}

// ── props ────────────────────────────────────────────────────────────────────

interface ShareModalProps {
    onClose: () => void;
    streams: Stream[];
    favorites: FavoriteNode[];
    history: HistoryEntry[];
    onApplyStreams: (streams: Stream[]) => void;
    onApplyFavorites: (nodes: FavoriteNode[]) => void;
    onApplyHistory: (entries: HistoryEntry[]) => void;
    locale: Locale;
}

// ── component ────────────────────────────────────────────────────────────────

const ShareModal: React.FC<ShareModalProps> = ({
    onClose,
    streams,
    favorites,
    history,
    onApplyStreams,
    onApplyFavorites,
    onApplyHistory,
    locale,
}) => {
    const label = (ja: string, en: string) => locale === 'ja' ? ja : en;

    // export section toggles
    const [includeStreams, setIncludeStreams] = useState(true);
    const [includeFavorites, setIncludeFavorites] = useState(true);
    const [includeHistory, setIncludeHistory] = useState(true);

    // import
    const [importCode, setImportCode] = useState('');
    const [copied, setCopied] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    /** 検証を通ったコードの中身。確認してから適用する */
    const [pending, setPending] = useState<ShareContents | null>(null);

    // compute counts of flat favorites (channels only, for display)
    const favCount = useMemo(() => {
        const count = (nodes: FavoriteNode[]): number =>
            nodes.reduce((acc, n) => acc + (n.kind === 'channel' ? 1 : count(n.children)), 0);
        return count(favorites);
    }, [favorites]);

    // build export code reactively
    const exportCode = useMemo(() => {
        const data: ShareDataV2 = { v: 2 };
        if (includeStreams && streams.length > 0) {
            // YouTubeチャンネル枠は解決後の video ID ではなくハンドルを書き出す。
            // video ID を固定すると、その配信が終わった時点でコードが使い物にならなくなるため。
            data.streams = streams.map(s => ({
                type: s.type,
                title: s.title,
                sourceId: s.channelHandle ?? s.sourceId,
                inputType: s.channelHandle ? 'channel' as const : s.inputType,
                channelHandle: s.channelHandle,
            }));
        }
        if (includeFavorites && favorites.length > 0) {
            data.favorites = favorites;
        }
        if (includeHistory && history.length > 0) {
            data.history = history;
        }
        return encode(data);
    }, [includeStreams, includeFavorites, includeHistory, streams, favorites, history]);

    // 選択されたセクションに実データがあるか
    const hasContent =
        (includeStreams && streams.length > 0) ||
        (includeFavorites && favorites.length > 0) ||
        (includeHistory && history.length > 0);

    const handleCopy = () => {
        navigator.clipboard.writeText(exportCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    /**
     * 読み込みは**上書き**なので、いきなり適用しない。
     * 検証したうえで「何が何件、どこに入るか」を見せ、確認を取ってから適用する。
     * 以前は無警告でお気に入りと履歴を丸ごと置き換えていた。
     */
    const handleCheckCode = () => {
        const code = importCode.trim();
        if (!code) return;
        const parsed = parseShareCode(code);
        if (!parsed) {
            setPending(null);
            setImportError(label('コードを読み取れませんでした', 'Could not read this code'));
            return;
        }
        setImportError(null);
        setPending(parsed);
    };

    const handleApply = () => {
        if (!pending) return;
        if (pending.has.streams) {
            onApplyStreams(pending.streams.map(s => ({ ...s, id: crypto.randomUUID() })));
        }
        if (pending.has.favorites) onApplyFavorites(pending.favorites);
        if (pending.has.history) {
            onApplyHistory(pending.history.map(e => ({ ...e, historyId: crypto.randomUUID() })));
        }
        onClose();
    };

    /** 確認画面に出す「置き換わるもの」の一覧 */
    const pendingRows = pending ? ([
        pending.has.streams ? label(`配信 ${pending.streams.length}件`, `${pending.streams.length} streams`) : null,
        pending.has.favorites ? label(`お気に入り ${pending.favorites.length}件`, `${pending.favorites.length} favorites`) : null,
        pending.has.history ? label(`履歴 ${pending.history.length}件`, `${pending.history.length} history entries`) : null,
    ].filter(Boolean) as string[]) : [];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t(locale, 'shareLayout')}</h2>
                    <button className="icon-button" onClick={onClose}><X size={18} /></button>
                </div>

                {/* ── Export section ──────────────────────────────────── */}
                <div className="form-group">
                    <label className="form-label">{t(locale, 'exportCode')}</label>

                    {/* section toggles */}
                    <div className="share-section-toggles">
                        <label className="share-section-toggle">
                            <input
                                type="checkbox"
                                checked={includeStreams}
                                onChange={e => setIncludeStreams(e.target.checked)}
                            />
                            <span>{label('追加済配信', 'Active Streams')}</span>
                            <span className="share-section-count">({streams.length})</span>
                        </label>
                        <label className="share-section-toggle">
                            <input
                                type="checkbox"
                                checked={includeFavorites}
                                onChange={e => setIncludeFavorites(e.target.checked)}
                            />
                            <span>{label('お気に入り', 'Favorites')}</span>
                            <span className="share-section-count">({favCount})</span>
                        </label>
                        <label className="share-section-toggle">
                            <input
                                type="checkbox"
                                checked={includeHistory}
                                onChange={e => setIncludeHistory(e.target.checked)}
                            />
                            <span>{label('履歴', 'History')}</span>
                            <span className="share-section-count">({history.length})</span>
                        </label>
                    </div>

                    <div className="input-row">
                        <input type="text" className="form-input" readOnly value={hasContent ? exportCode : ''} />
                        <button
                            className="add-btn"
                            onClick={handleCopy}
                            disabled={!hasContent}
                            title={hasContent ? label('コピー', 'Copy') : label('セクションを1つ以上選択してください', 'Select at least one section')}
                            style={!hasContent ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                    </div>
                </div>

                <div className="form-divider"><span>or</span></div>

                {/* ── Import section ──────────────────────────────────── */}
                <div className="form-group">
                    <label className="form-label">{t(locale, 'importCode')}</label>
                    <div className="input-row" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea
                            className="form-input"
                            style={{ minHeight: '80px', resize: 'vertical' }}
                            placeholder={t(locale, 'importPlaceholder')}
                            value={importCode}
                            onChange={e => { setImportCode(e.target.value); setPending(null); setImportError(null); }}
                        />
                        {importError && (
                            <p style={{ fontSize: '0.72rem', color: 'var(--danger)' }}>{importError}</p>
                        )}

                        {pending ? (
                            <div className="import-confirm">
                                <p className="import-confirm-warning">
                                    <AlertTriangle size={13} />
                                    <span>{label('以下を現在の内容と置き換えます。元に戻せません。', 'This replaces your current data. It cannot be undone.')}</span>
                                </p>
                                <ul className="import-confirm-list">
                                    {pendingRows.map(row => <li key={row}>{row}</li>)}
                                </ul>
                                <div className="import-confirm-actions">
                                    <button className="paste-btn" onClick={() => setPending(null)}>
                                        {label('やめる', 'Cancel')}
                                    </button>
                                    <button
                                        className="add-btn add-btn--block"
                                        onClick={handleApply}
                                    >
                                        <Download size={13} />
                                        <span>{label('置き換える', 'Replace')}</span>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                className="primary-button"
                                style={{ width: '100%', justifyContent: 'center' }}
                                onClick={handleCheckCode}
                            >
                                <Download size={14} />
                                {t(locale, 'importCode')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ShareModal;
