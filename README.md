# 等高線 — TOUKOUSEN

等高線だけで描く、小さなゲームの連作。Three.js 製。モノクロ。

**作品索引（全作品をまとめて遊べるページ）**: https://claude.ai/artifact/Nn4DbEURDkk516CrBpSuvJ

## 作品

| # | 作品 | ジャンル | ディレクトリ | 単体の公開ページ |
| --- | --- | --- | --- | --- |
| 01 | CONTOUR GLIDE | 飛行スコアアタック | [`games/glide/`](games/glide/) | https://claude.ai/artifact/DNJad1a97ViuyQzHdwS4Mc |
| 02 | SCULPT | 地形パズル | [`games/sculpt/`](games/sculpt/) | https://claude.ai/artifact/3opFczsGwckZsANPEnaEjZ |
| 03 | DEAD GROUND | ステルス × 読図 | [`games/deadground/`](games/deadground/) | https://claude.ai/artifact/2gxncYo9D3Z4K46EnHtRbL |
| 04 | SOUNDING | 潜航ローグライク | [`games/sounding/`](games/sounding/) | https://claude.ai/artifact/SENdDrEUTA2E766rw9xfvz |

各作品は独立したプロジェクトです。遊び方と仕組みは、それぞれの README にあります。

```bash
cd games/<name>
npm install
npm run dev        # 開発サーバ
npm test           # テスト
npm run build      # dist/ に静的ファイル
```

## 作品索引（ハブ）

`hub/` は、全作品を 1 ページにまとめる作品索引です。新しい作品を加える手順は [`hub/README.md`](hub/README.md) にあります。

```bash
node hub/build.mjs   # 全作品をビルドして hub/dist にまとめる
```

## 構成

```
README.md      このファイル
CLAUDE.md      作業の約束ごと（新作の追加手順など）
hub/           作品索引
games/         作品（1 作 = 1 ディレクトリ）
```
