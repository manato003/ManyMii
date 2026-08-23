# Multistream Nexus — 実装仕様

現在の実装をそのまま記述したもの。**実装を変えたらこのファイルも更新すること。**
「なぜそうなっているか」は [CLAUDE.md](../CLAUDE.md) の設計思想を参照。

最終更新: 2026-08-23

---

## 1. 構成

```
src/
  App.tsx                    状態の中枢（streams / locale / モーダル / 解決処理）
  types.ts                   Stream / FavoriteNode
  i18n.ts                    日英の文言（t() 経由。細かい文言は各所の label() を使用）
  index.css / side-panel.css ダークモード専用のスタイル
  components/
    StreamGrid.tsx           グリッド計算・枠のドラッグ入れ替え
    StreamFrame.tsx          個別枠（ヘッダー・リロード・オフライン/失敗画面）
    YouTubePlayer.tsx        iframe 埋め込み
    TwitchPlayer.tsx         iframe 埋め込み
    StreamSidePanel.tsx      配信管理パネル（追加済 / お気に入り / 履歴）
    FavoritesTree.tsx        お気に入りツリーの描画とドラッグ
    ChatSidePanel.tsx        コメントパネル
    AddStreamModal.tsx       配信追加（単発・一括・共有コード）
    ShareModal.tsx           共有コードの書き出し / 読み込み
    SettingsModal.tsx        設定
    HelpModal.tsx            操作ガイド
    PlatformIcon.tsx         YouTube / Twitch アイコン
  hooks/
    useFavorites.ts          お気に入りツリーの純粋な操作 + 永続化
    useStreamHistory.ts      履歴（最大50件）
    useSettings.ts           設定
    useHoverPanel.ts         パネルのホバー表示 / ピン留め
    useResizable.ts          パネル幅のドラッグリサイズ
    useDragReorder.ts        パネル内のドラッグ並べ替え + クロスドロップ
    useKeyboardShortcuts.ts  グローバルショートカット
  utils/
    parseInput.ts            URL / ハンドル / ID のパース
    resolveChannelId.ts      YouTubeチャンネル → ライブ video ID の解決
```

## 2. データモデル

```ts
interface Stream {
    id: string;                // crypto.randomUUID()
    type: 'youtube' | 'twitch';
    title: string;
    sourceId: string;          // 埋め込みに使う値（YouTubeライブ中は video ID）
    inputType: 'channel' | 'video' | 'url';
    hidden?: boolean;
    isLive?: boolean;          // YouTubeチャンネル枠のみ。false でオフライン画面
    channelHandle?: string;    // 元のハンドル（再解決に使う）
    isResolving?: boolean;     // 解決中（永続化しない）
    resolveError?: boolean;    // 取得失敗。オフラインとは区別する
}
```

お気に入りは `FavoriteFolder | FavoriteChannel` の再帰ツリー。**フォルダは2階層まで**
（`MAX_DEPTH = 2`）。ドラッグ移動でもこの制限と循環参照の防止が働く。

### localStorage

| キー | 内容 |
|---|---|
| `activeStreams` | 現在の配信リスト（`isResolving` は除外して保存） |
| `favorites` | お気に入りツリー |
| `streamHistory` | 履歴（最大50件） |
| `appSettings` | 設定 |
| `locale` | `'ja'` \| `'en'` |
| `chatPinned` / `streamPinned` | 各パネルのピン留め |
| `panelSections` | 配信管理パネルのセクション折りたたみ |
| `streamPanelWidth` | 配信管理パネルの幅 |

すべて自動保存。明示的な「保存」操作は存在しない。

## 3. YouTubeライブの解決

YouTube はライブ配信の URL が動的なため、ハンドルから現在の配信を特定する必要がある。
Twitch はチャンネルページの URL がそのまま配信 URL なので、この処理は不要。

```
@handle → CORSプロキシ経由で youtube.com/@handle/live を取得
        → <link rel="canonical"> から video ID を抽出
        → ライブ判定:
             "isLiveNow": true                        → 通常のライブ
             "isLive": true かつ "hlsManifestUrl" あり → 24/7ストリーム
           （予定配信は hlsManifestUrl を持たないので除外される）
```

プロキシは `api.codetabs.com` → `api.allorigins.win` の順にフォールバック。
`resolveYouTubeChannel()` は例外を投げず、必ず次のいずれかを返す:

| 戻り値 | 意味 | 画面 |
|---|---|---|
| `{ status: 'live', videoId }` | 配信中 | プレイヤー |
| `{ status: 'offline' }` | 配信していない | オフライン画面 + 再確認ボタン |
| `{ status: 'error', message }` | 判定できなかった | 取得失敗画面 + 再試行ボタン。**現在の video ID は維持** |

**キャッシュしない。** 常に取得しに行く。

オフライン時に最新動画を再生するフォールバックは**意図的に持たない**。

### 解決が走るタイミング

| きっかけ | スピナー |
|---|---|
| 配信の追加（単発・一括・履歴・お気に入り・共有コード） | あり |
| 起動時（復元した全チャンネル枠） | なし（前回の枠がすぐ再生される） |
| 枠のリロードボタン | あり |
| 「オフライン枠を再確認」ボタン | あり |
| 5分ごとの自動再確認（設定でOFF可） | なし |

自動再確認はプロキシに負荷をかけないよう、**ライブ中でない枠のみ・逐次実行・
`document.hidden` のときはスキップ**する。ライブ中の枠は video ID が変わらないため対象外。

すべての解決は `App.tsx` の `resolveStreamInBackground()` を経由する。

## 4. レイアウト

`calcOptimalGrid(count, vpW, vpH)` が 1〜count 列を総当たりし、16:9 を保ったときの
セル面積が最大になる列数を選ぶ。

- ダブルクリックで対象枠を全画面に拡大（`expandedId`）
- 非表示にした枠はグリッドから外れる（iframe がアンマウントされ再生も止まる）

## 5. ドラッグ&ドロップ

**HTML5 DnD API は使わない。** iframe がイベントを飲み込むため。

`mousedown` → `mousemove` で 5px 動いたら開始 → `document.elementFromPoint()` で
ドロップ先を判定 → `mouseup` で確定、という実装が3箇所にある。

| 場所 | 実装 | 判定に使う属性 |
|---|---|---|
| 配信グリッド | `StreamGrid.tsx` 内 | `data-stream-id` |
| パネル内リスト | `useDragReorder.ts` | `data-stream-id` / `data-history-id` |
| お気に入りツリー | `FavoritesTree.tsx` 内 | `data-fav-id` / `data-folder-drop` |

グリッドのドラッグ中は `#drag-global-overlay` で全 iframe を覆い、
`elementFromPoint` の直前だけ一時的に非表示にして下の要素を拾う。

並べ替えはすべて**スワップ**（挿入ではない）。

## 6. パネル

| | 配信管理パネル | コメントパネル |
|---|---|---|
| 位置 | 左（設定で右に入替可） | 右（同左） |
| 表示 | 端のトリガー領域にホバー | 同左 |
| ピン留め | あり | あり |
| 幅 | ドラッグでリサイズ（200〜480px） | 設定で3段階（240/280/340px） |

どちらも `useHoverPanel` を使用。マウスが 5 秒静止するか、ウィンドウ外に出ると自動的に隠れる
（ピン留め中を除く）。隠れるまでの遅延は設定の「ホバー感度」で 200 / 500 / 1000ms。

コメントパネルに出せるのは Twitch のチャンネル枠と、ライブ中の YouTube 枠のみ。

## 7. 共有コード

`btoa(encodeURIComponent(JSON.stringify(data)))` の Base64 文字列。

```ts
// v2（現行）— セクションごとに選んで書き出せる
{ v: 2, streams?: StreamExport[], favorites?: FavoriteNode[], history?: HistoryEntry[] }
// v1（旧）— 配信の配列そのもの。読み込みのみ対応
[ { type, title, sourceId, inputType }, ... ]
```

YouTubeチャンネル枠は**解決後の video ID ではなくハンドルを書き出す**。video ID を
固定すると、その配信が終わった時点でコードが使えなくなるため。読み込み時に再解決される。

読み込みは ShareModal（3セクション対応）と、配信追加モーダルの一括追加欄
（streams のみ取り込み）の両方から可能。

**ShareModal の読み込みは既存データを全置換する**（確認なし）。

## 8. 設定

| 設定 | 値 | 既定 |
|---|---|---|
| パネルの左右入れ替え | `default` / `swapped` | `default` |
| チャットパネルの幅 | 240 / 280 / 340 | 280 |
| ヘッダーを常時表示 | on / off | off |
| オフライン枠を自動で再確認 | on / off | on |
| パネルのホバー感度 | `slow` / `normal` / `fast` | `normal` |

## 9. キーボードショートカット

`A` 追加 / `,` 設定 / `?` ヘルプ / `P` チャットのピン留め / `Esc` モーダルを閉じる

入力欄にフォーカスがあるとき、および Ctrl / Cmd / Alt との組み合わせは無視する。

## 10. 既知の制約

- **CORSプロキシが単一障害点。** 両方落ちると YouTubeチャンネル枠は「取得失敗」になる
  （現在の再生は維持される）
- **YouTube の HTML 構造に依存している。** YouTube 側の変更で解決が壊れうる
- `YouTubePlayer` の `isChannel` 経路（`embed/live_stream?channel=`）はチャンネルID専用で、
  ハンドルでは動かない。現在この経路に到達するケースはないが、コードは残っている
- 枠の入れ替え時、DOM の物理位置が変わるためブラウザが iframe をリロードする
  （CSS Grid の `order` で DOM 位置を変えずに入れ替える案が未実装）
- Twitch にはオフライン判定がない（Twitch 側の埋め込みがオフライン表示を出す）
- マウス操作前提。タッチ操作には対応しない
