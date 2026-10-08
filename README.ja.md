# bonji-mobile — 悉曇（梵字）・モバイル

[English](./README.md) ｜ [繁體中文](./README.zh-Hant.md) ｜ [日本語](./README.ja.md)

**ASCII / IAST ローマ字転写**を、入力しながら **悉曇（Siddhaṁ）梵字**と**ラテン翻字**に変換するスマートフォン向け WebApp。
**入力欄はキーボードの直上、出力はその上**——打ちながら結果が見え、スクロールは不要です。

[bonji](https://github.com/scottgfhong310/bonji) のモバイル版：変換コアは同じ（[mandel59/bonji-input](https://github.com/mandel59/bonji-input)、MIT、腐敗防止層 `SiddhamConverter` 経由）、レイアウトと機能をスマートフォン向けに見直しています。
**nodeapp WebApp ファミリー**の一員です：<https://github.com/scottgfhong310/nodeapp-webapp-family>。

## 機能

- **1 画面・ページはスクロールしない**：悉曇とラテン翻字を**左右に並べ（幅 2:1）**、それぞれ独立してスクロール。文字は下揃えで入力欄の近くに表示され、末尾で入力中は最新の文字に追従します。
- **キーボードに追従**：キーボードが出ると画面がその上端まで縮みます（iOS は `visualViewport`、Android は `interactive-widget=resizes-content`）。ヘッダーは畳まれ、出力に高さを譲ります。
- **記号列（体文 ⇄ 接続）**：入力欄の右のボタンで**体文**（`aa` `i` `;m` `.h` `~m` …）と**接続**（`k` `kh` `.t` `;s` …）を切り替え、ワンタップ挿入（悉曇字形付き）。押してもキーボードは閉じません。分類と字形は bonji の `BonjiInput.xlsx` に基づきます。
- **オプション**（右上の `tune`）：入力方式（ISO 15919 / Kyoto-Harvard）、ラテン翻字（ISO 15919 / IAST）、スペースとハイフンを無視。
- 出力ごとのコピーボタン、例のチップ、入力とオプションの下書き保存（ブラウザ内のみ）。
- **Noto Sans Siddham**（SIL OFL）を同梱。3 言語 UI（`zh-Hant` / `en` / `ja`）、ライト / ダーク。
- **バックエンドなし**：サーバーは静的ファイルを返すだけ。[Claude Artifacts 版](https://claude.ai/artifact/WcKaiazaQr5C21Ktnc34TG)（private）もあります。

bonji から外した機能とその理由は [`DESIGN.md`](./DESIGN.md) §5 を参照。

## 実行

```bash
npm install
npm start                 # → http://localhost:3000/apps/bonji-mobile/
npm run verify            # 契約チェック
```

## ライセンス

[MIT](LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310)。**bonji-input** 悉曇エンジン（MIT、© 2021 Ryusei Yamaguchi）と **Noto Sans Siddham**（SIL OFL 1.1、`fonts/OFL.txt`）を含みます。
