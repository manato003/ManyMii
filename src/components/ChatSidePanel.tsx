import React, { useState, useMemo } from 'react';
import { MessageSquare, Pin, PinOff, ChevronDown } from 'lucide-react';
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
        // dark_theme=1 がないと YouTube のチャットだけ白背景になる（Twitch は darkpopout）
        return `https://www.youtube.com/live_chat?v=${stream.sourceId}&embed_domain=${domain}&dark_theme=1`;
    }
    return null;
}

const ChatSidePanel: React.FC<ChatSidePanelProps> = ({ streams, locale, isPinned, onPinChange, swapped = false, hideDelay = 500 }) => {
    // isPinned を渡すこと。渡さないとピン留めしてもマウスアウトで隠れてしまい、
    // パネルは消えているのに app-main の chat-pinned 分の余白だけが残る
    const { visible: isVisible, show, scheduleHide } = useHoverPanel({ hideDelay, idleTimeout: 5000, isPinned });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isSelectorExpanded, setIsSelectorExpanded] = useState(false);

    const label = (ja: string, en: string) => locale === 'ja' ? ja : en;

    // ── チャット表示可能なストリームのみ絞り込む ───────────────────────────
    const chatStreams = useMemo(
        () => streams.filter(s => getChatUrl(s) !== null),
        [streams],
    );

    // selectedId は「ユーザーが明示的に選んだもの」だけを保持する。
    // 未選択のときや選択中の配信が消えたときの解決は描画時に行う
    // （effect で setState するとレンダーのカスケードになる）。
    const selectedStream = chatStreams.find(s => s.id === selectedId) ?? chatStreams[0] ?? null;
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
                    {/* 配信管理パネルのピンと見た目・挙動を揃える。
                        .side-panel-pin がスタイル、.chat-panel-pin が配置を担当 */}
                    <button
                        className={`side-panel-pin chat-panel-pin${isPinned ? ' active' : ''}`}
                        onClick={() => onPinChange(!isPinned)}
                        title={isPinned ? label('ピン解除', 'Unpin') : label('ピン留め', 'Pin')}
                        aria-label={isPinned ? label('ピン解除', 'Unpin') : label('ピン留め', 'Pin')}
                    >
                        {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
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
