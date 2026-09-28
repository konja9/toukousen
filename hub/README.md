# 等高線 作品索引（ハブ）

等高線シリーズの全作品を 1 つのページにまとめた「作品索引」です。

- 各作品は、カードの **PLAY** からページ内の全画面で遊べます。× で索引に戻ります。
- 各ゲームは自分の記録を localStorage に保存しています。このページで遊ぶとゲームとページが同じオリジンになるので、その記録をカードに表示できます。

公開先（Artifact）: https://claude.ai/artifact/Nn4DbEURDkk516CrBpSuvJ

新作を追加するときは、**この URL を更新します**（新しい Artifact は作りません）。

## 構成

```
hub/
  games.json        作品の登録簿（カードの内容・記録の読み方・スクリーンショットの撮り方）
  src/              ページのひな形（index.html・hub.css・hub.js）。依存ライブラリなし
  shots/            カードのスクリーンショット（コミットする）
  tools/shoot.cjs   スクリーンショットを撮る（Playwright）
  build.mjs         各作品をビルドして hub/dist にまとめる
  dist/             出力（コミットしない）
```

`node hub/build.mjs` を実行すると、次のものが `hub/dist/` にできます：

| 出力 | 内容 |
| --- | --- |
| `index.html` | 公開するページ。Artifact が文書の枠を付けるので、中身だけの断片 |
| `_local.html` | 同じページを完全な HTML 文書にしたもの（手元での確認用） |
| `<id>/…` | 各作品の本番ビルド（`dist/` の中身をそのままコピー） |
| `shots/…` | カードのスクリーンショット |
| `files.json` | 公開ファイルの一覧（公開パス → ファイル）。Artifact の `files` にそのまま渡す |

各作品のビルドを省いて `dist/` をそのまま使う場合は `--skip-build` を付けます。

## 新しい作品を追加する手順

1. 作品を `games/<id>/` に作ります（他の作品と同じく独立した Vite プロジェクト、`base: './'`）。
   - 記録は `toukousen-<id>:` という接頭辞で localStorage に保存します。
   - ゲームの状態は `window.__game` に出します（スクリーンショットの撮影で使います）。
2. `hub/games.json` に 1 件追加します。書く項目：
   - `id`、`no`（通し番号）、`dir`
   - `title`、`ja`、`genre`、`genreJa`、`tagline`、`desc`、`controls`
   - `record`、`added`、`shot`、`shoot`（省略可）
3. 記録の表示：`record.type` は既存の `score` / `stages` / `sheets` / `dive` から選びます。どれにも合わなければ、`hub/src/hub.js` の `formats` に表示関数を 1 つ足します。
4. スクリーンショットを撮ります：`cd games/<id> && npm run build`、続けて `node hub/tools/shoot.cjs <id>`。
   - `shoot` の手順（キー・待ち時間・条件）でプレイ中の場面を撮れます。
   - ソフトウェア描画ではゲーム内の時間が遅く進むので、待ち時間を固定するより `{ "until": "式" }` で条件を待つ方が確実です。
5. `node hub/build.mjs` を実行します。
6. 同じ URL に再公開します。
   - Artifact ツールで、`url` を上の URL、ページを `hub/dist/index.html`、`files` を `hub/dist/files.json` の中身にして公開します。
   - 別の会話から更新するときは、先に `action: "read"` でこの URL を読んでから公開します。
   - 古いビルドのファイルは残りますが、害はありません。消したい場合は、そのパスを `null` にして渡します。
7. ルートの README の作品一覧にも 1 行足します。
