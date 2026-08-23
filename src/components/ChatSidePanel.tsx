import React, { useState, useEffect, useMemo } from 'react';
import { MessageSquare, Pin, ChevronDown } from 'lucide-react';
import type { Stream } from '../types';
import { toDisplayName } from '../types';
import type { Locale } from '../i18n';
import { useHoverPanel } from '../hooks/useHoverPanel';

interface ChatSidePanelProps {
    streams: Stream[];
    locale: Locale;
    isPinned: boolean;
    onPinChange: (pinned: boolean) => void;
    swapped?: boolean;
    hideDelay?: number;
}

function getChatUrl(stream: Stream): string | null {
    const domain = window.location.hostname || 'localhost';
    if (stream.type === 'twitch' && stream.inputType === 'channel') {
        return `https://www.twitch.tv/embed/${stream.sourceId}/chat?parent=${domain}&darkpopout`;
    }
    if (
        stream.type === 'youtube' &&
        stream.inputType === 'video' &&
        stream.isLive !== false &&
        !stream.isResolving
    ) {
        return `https://www.youtube.com/live_chat?v=${stream.sourceId}&embed_domain=${domain}`;
    }
    return null;
}

const ChatSidePanel: React.FC<ChatSidePanelProps> = ({ streams, locale, isPinned, onPinChange, swapped = false, hideDelay = 500 }) => {
    const { visible, show, scheduleHide } = useHoverPanel({ hideDelay, idleTimeout: 5000 });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isSelectorExpanded, setIsSelectorExpanded] = useState(false);

    const label = (ja: string, en: string) => locale === 'ja' ? ja : en;

    const isVisible = visible || isPinned;

    // ── チャット表示可能なストリームのみ絞り込む ───────────────────────────
    const chatStreams = useMemo(
        () => streams.filter(s => getChatUrl(s) !== null),
        [streams],
    );

    // 選択中のストリームが削除されたら選択解除
    useEffect(() => {
        if (selectedId && !chatStreams.find(s => s.id === selectedId)) {
            setSelectedId(null);
            setIsSelectorExpanded(false);
        }
    }, [chatStreams, selectedId]);

    // パネルが表示されたとき、未選択なら先頭を自動選択
    useEffect(() => {
        if (isVisible && selectedId === null && chatStreams.length > 0) {
            setSelectedId(chatStreams[0].id);
        }
    }, [isVisible, chatStreams, selectedId]);

    const selectedStream = chatStreams.find(s => s.id === selectedId) ?? null;
    const chatUrl = selectedStream ? getChatUrl(selectedStream) : null;

    const handleSelectChannel = (id: string) => {
        setSelectedId(id);
        setIsSelectorExpanded(false);
    };

    const showCollapsed = selectedStream !== null && !isSelectorExpanded;

    return (
        <>
            {/* 右端（swapped 時は左端）の 6px ホバートリガー領域 */}
            <div
                className={`chat-panel-trigger${swapped ? ' left' : ''}`}
                onMouseEnter={show}
                onMouseLeave={scheduleHide}
            />

            <div
                className={`chat-panel${isVisible ? ' visible' : ''}${swapped ? ' left' : ''}`}
                onMouseEnter={show}
                onMouseLeave={scheduleHide}
            >
                {/* ヘッダー */}
                <div className="chat-panel-header">
                    <MessageSquare size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                    <span className="chat-panel-title">
                        {label('コメント', 'Chat')}
                    </span>
                    <button
                        className={`chat-panel-pin${isPinned ? ' active' : ''}`}
                        onClick={() => onPinChange(!isPinned)}
                        title={isPinned ? label('ピン解除', 'Unpin') : label('ピン留め', 'Pin')}
                    >
                        <Pin size={13} />
                    </button>
                </div>

                {/* チャンネルセレクター */}
                {chatStreams.length > 0 ? (
                    showCollapsed ? (
                        /* 折りたたみ表示: 選択中チャンネル + 展開ボタン */
                        <div className="chat-panel-selector collapsed">
                            <button
                                className="chat-selector-active"
                                onClick={() => setIsSelectorExpanded(true)}
                                title={label('チャンネルを変更', 'Change channel')}
                            >
                                <span className={`platform-dot ${selectedStream.type}`} style={{ flexShrink: 0 }} />
                                <span className="chat-selector-title">{toDisplayName(selectedStream)}</span>
                                <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                            </button>
                        </div>
                    ) : (
                        /* 展開表示: チャンネル一覧 */
                        <div className="chat-panel-selector">
                            {chatStreams.map(s => (
                                <button
                                    key={s.id}
                                    className={`chat-selector-item ${selectedId === s.id ? 'active' : ''}`}
                                    onClick={() => handleSelectChannel(s.id)}
                                >
                                    <span className={`platform-dot ${s.type}`} style={{ flexShrink: 0 }} />
                                    <span className="chat-selector-title">{toDisplayName(s)}</span>
                                </button>
                            ))}
                        </div>
                    )
                ) : (
                    <div className="chat-panel-selector">
                        <p className="chat-panel-no-streams">
                            {label('ライブ配信がありません', 'No live streams')}
                        </p>
                    </div>
                )}

                {/* チャット iframe / 空状態 */}
                <div className="chat-panel-content">
                    {chatUrl ? (
                        <iframe
                            key={chatUrl}
                            src={chatUrl}
                            title={label('チャット', 'Chat')}
                            allow="autoplay"
                        />
                    ) : (
                        <div className="chat-panel-empty">
                            <MessageSquare size={28} style={{ opacity: 0.3 }} />
                            <span>
                                {chatStreams.length === 0
                                    ? label('チャット対応の配信を追加してください', 'Add a live stream to view chat')
                                    : label('チャンネルを選択してください', 'Select a channel above')}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default ChatSidePanel;
