export interface Stream {
    id: string;
    type: 'youtube' | 'twitch';
    title: string;
    sourceId: string;
    inputType: 'channel' | 'video' | 'url';
    hidden?: boolean;
    isLive?: boolean;         // YouTubeチャンネル枠のみ使用。falseならオフライン表示
    channelHandle?: string;   // YouTubeチャンネルの元のハンドル名（再取得に使用）
    isResolving?: boolean;    // ライブ状態取得中フラグ（trueの間はローディング表示）
    resolveError?: boolean;   // ライブ状態の取得に失敗した（オフラインとは区別する）
    /**
     * グリッドのDOM上の並び順を固定するための通し番号（永続化しない）。
     * 配列の順序を入れ替えるとReactがDOMノードを物理移動させ、iframeが
     * リロードされてしまうため、DOM順序はこの値で固定し、視覚的な位置だけ
     * CSSの order で入れ替える。
     */
    domSeq?: number;
}

// ── お気に入りツリー ──

export interface FavoriteFolder {
    id: string;
    kind: 'folder';
    name: string;
    collapsed: boolean;
    children: FavoriteNode[];
}

export interface FavoriteChannel {
    id: string;
    kind: 'channel';
    type: 'youtube' | 'twitch';
    title: string;
    sourceId: string;
    inputType: 'channel' | 'video' | 'url';
}

export type FavoriteNode = FavoriteFolder | FavoriteChannel;
