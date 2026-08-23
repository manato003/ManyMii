# 未実装の課題

完了したものはここから消す。実装済みの内容は `docs/SPEC.md` を参照。

最終更新: 2026-08-23

---

## 優先実装（ユーザー指定）

重大バグの修正が済んでから着手する。

### 1. YouTubeチャンネルのライブID解決ロジックの修正

現状の実装は `docs/SPEC.md` 3章を参照。以下は調査で判明している具体的な欠陥。

**(a) `/channel/UCxxxx` 形式のURLが壊れる**
`parseYouTubeInput()` のコメントには「`/channel/ID` に対応」と書かれているが、
実際には `youtube.com/@name` の正規表現しかなく、`/channel/UCxxxx` はすべての分岐を
すり抜けて末尾のフォールバック
`{ sourceId: <URL全体>, inputType: 'video' }` に落ちる。
結果 `embed/https://www.youtube.com/channel/...` という不正なURLが生成される。
`/c/name` `/user/name` の旧形式も同様に未対応。

**(b) ハンドルの文字種が狭い**
URL形式のハンドル抽出が `[a-zA-Z0-9_-]+` のため、YouTubeが許可している
ピリオドや日本語を含むハンドル（`@name.official` / `@ぽぽ` など）が
URLからは取れない。`@` 始まりの直接入力なら通るので、挙動が入力方法で食い違う。

**(c) HTML構造への依存**
`<link rel="canonical">` と `"isLiveNow"` / `"hlsManifestUrl"` の文字列一致に
依存しているため、YouTube側のマークアップ変更で無言で壊れる。
壊れたときに「オフライン」ではなく「取得失敗」として出る導線は実装済み。

**(d) プロキシが単一障害点**
`api.codetabs.com` → `api.allorigins.win` の2段フォールバックのみ。
両方落ちると全チャンネル枠が取得失敗になる。

> **要確認**: 上記以外に再現している具体的な症状があれば、入力値と結果を
> 記録すること（どのチャンネルで、何を入力して、どう表示されたか）。

### 2. ドラッグ中に経路上の配信がリロードされる

配信枠をドラッグして移動させると、カーソルが通過した配信までリロードされる。

既知のメカニズム: 枠の入れ替えは配列のスワップで行っているため、React が
キー付き子要素を並べ替えると **DOM ノードが物理的に移動し、ブラウザは
iframe を再読み込みする**。これは iframe の仕様上避けられない。

対策案: DOM の順序を一切変えず、CSS Grid の `order` または `grid-area` だけで
視覚的な位置を入れ替える。`streams` 配列の順序とは別に「表示位置」を持たせる。

> **要確認**: リロードが起きるのはドロップした瞬間か、ドラッグ中に
> ハイライトが移った時点か。後者ならスワップ以外に原因がある
> （`drag-over` / `is-drag-target` のスタイル適用、`drag-target-overlay` の挿入、
> `drag-global-overlay` の `display` トグルあたりが候補）。

### 3. 配信管理パネルにチャンネル名を表示する

現状パネルに出ているのは表示名ではなく識別子。

| 種別 | 現在の表示 | 出したいもの |
|---|---|---|
| YouTube（ハンドル追加） | `@Popo_Ieiri` | チャンネルの表示名 |
| YouTube（動画URL追加） | 11桁の video ID（ハンドル解決後は `@handle`） | 同上 |
| Twitch | ログイン名（`tototmix`） | 表示名（`ととみっくす` 等） |

`Stream.title` にそのまま識別子を入れているのが原因
（`buildStream()` と `parseInput.ts` の `title`）。

実装方針:
- YouTube: 既に `/live` ページと watch ページの HTML を取得しているので、
  同じレスポンスから表示名も抜き出せる（`"author"` や `og:title` 等）。
  追加のリクエストは不要。
- Twitch: 現状スクレイピングを一切していないため、表示名の取得には
  `twitch.tv/<login>` の HTML 取得が新たに必要になる。
  APIキーは使わない方針（CLAUDE.md 設計思想3）なのでプロキシ経由になる。
- `Stream` に `displayName?: string` を追加し、パネル・枠ヘッダー・コメント
  セレクターの表示はそれを優先、未取得なら現在の `title` にフォールバックする。
- 取得できなかった場合に識別子へ戻る挙動を必ず用意すること。

---

## 品質・保守

### ESLint のエラーを解消する（現在5件）
`npm run lint` が失敗する状態。

| 箇所 | 内容 |
|---|---|
| `ChatSidePanel.tsx:50,58` | `react-hooks/set-state-in-effect`。選択中チャンネルの同期を effect でやっている |
| `useHoverPanel.ts:33` | 同上。ピン留め時の visible 同期 |
| `StreamSidePanel.tsx:112` | 三項演算子を文として使っている |
| `StreamSidePanel.tsx:169` | 未使用引数 `_targetId`（eslint 設定に `argsIgnorePattern` がない） |

### テストがない
`parseInput.ts` と `useFavorites.ts` のツリー操作は純粋関数なので、Vitest を入れれば
低コストで意味のあるカバレッジになる。フォルダ移動のバグ（サブツリー消失）は
ユニットテストなら即座に捕まる種類だった。

### 文言の管理が二重
`i18n.ts` の `t()` と、各コンポーネントでローカル定義している `label(ja, en)` が混在。
`label` は5ファイルで再定義されている。どちらかに寄せる。

### TSX 内の生カラーコード
`AddStreamModal`（`#f87171` `#f59e0b` `#22c55e`）、`ChatSidePanel`（`#8b5cf6`）、
`TwitchPlayer`（`#94a3b8`）。`--success` / `--warning` を CSS 変数に追加して置き換える。
`PlatformIcon` のブランド色（`#FF0000` / `#9146FF`）は例外でよい。

---

## 機能・UX

### お気に入りフォルダへの移動 UX
ドラッグでのフォルダ間移動は操作しにくい（`tasks/lessons.md` 参照）。
Ctrl+クリック選択＋アクションバーでの一括移動は実装済みなので、
ドラッグ移動を廃止するか、視覚的フィードバックを強化するかを決める。

### ShareModal の読み込みが無警告で全置換
お気に入りと履歴を確認なしに丸ごと上書きする。確認ダイアログか、
「マージ / 置換」の選択が欲しい。

### エラー表示が `alert()`
`ShareModal.tsx` の読み込み失敗のみ `alert()`。他はインライン表示なので浮いている。
`navigator.clipboard.writeText` の失敗も握りつぶしている。

### モーダルにフォーカストラップがない
`role="dialog"` / `aria-modal` もなし。Tab で背面のボタンに抜ける。

### Escape ハンドラの二重登録
`useKeyboardShortcuts`（モーダルを閉じる）と `StreamSidePanel`（選択解除）が
両方 window に `keydown` を張っており、同時に反応する。

### localStorage への書き込みが冗長
`activeStreams` は `streams` の全変更で `JSON.stringify` される。
枠数が多いとメインスレッドを細かく塞ぐのでデバウンス（200ms程度）を検討。

### メタ情報
`index.html` の `<title>` が `multistream-app`、favicon が `vite.svg` のまま、`lang="en"`。

### 枠の入れ替えで iframe がリロードされる
DOM の物理位置が変わるのが原因。CSS Grid の `order` で DOM 位置を変えずに
視覚的に入れ替える案が未実装。

### Twitch のオフライン判定
YouTube だけがオフライン画面を持つ。Twitch は埋め込み側の表示に任せている。
「YouTube と Twitch は対等」の方針からすると揃えるか、揃えない理由を明記すべき。

---

## 保留（やらないと決めたもの）

- **アーカイブ（VOD）同期再生** — 単一のアプリは単一の機能であるべき、という方針により削除済み
- **オフライン時に最新動画を再生するフォールバック** — 同上
- **タッチ / モバイル対応** — PC専用と割り切る
- **GitHub Pages へのデプロイ** — Vercel にデプロイ済みのため不要
