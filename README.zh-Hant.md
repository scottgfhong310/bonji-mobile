# bonji-mobile — 悉曇梵字・手機版

[English](./README.md) ｜ [繁體中文](./README.zh-Hant.md) ｜ [日本語](./README.ja.md)

把 **ASCII / IAST 羅馬轉寫**即時轉成 **悉曇（Siddhaṁ）梵字**與**拉丁轉寫**的手機優先 WebApp。
**輸入貼著鍵盤、輸出在上**——打字的同時就看得到結果，不必捲動畫面。

是 [bonji](https://github.com/scottgfhong310/bonji) 的手機版：轉換核心相同（[mandel59/bonji-input](https://github.com/mandel59/bonji-input)，MIT，經防腐層 `SiddhamConverter` 使用），版面與功能為手機重新取捨。
本 app 屬於 **nodeapp WebApp 家族**；共同規範在 <https://github.com/scottgfhong310/nodeapp-webapp-family>。

## 功能

- **單一畫面、整頁不捲**：悉曇與拉丁轉寫各佔一塊、各自捲動；正在往後打時自動捲到最新的字。
- **跟著鍵盤**：鍵盤彈出時畫面縮到鍵盤上緣（iOS 以 `visualViewport`、Android 以 `interactive-widget=resizes-content`），頁首自動收起把高度讓給輸出。
- **記號列**：`;m` `.h` `~m` `aa` `ii` `uu` `.t` `.d` `.n` `;n` `~n` `;s` `.s` `,r` 等一鍵插入，鍵上附悉曇字預覽；按鍵不會讓鍵盤收起。切到 Kyoto-Harvard 輸入法時換成 `M` `H` `A` `T`…。
- **選項**（右上角 `tune`）：輸入法（ISO 15919 / Kyoto-Harvard）、拉丁轉寫（ISO 15919 / IAST）、忽略空格與連字號。
- 輸出各有複製鈕；範例 chips；輸入與選項自動存成草稿（只存在你的瀏覽器）。
- 內嵌 **Noto Sans Siddham**（SIL OFL）；三語介面（`zh-Hant` / `en` / `ja`）；light / dark 主題。
- **零後端**：伺服器只送靜態檔。另有 [Claude Artifacts 版](https://claude.ai/artifact/WcKaiazaQr5C21Ktnc34TG)（private）。

與 bonji 不同的地方（不帶輔助輸入的 Cbeta／Mojikyo 兩群、Composition、ASCII／HTML／碼位輸出、匯出與對照表）與理由見 [`DESIGN.md`](./DESIGN.md) §5。

## 執行

```bash
npm install
npm start                 # → http://localhost:3000/apps/bonji-mobile/
npm run verify            # 契約檢查
```

## 記法（部分）

| 輸入 | 悉曇 | 拉丁 |
|---|---|---|
| `siddha;m` | 𑖭𑖰𑖟𑖿𑖠𑖽 | siddhaṃ |
| `hrii.h` | 𑖮𑖿𑖨𑖱𑖾 | hrīḥ |
| `huu~m` | 𑖮𑖳𑖼 | hūm̐ |

完整對照見 bonji 的字元對照表。

## 授權

[MIT](LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310)。內含 **bonji-input** 悉曇引擎（MIT，© 2021 Ryusei Yamaguchi）與 **Noto Sans Siddham**（SIL OFL 1.1，見 `fonts/OFL.txt`）。
