import React, { useState, useRef } from 'react';
import { X, Link as LinkIcon, Plus, Trash2, CheckCircle, ClipboardPaste } from 'lucide-react';
import type { Stream } from '../types';
import { t } from '../i18n';
import type { Locale } from '../i18n';
import { parseTwitchInput, parseYouTubeInput } from '../utils/parseInput';

interface AddStreamModalProps {
    onClose: () => void;
    onAdd: (stream: Stream) => void;
    locale: Locale;
    addedStreams: Stream[]; // already added streams to show in list
    onRemove: (id: string) => void;
}

function detectPlatformFromUrl(url: string) {
    const t = url.trim().toLowerCase();
    if (t.includes('twitch.tv')) return { type: 'twitch' as const, parsed: parseTwitchInput(url) };
    if (t.includes('youtube.com') || t.includes('youtu.be')) return { type: 'youtube' as const, parsed: parseYouTubeInput(url) };
    // @handle は YouTube チャンネルとして扱う（全角@も半角に変換）
    const trimmed = url.trim();
    if (trimmed.startsWith('@') || trimmed.startsWith('＠')) {
        const normalized = trimmed.replace(/^＠/, '@'); // 全角@を半角に変換
        return { type: 'youtube' as const, parsed: parseYouTubeInput(normalized) };
    }
    return null;
}

function normalizeHandle(h: string | undefined): string {
    if (!h) return '';
    return h.startsWith('@') ? h.slice(1) : h;
}

/**
 * 共有コードをデコードする。
 * v1 = 配信の配列そのもの / v2 = { v: 2, streams?, favorites?, history? }
 * まとめて追加欄では streams セクションのみを取り込む。
 */
function tryDecodeShareCode(code: string): Omit<Stream, 'id'>[] | null {
    try {
        const decoded = JSON.parse(decodeURIComponent(atob(code.trim())));

        let list: unknown[] | null = null;
        if (Array.isArray(decoded)) {
            list = decoded;                                  // v1
        } else if (decoded && decoded.v === 2) {
            list = Array.isArray(decoded.streams) ? decoded.streams : [];  // v2（配信なしなら空）
        }
        if (!list) return null;

        const isStream = (s: unknown) =>
            typeof s === 'object' && s !== null && 'type' in s && 'sourceId' in s;
        if (!list.every(isStream)) return null;

        return list as Omit<Stream, 'id'>[];
    } catch { return null; }
}

function buildStream(type: 'twitch' | 'youtube', parsed: ReturnType<typeof parseTwitchInput>): Stream {
    // YouTubeチャンネルは channelHandle を持たせないと App 側の解決処理に入らず、
    // ハンドルのまま live_stream 埋め込みに渡されて再生エラーになる
    const isYouTubeChannel = type === 'youtube' && parsed.inputType === 'channel';
    return {
        id: crypto.randomUUID(),
        type,
        title: `${type === 'youtube' ? 'YouTube' : 'Twitch'}: ${parsed.title}`,
        sourceId: parsed.sourceId,
        inputType: parsed.inputType,
        ...(isYouTubeChannel ? { channelHandle: parsed.sourceId, isResolving: true } : {}),
    };
}

const AddStreamModal: React.FC<AddStreamModalProps> = ({ onClose, onAdd, locale, addedStreams, onRemove }) => {
    const [singleInput, setSingleInput] = useState('');
    const [bulkInput, setBulkInput] = useState('');
    const [bulkResults, setBulkResults] = useState<{ ok: number; fail: number } | null>(null);
    const [resolveError, setResolveError] = useState<string | null>(null);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const singleInputRef = useRef<HTMLInputElement>(null);

    // ── クリップボードからの貼り付け ──────────────────────────────────────
    // readText() はユーザー操作起因でないと拒否されるため、必ずクリック
    // ハンドラから直接呼ぶこと。権限拒否・非対応時は例外になるので握りつぶさない。
    const readClipboard = async (): Promise<string | null> => {
        try {
            const text = await navigator.clipboard.readText();
            return text.trim() || null;
        } catch {
            return null;
        }
    };

    const clipboardErrorMessage = locale === 'ja'
        ? 'クリップボードを読み取れませんでした（Ctrl+V で貼り付けてください）'
        : 'Could not read the clipboard (use Ctrl+V instead)';

    /** 貼り付けたら入力欄に入れるだけ。ここで追加まで走らせると誤爆が怖い */
    const pasteSingle = async () => {
        const text = await readClipboard();
        if (!text) { setResolveError(clipboardErrorMessage); return; }
        setResolveError(null);
        // 複数行が入っていても単一入力欄なので先頭行だけ使う
        setSingleInput(text.split(/\r?\n/)[0].trim());
        singleInputRef.current?.focus();
    };

    /** まとめて追加は複数行が前提なので、既存の入力があれば行を足す */
    const pasteBulk = async () => {
        const text = await readClipboard();
        if (!text) { setBulkError(clipboardErrorMessage); return; }
        setBulkError(null);
        setBulkInput(prev => {
            const base = prev.replace(/\s+$/, '');
            return base ? [base, text].join('\n') : text;
        });
    };

    // ── Single add (fully synchronous — resolution is handled in App.tsx) ──
    const addSingle = () => {
        const val = singleInput.trim();
        if (!val) return;
        setResolveError(null);

        const detected = detectPlatformFromUrl(val);
        const type = detected?.type ?? 'twitch';
        const parsed = detected?.parsed ?? parseTwitchInput(val);

        // ── YouTube channel handle (@xxx) ──────────────────────────────
        if (type === 'youtube' && parsed.inputType === 'channel') {
            const handle = parsed.sourceId; // without @
            if (addedStreams.some(s => s.type === 'youtube' && normalizeHandle(s.channelHandle) === handle)) {
                setResolveError(locale === 'ja' ? 'このチャンネルはすでに追加されています' : 'This channel is already added');
                return;
            }
            // Add immediately as a resolving placeholder; App.tsx resolves in background
            onAdd({
                id: crypto.randomUUID(),
                type: 'youtube',
                title: `YouTube: @${handle}`,
                sourceId: handle,
                inputType: 'channel',
                channelHandle: handle,
                isResolving: true,
            });
            setSingleInput('');
            singleInputRef.current?.focus();
            return;
        }

        // ── YouTube video URL ──────────────────────────────────────────
        if (type === 'youtube' && parsed.inputType === 'video') {
            if (addedStreams.some(s => s.type === 'youtube' && s.sourceId === parsed.sourceId)) {
                setResolveError(locale === 'ja' ? 'この動画はすでに追加されています' : 'This video is already added');
                return;
            }
            // Add immediately; App.tsx resolves channel handle in background to update title
            onAdd({
                id: crypto.randomUUID(),
                type: 'youtube',
                title: `YouTube: ${parsed.title}`,
                sourceId: parsed.sourceId,
                inputType: 'video',
            });
            setSingleInput('');
            singleInputRef.current?.focus();
            return;
        }

        // ── Twitch / other ─────────────────────────────────────────────
        if (addedStreams.some(s => s.type === type && s.sourceId === parsed.sourceId)) {
            setResolveError(locale === 'ja' ? 'この配信はすでに追加されています' : 'This stream is already added');
            return;
        }
        onAdd(buildStream(type, parsed));
        setSingleInput('');
        singleInputRef.current?.focus();
    };

    // ── Bulk add ──────────────────────────────────────────────────────────
    const addBulk = () => {
        const raw = bulkInput.trim();
        if (!raw) return;

        // 重複判定キー: YouTubeチャンネルはハンドル、それ以外は sourceId
        const keyOf = (s: { type: string; sourceId: string; channelHandle?: string }) =>
            `${s.type}:${s.channelHandle ?? s.sourceId}`;
        const seen = new Set(addedStreams.map(keyOf));

        const tryAdd = (stream: Stream): boolean => {
            const key = keyOf(stream);
            if (seen.has(key)) return false;   // 単発追加と同様に重複を弾く
            seen.add(key);
            onAdd(stream);
            return true;
        };

        // Single line with no newlines → try share code decode first
        if (!raw.includes('\n')) {
            const shareStreams = tryDecodeShareCode(raw);
            if (shareStreams) {
                let sok = 0, sfail = 0;
                shareStreams.forEach(s => {
                    if (tryAdd({ ...s, id: crypto.randomUUID() })) sok++; else sfail++;
                });
                setBulkInput('');
                setBulkResults({ ok: sok, fail: sfail });
                setTimeout(() => setBulkResults(null), 3000);
                return;
            }
        }

        // Normal URL parsing (one per line)
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        let ok = 0, fail = 0;
        lines.forEach(line => {
            const detected = detectPlatformFromUrl(line);
            if (!detected) { fail++; return; }
            if (tryAdd(buildStream(detected.type, detected.parsed))) ok++; else fail++;
        });
        setBulkResults({ ok, fail });
        setBulkInput('');
        setTimeout(() => setBulkResults(null), 3000);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content add-stream-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t(locale, 'modalTitle')}</h2>
                    <button className="icon-button" onClick={onClose}><X size={18} /></button>
                </div>

                {/* ── Single input ── */}
                <div className="form-group">
                    <label className="form-label">
                        <LinkIcon size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        {locale === 'ja' ? 'URL または チャンネル ID / ハンドル' : 'URL or Channel ID / Handle'}
                    </label>
                    <div className="input-row">
                        <input
                            ref={singleInputRef}
                            type="text"
                            className="form-input"
                            placeholder={locale === 'ja' ? 'URL貼付け or 名前入力、Enterで追加' : 'Paste URL or enter name, Enter to add'}
                            value={singleInput}
                            onChange={e => { setSingleInput(e.target.value); setResolveError(null); }}
                            onKeyDown={e => e.key === 'Enter' && addSingle()}
                            autoFocus
                        />
                        <button
                            className="paste-btn"
                            onClick={() => { void pasteSingle(); }}
                            title={locale === 'ja' ? 'クリップボードから貼り付け' : 'Paste from clipboard'}
                            aria-label={locale === 'ja' ? 'クリップボードから貼り付け' : 'Paste from clipboard'}
                        >
                            <ClipboardPaste size={14} />
                        </button>
                        <button className="add-btn" onClick={addSingle}>
                            <Plus size={14} />
                        </button>
                    </div>
                    {resolveError && (
                        <p style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '4px' }}>
                            {resolveError}
                        </p>
                    )}
                </div>

                <div className="form-divider"><span>{locale === 'ja' ? 'まとめて追加' : 'bulk add'}</span></div>

                {/* ── Bulk input ── */}
                <div className="form-group">
                    <label className="form-label">
                        {locale === 'ja' ? '複数URLを1行ずつ貼り付け' : 'Paste multiple URLs, one per line'}
                    </label>
                    <textarea
                        className="form-input"
                        style={{ minHeight: '72px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.75rem' }}
                        placeholder={locale === 'ja'
                            ? 'https://www.twitch.tv/xxx\nhttps://www.youtube.com/watch?v=xxx\n共有コード（1行）も貼り付け可'
                            : 'https://www.twitch.tv/xxx\nhttps://www.youtube.com/watch?v=xxx\nShare code (single line) also accepted'
                        }
                        value={bulkInput}
                        onChange={e => { setBulkInput(e.target.value); setBulkError(null); }}
                    />
                    {bulkError && (
                        <p style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '4px' }}>
                            {bulkError}
                        </p>
                    )}
                    <div className="bulk-actions">
                        <button
                            className="paste-btn"
                            onClick={() => { void pasteBulk(); }}
                            title={locale === 'ja' ? 'クリップボードから貼り付け' : 'Paste from clipboard'}
                            aria-label={locale === 'ja' ? 'クリップボードから貼り付け' : 'Paste from clipboard'}
                        >
                            <ClipboardPaste size={14} />
                        </button>
                        <button
                            className="add-btn add-btn--block"
                            onClick={addBulk}
                            disabled={!bulkInput.trim()}
                        >
                            <Plus size={14} />
                            <span>{locale === 'ja' ? 'まとめて追加' : 'Add All'}</span>
                        </button>
                        {bulkResults && (
                            <span className={`bulk-result${bulkResults.fail > 0 ? ' has-skipped' : ''}`}>
                                <CheckCircle size={12} />
                                {locale === 'ja'
                                    ? `${bulkResults.ok}件追加${bulkResults.fail > 0 ? `、${bulkResults.fail}件スキップ` : ''}`
                                    : `${bulkResults.ok} added${bulkResults.fail > 0 ? `, ${bulkResults.fail} skipped` : ''}`
                                }
                            </span>
                        )}
                    </div>
                </div>

                {/* ── Added streams list ── */}
                {addedStreams.length > 0 && (
                    <>
                        <div className="form-divider">
                            <span>{locale === 'ja' ? `追加済み (${addedStreams.length})` : `Added (${addedStreams.length})`}</span>
                        </div>
                        <div className="added-streams-list">
                            {addedStreams.map(s => (
                                <div key={s.id} className="added-stream-item">
                                    <span className={`platform-dot ${s.type}`} style={{ flexShrink: 0 }} />
                                    <span className="added-stream-title">{s.title}</span>
                                    <button className="added-stream-remove" onClick={() => onRemove(s.id)} title={t(locale, 'closeStream')}>
                                        <Trash2 size={11} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default AddStreamModal;
