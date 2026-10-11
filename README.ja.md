# bonji-mobile — 悉曇（梵字）・モバイル

[English](./README.md) ｜ [繁體中文](./README.zh-Hant.md) ｜ [日本語](./README.ja.md)

**ASCII / IAST ローマ字転写**を、入力しながら **悉曇（Siddhaṁ）梵字**と**ラテン翻字**に変換するスマートフォン向け WebApp。
**入力欄はキーボードの直上、出力はその上**——打ちながら結果が見え、スクロールは不要です。

[bonji](https://github.com/scottgfhong310/bonji) のモバイル版：変換コアは同じ（[mandel59/bonji-input](https://github.com/mandel59/bonji-input)、MIT、腐敗防止層 `SiddhamConverter` 経由）、レイアウトと機能をスマートフォン向けに見直しています。
**nodeapp WebApp ファミリー**の一員です：<https://github.com/scottgfhong310/nodeapp-webapp-family>。

## 機能

- **1 画面・ページはスクロールしない**：悉曇とラテン翻字を**左右に並べ（幅 2:1）**、それぞれ独立してスクロール。文字は下揃えで入力欄の近くに表示され、末尾で入力中は最新の文字に追従します。
- **キーボードに追従**：キーボードが出ると画面がその上端まで縮みます（iOS は `visualViewport`、Android は `interactive-widget=resizes-content`）。ヘッダーは畳まれ、出力に高さを譲ります。
- **記号列（母音 → 異体字 → 体文 → 上接続 → 下接続 → 接続 → 記号）**：入力欄の右のボタンで 7 グループを切り替え（上／下接続のキーは CBETA 字形、下記〈CBETA 字形〉参照）。**母音**（`a` `aa` `i` … `a;m`）、**異体字**（`__i` 𑗘 `_i` 𑗙 `_ii` 𑗚 `__u` 𑗛）、**体文**（`aa` `i` `;m` `.h` `~m` …）、**接続**（`k` `kh` `.t` `;s` …）と**記号**（`|` 𑗅 `||` 𑗉 `--` `*1` `o2` … 句読・章節・装飾の記号）を切り替え、ワンタップ挿入（悉曇字形付き）。押してもキーボードは閉じません。分類と字形は bonji の `BonjiInput.xlsx` に基づきます。
- **オプション**（右上の `tune`）：入力方式（ISO 15919 / Kyoto-Harvard）、ラテン翻字（ISO 15919 / IAST）、スペースとハイフンを無視。
- **記録・JSON 出力**（右上の `{}`）：現在の入力に**タイトル**を付けて 1 件として記録し、リスト全体を JSON として出力（コピーまたはダウンロード）。**タイトルは空欄でも重複でも構いません**——1 つの真言を数段に分けて同じタイトルで記録すると、出力の `part` が何段目かを示します。入力中は悉曇欄の下の追加ボタンで、キーボードを閉じずに記録できます。リストはブラウザー内に保存されます（バックアップではありません）。Claude Artifacts 版では artifact のデータベースに保存され、閉じても端末を替えても残ります。
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

## JSON 出力の構造

```jsonc
{
  "app": "bonji-mobile",
  "exportedAt": "2026-10-11T01:30:09.171Z",   // コピー／ダウンロードした時刻
  "count": 2,
  "records": [
    {
      "seq": 1,                // リスト全体での順番
      "part": 1,               // 同じタイトルの中で何段目か
      "title": "大悲咒",        // 空でも重複でも可
      "options": { "inputMethod": "ISO15919", "transliteration": "IAST", "ignoreSpacesAndHyphens": true },
      "input": "na mo ra tna tra yaa ya",      // 入力そのまま
      "output": {              // 出力時に計算。変換に失敗した場合は null と "error"
        "siddham": "𑖡𑖦𑖺𑖨𑖝𑖿𑖡𑖝𑖿𑖨𑖧𑖯𑖧",
        "latin": "na mo ra tna tra yā ya",
        "ascii": "na mo ra tna tra yaa ya",    // 正規化した ASCII 記法
        "codepoints": "U+115A1 U+115A6 …"
      },
      "savedAt": "2026-10-11T01:00:00.000Z"    // この記録を保存（または置き換え）した時刻
    },
    { "seq": 2, "part": 2, "title": "大悲咒", "…": "…" }
  ]
}
```

bonji のエクスポートとの違い：1 ファイルが**リスト全体**（1 件ではない）／`input` は入力そのまま、正規化した記法は `output.ascii`／`sourceFile`・`composition` はありません。

## CBETA 字形

上接続／下接続のキーは CBETA 悉曇フォント（`Siddam`）の字形を表示します。`scripts/build-cbeta-glyphs.py` がローカルのフォントから SVG を抽出します。**このフォントには再配布の許諾がないため、SVG は本リポジトリに含まれません**——クローンした版では記法のみ表示されます（挿入は可能）。

## ライセンス

[MIT](LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310)。**bonji-input** 悉曇エンジン（MIT、© 2021 Ryusei Yamaguchi）と **Noto Sans Siddham**（SIL OFL 1.1、`fonts/OFL.txt`）を含みます。
