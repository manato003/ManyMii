export interface Stream {
    id: string;
    type: 'youtube' | 'twitch';
    title: string;
    sourceId: string;
    inputType: 'channel' | 'video' | 'url';
    hidden?: boolean;
    isLive?: boolean;         // YouTubeチャンネル枠のみ使用。falseならオフライン表示
    channelHandle?: string;   // YouTubeチャンネルの元のハンドル名（再取得に使用）
    channelId?: string;       // YouTubeのチャンネルID（UC…）。取得できた場合のみ
    displayName?: string;     // チャンネルの表示名。未取得なら title から導出する
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
    displayName?: string;
}

/**
 * パネルに出す表示名。
 * 表示名が取得できていればそれを、なければ title から "YouTube: " 等の接頭辞と
 * 先頭の @ を取り除いた識別子を返す。
 */
export function toDisplayName(item: { title: string; displayName?: string }): string {
    if (item.displayName) return item.displayName;
    return item.title.replace(/^(YouTube|Twitch):\s*/, '').replace(/^@/, '');
}

export type FavoriteNode = FavoriteFolder | FavoriteChannel;
