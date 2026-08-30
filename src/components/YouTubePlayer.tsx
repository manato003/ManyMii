import React, { useEffect, useRef } from 'react';
import { logEvent } from '../utils/eventLog';

interface YouTubePlayerProps {
    videoId: string;
    isChannel?: boolean;
    /** 観測ログに残すときの識別子（枠の ID） */
    streamId?: string;
}

/**
 * YouTube のプレイヤー状態。数値は YouTube 側の定義。
 * 0 = 終了 / 1 = 再生中 / 2 = 一時停止 / 3 = バッファ中 / 5 = 準備完了 / -1 = 未開始
 */
const STATE_NAME: Record<number, string> = {
    [-1]: 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued',
};

const YT_ORIGIN = 'https://www.youtube.com';

const YouTubePlayer: React.FC<YouTubePlayerProps> = React.memo(({ videoId, isChannel, streamId }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // チャンネル埋め込みはチャンネルID (UC...) 専用。通常はライブ解決後の video ID が渡る
    // enablejsapi=1 は**観測のためだけ**に付けている（下の useEffect を参照）
    const base = isChannel
        ? `${YT_ORIGIN}/embed/live_stream?channel=${videoId}`
        : `${YT_ORIGIN}/embed/${videoId}`;
    const src = `${base}${isChannel ? '&' : '?'}autoplay=1&mute=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;

    /**
     * プレイヤーの状態を観測してログに残す。**再生には一切干渉しない。**
     *
     * 「配信が続いているのに終了表示になる」現象を追うため。iframe はクロスオリジンで
     * 中を覗けないので、YouTube の埋め込みが持つ postMessage の窓口を使う。
     * `listening` を送ると、以後プレイヤーが状態を送り返してくる。
     *
     * 原因が特定できたらこの useEffect ごと削除する。
     */
    useEffect(() => {
        if (!streamId) return;
        const frame = iframeRef.current;
        if (!frame) return;

        const send = (payload: Record<string, unknown>) => {
            try {
                frame.contentWindow?.postMessage(JSON.stringify({ ...payload, id: streamId, channel: 'widget' }), YT_ORIGIN);
            } catch {
                /* 読み込み前などは失敗する。リトライで拾う */
            }
        };

        // プレイヤーが応答できるようになるまで少し時間がかかるので数回投げる
        const handshake = () => {
            send({ event: 'listening' });
            send({ event: 'command', func: 'addEventListener', args: ['onStateChange'] });
            send({ event: 'command', func: 'addEventListener', args: ['onError'] });
        };
        const timers = [0, 500, 1500, 4000].map(d => setTimeout(handshake, d));

        let lastState: number | null = null;
        const onMessage = (e: MessageEvent) => {
            if (e.origin !== YT_ORIGIN || typeof e.data !== 'string') return;
            let data: { event?: string; info?: unknown; id?: string };
            try { data = JSON.parse(e.data); } catch { return; }
            if (data.id !== streamId) return;

            if (data.event === 'onError') {
                logEvent('yt-error', streamId, String(data.info));
                return;
            }

            const state = data.event === 'onStateChange'
                ? (typeof data.info === 'number' ? data.info : null)
                : (typeof data.info === 'object' && data.info !== null && 'playerState' in data.info
                    ? (data.info as { playerState: number }).playerState
                    : null);

            // 状態が変わったときだけ残す（infoDelivery は数秒おきに飛んでくる）
            if (state === null || state === lastState) return;
            lastState = state;
            logEvent('yt-state', streamId, STATE_NAME[state] ?? String(state));
        };

        window.addEventListener('message', onMessage);
        return () => {
            timers.forEach(clearTimeout);
            window.removeEventListener('message', onMessage);
        };
    }, [streamId, src]);

    return (
        <iframe
            ref={iframeRef}
            src={src}
            title={`YouTube: ${videoId}`}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            width="100%"
            height="100%"
            style={{ border: 'none' }}
        ></iframe>
    );
});

export default YouTubePlayer;
