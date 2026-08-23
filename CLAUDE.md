# CLAUDE.md - Multistream Nexus

このファイルは新しいチャットセッション開始時に必ず読み込むこと。
共通ワークフロー・原則は `C:/Dev/claude/CLAUDE.md` に定義されており、自動適用される。

---

## このアプリは何か

**YouTube と Twitch のライブ配信を複数同時に視聴するための Web アプリ。**
実装の詳細は `docs/SPEC.md`、公開先は https://multistream-app-eta.vercel.app

---

## 設計思想（最重要・勝手に変えない）

判断に迷ったらここに戻ること。過去に決着した論点なので蒸し返さない。

### 1. 視聴領域の最大化がすべてに優先する
UI は普段隠れているのが正。ヘッダーもパネルもホバーで出す。常時表示はユーザーが
明示的にピン留めしたときだけ。

### 2. 単一のアプリは単一の機能であるべき
このアプリは**ライブ配信の同時視聴専用**。アーカイブ（VOD）の同期再生は作らない。
オフライン時に最新動画を再生するフォールバックも持たない。

### 3. バックエンドを持たない
サーバーもデータベースも API キーも使わない。YouTubeのライブ解決は公開 CORS プロキシ
経由の HTML 取得で行い、状態はすべて localStorage、共有は Base64 コード。
これは制約ではなく選択。

### 4. iframe を壊さないことが絶対の技術制約
「配信が止まる・勝手にリロードされる」は最も重いバグ。
- HTML5 DnD API は使わない（`elementFromPoint` 方式）
- `StreamFrame` の `key` に `reloadKey` を含めない（全フレーム再マウントのバグが再発する）
- document 全体への `mousedown` リスナー（外クリック判定など）を追加しない

### 5. YouTube と Twitch は「結果」で対等

**同じ機能・同じロジックを実装することではない。** 最終的にユーザーが得られる
情報と体験が同等であればよい。

YouTube はライブ配信の URL が動的なのでハンドルから現在の配信を解決する処理が要り、
Twitch はチャンネルページがそのまま配信 URL なので不要。この実装量の非対称は正しい。

判断基準は「同じ処理が入っているか」ではなく「結果として同じものが見えるか」。
Twitch にオフライン判定・自動再確認・コメント欄の出し分けがないのは**問題ない**
（Twitch 側の埋め込みがオフライン表示を出すため、ユーザーから見た結果は同等）。

### 6. 明示的な「保存」操作を作らない
全状態が常時 localStorage に自動保存される。ユーザーに保存を意識させない。

### 7. 機能を足すより操作を減らす
「入力欄1つに貼れば自動判別」の方向に寄せる。トグルやボタンを増やす前に、
そもそも不要にできないか考える。

### 8. 想定利用者は自分と知人
不特定多数への公開は目的ではない。「知人が触って困らない」水準を目指し、
それ以上の作り込み（厳密なa11y対応など）は過剰。

### 9. PC 専用と割り切る
小さい画面での多窓には需要がない。タッチ操作対応は非目標。

### 10. 見た目
- **ダークモードのみ**（ライトモードは復活させない）
- 日本語が主・英語が従
- AI slop なデザイン（Inter フォント多用・紫グラデーション等）を避ける
- 色は CSS 変数を使う。TSX に生のカラーコードを書かない

---

## 作業ルール

- コードを編集したら**論理的なまとまりごとにgit commit**する（細かいコミットが安全）
- コミット: `cd "C:\Dev\projects\multistream-app"; git add <files>; git commit -m "メッセージ"`
- `git add .` は `nul` ファイルを巻き込む危険があるため、ファイルを個別に指定する
- iframeを扱う変更は特にテストを慎重に
- 実装を変えたら `docs/SPEC.md` も更新する
- UIの実装・修正時は `C:/Dev/claude/skills/frontend-design/SKILL.md` に従う
- コンポーネント作成・デザイン修正時は `C:/Dev/claude/skills/ui-ux-pro-max-skill-main/CLAUDE.md` を参照
  （本PJはカスタムCSS構成のため、Tailwind固有の指示は読み替えて適用）

---

## 推奨スキル（このPJ向け）

| 場面 | スキル |
|---|---|
| UI実装（カスタムCSS） | `C:/Dev/claude/skills/frontend-design/` |
| React UIパターン | `C:/Dev/claude/skills/antigravity/react-ui-patterns/` |
| TypeScript | `C:/Dev/claude/skills/antigravity/typescript-expert/` |
| コードレビュー | `C:/Dev/claude/skills/antigravity/code-reviewer/` |
| デバッグ | `C:/Dev/claude/skills/antigravity/debugging-strategies/` |

---

## セッション開始時のチェックリスト

- [ ] このファイルの「設計思想」を読む
- [ ] `docs/SPEC.md` を読む（実装の現状）
- [ ] `tasks/todo.md` を読む（未実装の課題）
- [ ] `tasks/lessons.md`（PJ固有）と `C:/Dev/claude/docs/lessons-global.md`（汎用）を読む
- [ ] 開発サーバーの起動確認（必要なら `npm run dev`）
