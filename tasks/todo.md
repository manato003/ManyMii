# 未実装の課題

完了したものはここから消す。実装済みの内容は `docs/SPEC.md` を参照。

最終更新: 2026-08-23

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
