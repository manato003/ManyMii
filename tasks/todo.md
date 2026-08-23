# 未実装の課題

完了したものはここから消す。実装済みの内容は `docs/SPEC.md` を参照。

最終更新: 2026-08-23

---

## 要判断: ライブ解決の方式そのもの

2026-08-23 の実プロキシ調査で判明した状況。**対症療法は入れたが、根本は未解決。**

観測された事実:
- `api.codetabs.com` は全リクエストが 522（Connection timed out）。1回あたり19.5秒かかる
- `api.allorigins.win` は生きているが、YouTubeが**縮退ページ**を返す
  （`canonical="undefined"`、`<title> - YouTube</title>`、`isLiveNow` なし）
- `corsproxy.io` / `cors.isomorphic-git.org` は 403、`cors.lol` / `cors.workers.dev` は 429
- `r.jina.ai` はJSを実行するので**正しいライブ配信タイトルが取れる**が、
  `X-Return-Format: html` でも canonical は "undefined" のままで、video ID は
  推薦動画と混ざって特定できない

つまり **YouTubeはデータセンターIPからの `/live` 取得に中身を返さない**。
codetabs が復帰すれば従来どおり動く可能性はあるが、`/live` スクレイピングという
方式自体が不安定であることは変わらない。

選択肢:

| 案 | 内容 | 代償 |
|---|---|---|
| A | `embed/live_stream?channel=UCxxx` を直接埋め込む（YouTube自身が現在のライブを配信する） | オフライン判定とコメント欄が使えなくなる（チャットは video ID が必要）。ハンドル→チャンネルIDの解決は別途1回必要 |
| B | YouTube Data API v3 を使う（`.env` にキーはある） | 「バックエンド・APIキーを使わない」方針（CLAUDE.md 設計思想3）に反する。キーがクライアントに露出する |
| C | 現状維持（プロキシ + 縮退ページ検出） | codetabs 次第。動かないときは「取得失敗」と正直に出る |

**まず C の状態で数日運用し、codetabs が復帰するか観測してから判断するのが安全。**

---

## 優先実装（ユーザー指定）

### 1. YouTubeチャンネルのライブID解決ロジックの修正

現状の実装は `docs/SPEC.md` 3章を参照。以下は調査で判明している具体的な欠陥。

**対応済み (2026-08-23)**: 下記 (a)(b) は修正済み。(c)(d) は上記「要判断」を参照。

**(a) `/channel/UCxxxx` 形式のURLが壊れる** — 修正済み
`parseYouTubeInput()` のコメントには「`/channel/ID` に対応」と書かれているが、
実際には `youtube.com/@name` の正規表現しかなく、`/channel/UCxxxx` はすべての分岐を
すり抜けて末尾のフォールバック
`{ sourceId: <URL全体>, inputType: 'video' }` に落ちる。
結果 `embed/https://www.youtube.com/channel/...` という不正なURLが生成される。
`/c/name` `/user/name` の旧形式も同様に未対応。

**(b) ハンドルの文字種が狭い** — 修正済み
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

### 3. 配信管理パネルにチャンネル名を表示する — 実装済み (2026-08-23)

以下は残課題。

- Twitchの表示名取得は追加のプロキシリクエストが1回発生する。
  取得できなければログイン名のままなので実害はないが、プロキシが不調だと名前が出ない
- 既にお気に入り・履歴に入っている項目は、その配信を一度追加し直すまで
  表示名が埋まらない（`propagateDisplayName` が走るのが解決時のため）

<details><summary>当初の課題メモ</summary>

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
</details>

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

### 枠を拡大／復帰すると全枠がリロードされる
ダブルクリックでの拡大は `StreamGrid` が別のツリーを返すため、対象以外の枠が
すべてアンマウントされる。復帰時に全枠が再読み込みになる。
グリッドの並べ替え（`domSeq` 方式）と同じく、DOM を維持したまま
CSS で見た目だけ切り替えられないか検討する。


### Twitch のオフライン判定
YouTube だけがオフライン画面を持つ。Twitch は埋め込み側の表示に任せている。
「YouTube と Twitch は対等」の方針からすると揃えるか、揃えない理由を明記すべき。

---

## 保留（やらないと決めたもの）

- **アーカイブ（VOD）同期再生** — 単一のアプリは単一の機能であるべき、という方針により削除済み
- **オフライン時に最新動画を再生するフォールバック** — 同上
- **タッチ / モバイル対応** — PC専用と割り切る
- **GitHub Pages へのデプロイ** — Vercel にデプロイ済みのため不要
