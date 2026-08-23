import React from 'react';

interface YouTubePlayerProps {
    videoId: string;
    isChannel?: boolean;
}

const YouTubePlayer: React.FC<YouTubePlayerProps> = React.memo(({ videoId, isChannel }) => {
    // チャンネル埋め込みはチャンネルID (UC...) 専用。通常はライブ解決後の video ID が渡る
    const src = isChannel
        ? `https://www.youtube.com/embed/live_stream?channel=${videoId}&autoplay=1&mute=1`
        : `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`;

    return (
        <iframe
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
