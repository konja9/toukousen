# 等高線シリーズ — 作業メモ

等高線をモチーフにした Three.js のゲームの連作です。作品一覧はルートの README.md にあります。

## 構成
- `games/<id>/` に 1 作ずつ、独立した Vite + TypeScript + three のプロジェクトとして置く。
  - 作品どうしで import しない。共通部分はコピーして改変する。
  - 各作品で `npm test` / `npm run typecheck` / `npm run build` が通ること。
- `hub/` は全作品をまとめる作品索引。公開先は https://claude.ai/artifact/Nn4DbEURDkk516CrBpSuvJ 。
- 既存の作品を変更するのは、ユーザーにそう頼まれたときだけ。

## シリーズ共通の約束
- モノクロ。夜と紙の 2 テーマ（`T` キー）。
- フォントは Inter / JetBrains Mono / Noto Sans JP。
- 音は WebAudio の合成のみで、音声ファイルは使わない。
- vite の `base: './'`（どこに置いても動くように）。
- localStorage の読み書きは try/catch で包み、キーには `toukousen-<id>:` を接頭辞として付ける。
- ゲームの状態を `window.__game` に出す（撮影や動作確認で使う）。
- `?selftest` で GPU と CPU の計算が一致しているかを確かめられるようにする。
- 遊べることをテストで保証する（例：自動操縦で完走できる）。

## 新作を作ったら
1. `hub/games.json` に登録する。
2. `node hub/tools/shoot.cjs <id>` でスクリーンショットを撮る。
3. `node hub/build.mjs` を実行する。
4. 作品索引の Artifact（上の URL）を**同じ URL で**再公開する。
   - 別の会話から更新するときは、先に read してから `url` を指定して公開する。
5. ルートの README の作品一覧に 1 行足す。

詳しい手順は `hub/README.md` にある。
