import React, { useState, useMemo } from 'react';
import { X, Copy, Check, Download } from 'lucide-react';
import { t } from '../i18n';
import type { Locale } from '../i18n';
import type { Stream, FavoriteNode } from '../types';
import type { HistoryEntry } from '../hooks/useStreamHistory';

// ── v2 share format ──────────────────────────────────────────────────────────

type StreamExport = Pick<Stream, 'type' | 'title' | 'sourceId' | 'inputType' | 'startTime' | 'channelHandle'>;

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
                startTime: s.startTime,
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

    const handleImport = () => {
        if (!importCode.trim()) return;
        try {
            const decoded = JSON.parse(decodeURIComponent(atob(importCode.trim())));

            if (Array.isArray(decoded)) {
                // v1 backward compat: plain stream array
                const newStreams: Stream[] = decoded.map((s: StreamExport) => ({
                    ...s,
                    id: crypto.randomUUID(),
                }));
                onApplyStreams(newStreams);
            } else if (decoded && decoded.v === 2) {
                // v2: apply each present section
                const d = decoded as ShareDataV2;
                if (d.streams) {
                    const newStreams: Stream[] = d.streams.map((s: StreamExport) => ({
                        ...s,
                        id: crypto.randomUUID(),
                    }));
                    onApplyStreams(newStreams);
                }
                if (d.favorites) {
                    onApplyFavorites(d.favorites);
                }
                if (d.history) {
                    onApplyHistory(d.history);
                }
            } else {
                throw new Error('Unknown format');
            }
            onClose();
        } catch (e) {
            console.error('Import error:', e);
            alert(label('無効なコードです', 'Invalid layout code!'));
        }
    };

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
                            onChange={e => setImportCode(e.target.value)}
                        />
                        <button
                            className="primary-button"
                            style={{ width: '100%', justifyContent: 'center' }}
                            onClick={handleImport}
                        >
                            <Download size={14} />
                            {t(locale, 'importCode')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ShareModal;
