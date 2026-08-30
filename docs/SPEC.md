# ManyMii — 実装仕様

現在の実装をそのまま記述したもの。**実装を変えたらこのファイルも更新すること。**
「なぜそうなっているか」は [CLAUDE.md](../CLAUDE.md) の設計思想を参照。

最終更新: 2026-08-25

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
    useFavorites.ts          お気に入りの state と localStorage への橋渡し
    useStreamHistory.ts      履歴（最大50件）
    useSettings.ts           設定
    useHoverPanel.ts         パネルのホバー表示 / ピン留め
    useResizable.ts          パネル幅のドラッグリサイズ
    useDragReorder.ts        パネル内のドラッグ並べ替え + クロスドロップ
    useKeyboardShortcuts.ts  グローバルショートカット
  utils/
    parseInput.ts            URL / ハンドル / ID のパース
    resolveChannelId.ts      YouTubeチャンネル → ライブ video ID の解決
    favoriteTree.ts          お気に入りツリーの純粋な操作（React非依存）
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

#### ツリーのドラッグ＆ドロップ

**落とした「行の中の位置」でドロップ先の意味が変わる。**

| 行 | 上端 | 中央 | 下端 |
|---|---|---|---|
| フォルダ | 前に挿入 | **フォルダの中へ** | 後ろに挿入 |
| チャンネル | 前に挿入（上半分） | — | 後ろに挿入（下半分） |

「前後に挿入」があることで、**ルート直下の項目の前後に落とすだけで階層を上げられる**。
これが無いと子要素をルートへ戻す手段が無くなる（実際にそういう不具合があった）。
ドラッグ中だけ出る `fav-root-drop` が明示的なルート移動先も兼ねる。

- 移動は**入れ替えではなく挿入**（`moveNodeRelative`）。入れ替えだと
  「A を C に落としたら C B A」になり直感に反する
- **ドロップ可否の判定（ハイライト）と実際の移動で `canMoveInto` を共有する。**
  ずれると「光ったのに動かない」という一番わかりにくい挙動になる
- ドラッグ状態は**ツリーのルートが1つだけ持ち**、各階層へ配る。
  階層ごとに持つと、別の階層の行にドロップ線が出ない

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
| `streamLayouts` | レイアウトの選択（枠数ごと）。消えても既定に戻るだけ |
| `resolveCache` | ライブ解決結果のキャッシュ（3章参照）。消えても動作に影響しない |

すべて自動保存。明示的な「保存」操作は存在しない。

## 3. YouTubeライブの解決

YouTube はライブ配信の URL が動的なため、ハンドルから現在の配信を特定する必要がある。
Twitch はチャンネルページの URL がそのまま配信 URL なので、この処理は不要。

### 経路1（本命）: レンダリング済みチャンネルページ

```
@handle → r.jina.ai 経由で youtube.com/@handle を取得（X-Return-Format: html）
        → ytInitialData 内の "channelFeaturedContentRenderer" を探す
        → その中に THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE があれば配信中
        → 直後の "animationActivationTargetId" が video ID
        → og:title = チャンネル表示名、"externalId" = チャンネルID
```

**素のCORSプロキシではこれができない。** YouTubeはデータセンターIPからの
リクエストに対し、200 を返しながら中身のないページ（canonical が "undefined"、
ytInitialData なし）を返す。r.jina.ai はJSを実行したうえでHTMLを返すため
ytInitialData ごと取得できる。CORSプリフライトにも対応している。

1リクエストで**ライブID・チャンネル名・チャンネルIDがすべて揃う**。
実測 1.0〜2.1秒、応答サイズ 1.2〜2.7MB。

配信していないチャンネルは注目コンテンツにライブ枠が出ないため、
`channelFeaturedContentRenderer` がない、またはLIVEバッジがない = オフライン。

### 経路2（フォールバック）: /live ページ

```
@handle → 素のCORSプロキシ経由で youtube.com/@handle/live を取得
        → <link rel="canonical"> から video ID を抽出
        → ライブ判定:
             "isLiveNow": true                        → 通常のライブ
             "isLive": true かつ "hlsManifestUrl" あり → 24/7ストリーム
           （予定配信は hlsManifestUrl を持たないので除外される）
```

成功率は低いが、経路1がレート制限などで使えないときの保険として残している。

### 逆引き: 動画URL → チャンネル

動画URLを貼られたときは、逆に投稿チャンネルを引く（`resolveVideoToChannel`）。
同じく r.jina.ai でレンダリング済みの watch ページを取得し、ytInitialData 内で
**表示名・チャンネルID・ハンドルが隣接している構造**を1つの正規表現で捕まえる。

```
"text":"藍沢エマ / Aizawa Ema","navigationEndpoint":{ …
  "browseEndpoint":{"browseId":"UCPkKpOHxEDcwmUAnRpIu-Ng",
                    "canonicalBaseUrl":"/@AizawaEma"}}
```

位置ではなく構造で捕まえること。`videoOwnerRenderer` を起点にすると、
先に出現する `videoPrimaryInfoRenderer` の**動画タイトル**を拾ってしまう。

これにより、動画URLで追加した枠にも `channelHandle` が付くため、
以後はリロードや自動再確認でチャンネルとして再解決できるようになる。

経路2のプロキシは `api.allorigins.win` → `api.codetabs.com` → `api.cors.lol` の順。
**1リクエストあたり6秒で打ち切る。** 死んだプロキシは応答までに20秒以上かかることがあり、
タイムアウトがないと逐次フォールバック全体が固まるため。

チャンネル識別子は `@ハンドル` と `UC…` のチャンネルIDの両方を受け付け、
それぞれ `/@handle/live` と `/channel/UCxxx/live` を取得する。

### キャッシュ

`r.jina.ai` は**単一障害点**であり、無料枠のレート制限がある（調査中に実際に HTTP 429
に到達した）。応答も 1.2〜2.7MB と重い。依存そのものは外せない（素のCORSプロキシは
YouTubeが縮退ページを返すため機能しない）ので、**叩く回数を減らして緩和する。**

結果は `localStorage` の `resolveCache` に保存する（`utils/resolveCache.ts`）。

| 対象 | TTL | 理由 |
|---|---|---|
| ライブ中（video ID） | 10分 | 配信が続く限り変わらない |
| オフライン | 2分 | 配信開始で変わる。ユーザーが一番更新を期待する状態 |
| 動画 → チャンネル（逆引き） | 7日 | 動画の投稿者は変わらない。実質不変 |
| Twitchの表示名 | 24時間 | まれにしか変わらない |

守るべきルール:

- **`status: 'error'` はキャッシュしない。** 失敗を固定すると、プロキシが復旧しても直らない
- **「再確認」ボタンからの解決はキャッシュを無視する**（`resolveYouTubeChannel(id, { force: true })`）。
  ユーザーが更新を求めて押したのに同じ結果を返すと壊れて見える
- エントリ数の上限は100件。超えたら有効期限が近いものから捨てる
- キャッシュが消えても動作は変わらない（遅くなるだけ）

### 縮退ページの検出

YouTubeはプロキシ経由のリクエストに対し、**200 を返しながら中身のないページ**
（`<link rel="canonical" href="undefined">`、`<title> - YouTube</title>`）を
返すことがある。これをそのまま解析すると canonical が取れず「オフライン」と
誤判定するため、明示的に検出して `error` として扱う。
`resolveYouTubeChannel()` は例外を投げず、必ず次のいずれかを返す:

| 戻り値 | 意味 | 画面 |
|---|---|---|
| `{ status: 'live', videoId, channelId?, channelName? }` | 配信中 | プレイヤー |
| `{ status: 'offline', channelId?, channelName? }` | 配信していない | オフライン画面 + 再確認ボタン |
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

- ダブルクリックで対象枠を全画面に拡大（`expandedId`）。
  **別のツリーを返さず、対象セルを `grid-area: 1 / 1 / -1 / -1`、他を `display:none`
  にするだけ。** iframe を破棄しないので復帰時にリロードされない。
  代償として、隠れている枠の音声は鳴り続ける（意図的）
- 非表示にした枠はグリッドから外れる（iframe がアンマウントされ再生も止まる）

### レイアウト

`utils/layout.ts` の `buildLayout(templateId, count, vpW, vpH)` が
列・行のトラック（`fr` 値）と、各枠が入る区画（`Slot`）を返す。

| テンプレート | 内容 | 条件 |
|---|---|---|
| `auto` | `calcOptimalGrid()` による等分（既定） | 常に |
| `main-left` / `main-right` | 大きい1枠 + 残りを縦1列 | 2枠以上 |
| `main-top` | 上に大きい1枠 + 残りを横1列 | 2枠以上 |
| `l-shape` / `l-shape-right` | 左上（右上）にメイン、縦1列と下段にサブを L 字に | 5枠以上 |

`main-*` は「メイン1 + 残り n」なので**枠数ごとの定義を持たず、枠数から生成する**。
適用できないテンプレートが渡されたら `auto` に落ちる（枠を減らしたときに壊れないため）。

#### l-shape が黒帯を最小にする理屈

左上にメインを置き、右の列と下の段にサブを並べる。トラックをすべて等分にすると、
C 列 R 行・ビューポート縦横比 A のとき

```
サブの縦横比  = A · R/C
メインの縦横比 = A · R/C · (C-1)/(R-1)
```

**C = R のとき両者が一致する**ので、16:9 の画面なら両方 16:9 になり黒帯が消える。
サブの枚数は「右列 R-1 枚 + 下段 C 枚」なので枠数 n との関係は `n = C + R`。
つまり**枠数を縦横に振り分けるだけ**で決まり、枠数ごとの定義表を持つ必要がない。

`pickLShapeGrid()` が `C + R = n` の組み合わせを総当たりし、メインとサブの縦横比が
もっとも 16:9 に近い組を選ぶ。**両方を見ること。** サブだけで最適化すると
16:9 でない画面でメインが極端に細長くなる。

1920x1080 での結果（偶数枠は両方ちょうど 16:9）:

| 枠数 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|
| グリッド | 3x3 | 3x4 | 4x4 | 4x5 | 5x5 |
| メイン | 2x2 | 2x3 | 3x3 | 3x4 | 4x4 |
| 黒帯 | なし | あり | なし | あり | なし |

**事後条件: `slots.length === count`。** 足りないとセルが自動配置に落ちて
意図しない位置に飛ぶ。テストで固定してある。

選択は配信管理パネル上段（`side-panel-layout`）。パネルは
「上段=見え方 / 下段=配信の管理」の2段構成。
**どの配信をメイン枠に置くかは既存のドラッグ入れ替えで決まる**
（配列の先頭がスロット0＝メイン）。専用の操作は持たない。

状態は `localStorage` の `streamLayouts` に保存する。共有コードには含めない。

**テンプレートはアプリ全体で1つ、トラック幅だけ枠数ごとに持つ。**
当初はテンプレートも枠数ごとに持っていたが、枠を1つ非表示にしただけで
「その枠数は未設定」となり `auto` に戻る不具合になった。`main-*` は枠数によらず
成立するので枠数ごとに持つ意味がない。一方トラック幅は列数・行数に依存するため
枠数ごとに持つ必要がある。

#### 境界ドラッグ

列・行の境界をドラッグして比率を変えられる。変えるのは
`grid-template-columns` / `rows` の `fr` 値だけなので DOM は動かない。

- ハンドルは **`grid-resize-layer`（絶対配置のレイヤ）に置き、必ずすべてのセルより
  後ろに描く**。セルの間に差し込むと React がセルを `insertBefore` で動かし、
  iframe がリロードされる
- **グリッド線の全長にハンドルを引かない。** `buildHandleSegments()` が
  「実際に別々の枠が接している区間」だけを返す。例えば L字では列の境界の多くが
  メイン枠の内側を通っており、全長に引くと映像の上を線が縦断するうえ、
  掴んでも下段の枠しか動かず意図と結果がずれる

  ```
  ┌──────────────────┬──────┐
  │                  │  2   │
  │    メイン         ├──────┤
  │                  │  3   │   ← 右端の境界だけが全高
  ├──────┼──────┼────┼──────┤
  │  5   │  6   │  7 │  8   │
  └──────┴──────┴────┴──────┘
         ↑      ↑
      この2本は下段の区間のみ
  ```

- **L字の右下の枠は縦列と下段の両方のトラックを共有する。** フラットな Grid では
  切り離せないため、どちらを動かしても連動するのを仕様とする（意図的）
- 既定では不可視。グリッドにホバーしたときだけ薄く出す（設計思想1）
- **影響は隣の1本ではなく、境界の左右それぞれの全トラックに比例配分する。**
  隣だけで吸収させるとそこだけが極端に潰れ、他は不動という不自然な動きになる

  ```
  [1, 1, 1] の境界0 を +0.6
    隣だけ:   [1.6, 0.4, 1.0]   ← 2列目だけが潰れる
    比例配分: [1.6, 0.7, 0.7]   ← 右側全体で均等に負担する
  ```

- 1トラックは `MIN_FR = 0.3` を下回らない。0 にできると枠が消えて掴み直せなくなる。
  **限界は「一番小さいトラック」で決めること。** 平均で決めると、幅がばらついている
  ときに小さい方だけが下限を割る
- 総和は変えない（片方が伸びた分だけもう片方が縮む）
- **保存済みの幅は、トラックの本数が一致するときだけ適用する**（`tracksFor`）。
  テンプレートや枠数が変わると本数が変わり、そのまま当てると区画とずれて崩れる
- テンプレートを切り替えると調整済みの幅は破棄される

### DOM順序を変えない

**グリッドの DOM 上の並び順は `Stream.domSeq`（追加順）で固定し、視覚的な位置は
CSS の `order` で表現する。** `streams` 配列の順序をそのまま DOM に反映してはいけない。

配列の順序を変えると React がキー付き子要素を `insertBefore` で物理的に移動させ、
**移動したすべての iframe がブラウザによってリロードされる**。9枠で左上を右下に
ドロップすると、React の再配置アルゴリズムの性質上、最後尾に来た1枠を除く
8枠すべてが移動＝リロードされていた。

`domSeq` は永続化しない。復元時とインポート時に配列順で振り直す。

## 5. ドラッグ&ドロップ

**HTML5 DnD API は使わない。** iframe がイベントを飲み込むため。

`mousedown` → `mousemove` で 5px 動いたら開始 → `document.elementFromPoint()` で
ドロップ先を判定 → `mouseup` で確定、という実装が3箇所にある。

| 場所 | 実装 | 判定に使う属性 |
|---|---|---|
| 配信グリッド | `StreamGrid.tsx` 内 | `data-stream-id` |
| パネル内リスト | `useDragReorder.ts` | `data-stream-id` / `data-history-id` |
| お気に入りツリー | `FavoritesTree.tsx` 内 | `data-fav-row` / `data-fav-folder` / `data-fav-root-drop` |

<sub>`data-folder-drop` はお気に入りツリーにも残っているが、こちらは
**履歴からフォルダへのクロスドロップ**（`useDragReorder`）が使う。</sub>

グリッドのドラッグ中は `#drag-global-overlay` で全 iframe を覆い、
`elementFromPoint` の直前だけ一時的に非表示にして下の要素を拾う。

並べ替えはすべて**スワップ**（挿入ではない）。グリッドの並べ替えは `streams` 配列を
入れ替えるが、DOM 順序は `domSeq` で固定されているため iframe は再読み込みされない。

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

チャットの埋め込みURLには**必ずダークテーマ指定を付ける**。付けないと白背景になる。

| | パラメータ |
|---|---|
| Twitch | `&darkpopout` |
| YouTube | `&dark_theme=1`（`<html>` に `dark` 属性が付く） |

iframe 自体にも `background: var(--bg-primary)` を敷いて、読み込み中の白いちらつきを防ぐ。

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
| オフライン枠を自動で再確認 | on / off | **off** |
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
- **Twitch にオフライン判定はない（意図的）。** 配信URLが静的なのでライブ解決が不要で、
  結果として `isLive` が設定されず、オフライン画面・「オフライン枠を再確認」の対象・
  コメント欄の出し分けは YouTube 限定になっている。
  オフライン時は Twitch 側の埋め込みが状態を表示するため、ユーザーから見た結果は同等。
  これは欠落ではなく設計判断（CLAUDE.md 設計思想5）
- **チャットへの投稿にはサードパーティ Cookie の許可が要る。**
  チャットは `youtube.com` / `twitch.tv` の iframe なので、ログインセッションの
  Cookie がサードパーティ扱いになりブロックされる。ブラウザ側で既にログインしていても
  iframe からは見えず、「ログイン」を押してもポップアップで認証が通るだけで
  iframe の状態は変わらない。
  **Brave は Shields が既定でこれを遮断する**（実際に踏んだ）。
  対処はサイト単位で Shields を下げるか Cookie を許可すること。
  `document.requestStorageAccess()` は iframe 側から呼ぶ必要があるため、
  こちらのコードでは回避できない。
  どうしても投稿したい場合は、チャットをポップアップで開けば
  トップレベル＝ファーストパーティになるので確実に動く（未実装）
- **配信の仕切り直しで video ID が変わる。** 埋め込みは解決時点の video ID を指すので、
  配信者が配信を立て直すと古い ID になり「配信終了」のサムネイルが出る。
  枠ごとの再読み込み、またはパネルの「配信を再確認」で直る。
  **iframe の中は覗けないので自動検出はできない**（クロスオリジン）
- **全枠の音が同時に出なくなることがある（アプリ外の問題）。**
  プレイヤー内で音量を上げても戻らず、再読み込みの形跡も無く、F5 で復旧する。
  この組み合わせはアプリ側の説明と矛盾する（全枠を横断して音を止める仕組みは無く、
  ミュートは URL パラメータ由来なので iframe を読み直さない限り変わらない）。
  ブラウザの音声出力ストリームが切れたときの症状と整合する。
  復旧はヘッダー左上のタイトルをクリック（＝リロード）。**アプリのバグとして再調査しない**
- マウス操作前提。タッチ操作には対応しない

## 13. 観測ログ（一時的）

**「ライブ配信が続いているのに埋め込みが配信終了の表示になる」現象を追うための仕組み。
原因が特定できたら丸ごと削除する。**

- **アプリの挙動は一切変えない。** 記録するだけ
- 記録先は `localStorage` の `eventLog`。**時折しか起きない**ため、
  発生時に devtools を開いていなくても後から読めるようにしてある
- 300件のリングバッファ。古いものから捨てる

### 読み方

devtools のコンソールで:

```js
manymiiLog()        // 整形して表示
copy(manymiiLog())  // クリップボードへ
manymiiLogClear()   // 消す
```

### 記録している内容

| kind | いつ |
|---|---|
| `yt-state` | YouTubeプレイヤーの状態が変わったとき（`playing` / `ended` / `paused` など） |
| `yt-error` | YouTubeプレイヤーがエラーを出したとき |
| `expand` / `restore` | 枠の拡大・復帰。**拡大中は他の枠が `display:none` になる**ため、この操作との関連を見る |
| `hide` / `show` | 枠の非表示・再表示 |
| `close` | 枠を閉じたとき |
| `reload-click` | 枠の再読み込みボタンを押したとき |

### 仕組み

iframe はクロスオリジンなので中を覗けない。YouTube の埋め込みが持つ
`postMessage` の窓口（`enablejsapi=1`）に `listening` を送ると、
以後プレイヤーが状態を送り返してくる。これを受け取って記録しているだけで、
**再生には干渉していない**。

### 何が知りたいか

- 終了表示に落ちたとき、プレイヤーが `ended` を出すのか、何も出さないのか
  → **出すなら自動検知・自動復旧が作れる。出さないなら作れない**
- 直前に `expand` / `restore` があるか → `display:none` が原因かの判定

## 14. 外部入力の検証

**localStorage と共有コードはアプリの外で書き換えられる。** どちらも
`utils/validate.ts` を必ず通す。

以前はどちらも型キャストするだけで素通ししており、壊れたデータを1回読むと
**起動不能**になった:

1. 検証せず localStorage に保存する
2. その後の描画で `toDisplayName` が `undefined.replace` で落ちる
3. 例外は描画中なので、読み込み処理の try/catch では捕まらない
4. 保存済みなのでリロードしても落ち続ける

方針:

- **描画で使う値が揃っていることを、保存する前に保証する**
- 壊れた要素は**捨てて先に進む**。全体を拒否すると1件の破損で全部を失う
- `title` のように描画が必ず触る値は、欠けていたら補う
- **配列が入っているセクションだけを「ある」とみなす**（`has`）。
  `favorites: null` を「空で置き換える」と解釈すると既存データが消える
- 入れ子は深さ8で打ち切る。文字列にも長さ上限を置く
- ID は捏造せず、保存前に `assignMissingIds` で振る（重複も振り直す）

読み込みは**上書き**なので、`ShareModal` は検証 → 内容の提示 → 確認 → 適用の
順に分けてある。以前は無警告でお気に入りと履歴を丸ごと置き換えていた。

最後の砦として `ErrorBoundary`（`components/ErrorBoundary.tsx`）を `App` の外側に置く。
`App` 自身が保存データの読み込みで落ちるため、内側では捕まえられない。
**保存データを消して復旧するボタンを必ず出す**（白画面のままだと手動で
localStorage を消すしかなくなる）。

## 11. 表示名

パネル・枠ヘッダー・コメントセレクターの表示は `toDisplayName()`（`types.ts`）を通す。
`displayName` があればそれを、なければ `title` から `YouTube: ` などの接頭辞と
先頭の `@` を取り除いた識別子を表示する。

| 種別 | 取得元 | 追加リクエスト |
|---|---|---|
| YouTube | チャンネルページの `og:title`（経路2では `"ownerChannelName"` → `"author"`） | なし（ライブ解決と同じ応答から抽出） |
| Twitch | `twitch.tv/<login>` の `og:title`（r.jina.ai → 素のプロキシの順） | あり（表示名のためだけに1回） |

r.jina.ai には `X-Timeout: 20` を必ず付ける。これがないと描画前のHTMLが返ることがあり、
TwitchのようなSPAでは `<title>` が `Twitch` のままになって表示名が取れない。

判明した表示名は `Stream` だけでなく、同じ `type` + `sourceId` を持つ履歴・お気に入りにも
反映される（`propagateDisplayName`）。取得できなければ従来どおり識別子を表示する。

## 12. テスト

```bash
npm test        # vitest run
npm run test:watch
```

既定の環境は `node`。DOM が要るテストだけファイル先頭に
`// @vitest-environment jsdom` を書いて切り替える（jsdom の起動は遅いため）。

| ファイル | 環境 | 守っているもの |
|---|---|---|
| `utils/parseInput.test.ts` | node | URL / ハンドル / チャンネルIDの解釈 |
| `utils/resolveChannelId.test.ts` | node | `parseChannelPage` / `parseWatchPage`（YouTubeのHTML構造依存） |
| `utils/favoriteTree.test.ts` | node | ツリー操作。特に**サブツリー消失**と深度制限 |
| `utils/resolveCache.test.ts` | node | TTL の境界、期限切れの掃除、上限超過時の破棄順 |
| `utils/layout.test.ts` | node | 区画数・範囲・重なりの不変条件、保存値の復元 |
| `utils/favoriteTree.test.ts` | node | 移動の可否判定、挿入位置、**ノードを失わないこと** |
| `utils/validate.test.ts` | node | 外部入力の検証。壊れたデータで描画が落ちないこと |
| `hooks/useHoverPanel.test.tsx` | jsdom | ホバー表示・遅延非表示・アイドル・**ピン留め** |
| `components/ChatSidePanel.test.tsx` | jsdom | フックへの配線、チャンネル選択の解決 |
| `components/AddStreamModal.test.tsx` | jsdom | ペーストボタンの配線と失敗時の表示 |
| `app-main-padding.test.tsx` | jsdom | **スタイルシートのカスケード**（ピン留め時の余白） |

**フィクスチャには実際に踏んだ罠を埋め込むこと。** 例えば watch ページのフィクスチャは
`videoPrimaryInfoRenderer`（動画タイトル）を `videoOwnerRenderer` より先に配置してある。
この順序を再現していないと、かつての「動画タイトルを拾ってしまう実装」を検出できない。

テストを追加したら、**わざと壊して落ちることを確認する**。落ちないテストは無意味。

**フックのテストだけでは配線の欠落を検出できない。** 実際に、`ChatSidePanel` が
`useHoverPanel` に `isPinned` を渡し忘れて「ピン留めしてもマウスアウトで隠れる」
回帰を出したことがある。フック側は正しいままだったので、コンポーネントを
レンダリングするテストが要る。

未カバー: `useDragReorder` / `StreamGrid` の並べ替え、モーダル群。
