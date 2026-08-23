import React, { useState } from 'react';
import { X, ExternalLink, RefreshCw, GripVertical, EyeOff, Loader, WifiOff, AlertTriangle } from 'lucide-react';
import type { Stream } from '../types';
import { toDisplayName } from '../types';
import TwitchPlayer from './TwitchPlayer';
import YouTubePlayer from './YouTubePlayer';
import { t } from '../i18n';
import type { Locale } from '../i18n';

interface StreamFrameProps {
    stream: Stream;
    onRemove: (id: string) => void;
    locale: Locale;
    onToggleExpand: (id: string) => void;
    onDragHandleMouseDown: (e: React.MouseEvent, id: string) => void;
    isDragging: boolean;
    isDragTarget: boolean;
    onHide: (id: string) => void;
    onRefreshStream: (id: string, handle: string) => Promise<void>;
}

const StreamFrame: React.FC<StreamFrameProps> = React.memo(({
    stream, onRemove, locale,
    onToggleExpand, onDragHandleMouseDown,
    isDragging, isDragTarget, onHide, onRefreshStream,
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [isResolving, setIsResolving] = useState(false);

    const handlePopout = (e: React.MouseEvent) => {
        e.stopPropagation(); e.preventDefault();
        let url = '';
        if (stream.type === 'twitch') {
            url = stream.inputType === 'video'
                ? `https://www.twitch.tv/videos/${stream.sourceId}`
                : `https://www.twitch.tv/${stream.sourceId}`;
        } else {
            url = stream.inputType === 'channel'
                ? `https://www.youtube.com/@${stream.sourceId}`
                : `https://www.youtube.com/watch?v=${stream.sourceId}`;
        }
        window.open(url, '_blank', 'width=960,height=540');
    };

    const handleClose = (e: React.MouseEvent) => {
        e.stopPropagation(); e.preventDefault();
        onRemove(stream.id);
    };

    const handleReload = async (e: React.MouseEvent) => {
        e.stopPropagation(); e.preventDefault();
        // YouTubeチャンネル由来の枠は video ID を再取得してから切り替える。
        // ライブ中は inputType が 'video' になっているため channelHandle の有無で判定する。
        if (stream.type === 'youtube' && stream.channelHandle) {
            setIsResolving(true);
            try {
                await onRefreshStream(stream.id, stream.channelHandle);
                setReloadKey(k => k + 1);
            } finally {
                setIsResolving(false);
            }
            return;
        }
        setReloadKey(k => k + 1);
    };

    const frameClass = [
        'stream-frame',
        isDragging ? 'is-dragging-frame' : '',
        isDragTarget ? 'is-drag-target' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            className={frameClass}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onDoubleClick={() => onToggleExpand(stream.id)}
        >
            <div className={`stream-frame-header ${isHovered || isDragging ? 'visible' : ''}`}>
                <div className="stream-frame-title">
                    <div
                        className="drag-handle"
                        title={locale === 'ja' ? 'ドラッグして並べ替え' : 'Drag to reorder'}
                        onMouseDown={(e) => onDragHandleMouseDown(e, stream.id)}
                    >
                        <GripVertical size={14} />
                    </div>
                    <span className={`platform-dot ${stream.type}`}></span>
                    <span className="stream-title-text" title={stream.title}>{toDisplayName(stream)}</span>
                </div>
                <div className="stream-frame-actions">
                    <button className="stream-frame-action" onClick={e => { e.stopPropagation(); onHide(stream.id); }} title={locale === 'ja' ? '非表示' : 'Hide'} aria-label={locale === 'ja' ? '非表示' : 'Hide'}>
                        <EyeOff size={12} />
                    </button>
                    <button className="stream-frame-action" onClick={handleReload} title={t(locale, 'reload')} aria-label={t(locale, 'reload')} disabled={isResolving}>
                        {isResolving ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />}
                    </button>
                    <button className="stream-frame-action" onClick={handlePopout} title={t(locale, 'popout')} aria-label={t(locale, 'popout')}>
                        <ExternalLink size={12} />
                    </button>
                    <button className="stream-frame-action close-btn" onClick={handleClose} title={t(locale, 'closeStream')} aria-label={t(locale, 'closeStream')}>
                        <X size={12} />
                    </button>
                </div>
            </div>

            <div className="stream-content">
                {stream.isResolving ? (
                    <div className="stream-offline">
                        <Loader size={28} className="spin" />
                        <span className="stream-offline-title">{toDisplayName(stream)}</span>
                        <span className="stream-offline-msg">
                            {locale === 'ja' ? 'ライブ確認中...' : 'Checking live status...'}
                        </span>
                    </div>
                ) : stream.resolveError && stream.isLive !== true ? (
                    <div className="stream-offline">
                        <AlertTriangle size={28} />
                        <span className="stream-offline-title">{toDisplayName(stream)}</span>
                        <span className="stream-offline-msg">
                            {locale === 'ja' ? 'ライブ状態を取得できませんでした' : 'Could not check live status'}
                        </span>
                        <button className="stream-offline-retry" onClick={handleReload} disabled={isResolving}>
                            {isResolving ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />}
                            <span>{locale === 'ja' ? '再試行' : 'Retry'}</span>
                        </button>
                    </div>
                ) : stream.type === 'youtube' && stream.isLive === false ? (
                    <div className="stream-offline">
                        <WifiOff size={28} />
                        <span className="stream-offline-title">{toDisplayName(stream)}</span>
                        <span className="stream-offline-msg">
                            {locale === 'ja' ? '現在ライブ配信していません' : 'Not currently live'}
                        </span>
                        <button className="stream-offline-retry" onClick={handleReload} disabled={isResolving}>
                            {isResolving ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />}
                            <span>{locale === 'ja' ? '再確認' : 'Check again'}</span>
                        </button>
                    </div>
                ) : stream.type === 'twitch' ? (
                    <TwitchPlayer
                        key={reloadKey}
                        channel={stream.inputType === 'channel' ? stream.sourceId : undefined}
                        video={stream.inputType === 'video' ? stream.sourceId : undefined}
                    />
                ) : (
                    <YouTubePlayer
                        key={reloadKey}
                        videoId={stream.sourceId}
                        isChannel={stream.inputType === 'channel'}
                    />
                )}
            </div>

            {isDragTarget && <div className="drag-target-overlay" />}
            {isResolving && <div className="resolving-overlay"><Loader size={24} className="spin" /></div>}
        </div>
    );
});

export default StreamFrame;
