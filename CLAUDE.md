# bonji-mobile — Session context

手機優先的悉曇梵字轉換器：ASCII / IAST 羅馬轉寫即時轉成悉曇與拉丁轉寫，**輸入貼著鍵盤、輸出在上，打字的同時就看得到結果、不必捲動**。
[`bonji`](https://github.com/scottgfhong310/bonji) 的手機版；**public、零後端**。

本 app 屬於 **nodeapp WebApp 家族**；共同規範與流程在
<https://github.com/scottgfhong310/nodeapp-webapp-family>（`DESIGN_GUIDELINES.md` 規範、`WORKFLOW.md` 流程）。**改動前請先讀那兩份。**
**「為什麼長這樣」一律在 [`DESIGN.md`](./DESIGN.md)**——尤其 §3（鍵盤）與 §5（刻意不帶的功能）。

## 執行 / 驗證

```bash
npm install && npm start                 # → http://localhost:3000/apps/bonji-mobile/
npm run verify                           # 27 條契約檢查
node scripts/verify.js --selftest        # 36 個反向注入，全部必須被抓到
python3 scripts/build-cbeta-glyphs.py    # CBETA 字形（上／下接續 ＋ 接續的 6 格）→ cbeta/cbeta-ligatures.svg（⚠️ 不進 GitHub；本機要有 Siddham.ttf）
python3 artifact/build.py                # Artifacts 版 → artifact/dist/（不進版控；缺 CBETA sprite 會失敗，--no-cbeta 放行）
```

## 結構

```
app.js                                   # 只有 static ＋ / → 302 ＋ JSON 404（無 API）
scripts/verify.js                        # 契約檢查 ＋ --selftest
artifact/{build.py, vendor/materialize.min.css}   # Artifacts 版建置（差異全在 PATCHES）
public/apps/bonji-mobile/
├─ index.html · bonji-mobile.css · bonji-mobile.js   # 結構 / 樣式 / 控制器（ESM）
├─ bonji-mobile-lib.js                   # 純核心（IIFE → window.BonjiMobileLib，不碰 DOM）
├─ siddham-converter.js                  # ⚠️ bonji 的複製件（防腐層）
├─ vendor/bonji-input/                   # ⚠️ bonji 的複製件（MIT 引擎，勿改）
├─ fonts/{NotoSansSiddham-Regular.woff2, OFL.txt}   # 唯一的字型（OFL）
├─ data/catalog.json                     # ⚠️ bonji 的複製件：記號列的母音／異體字／體文／接續（來源 BonjiInput.xlsx）
├─ data/element-catalog.json             # ⚠️ bonji 的複製件：上接續／下接續（Cbeta 群，由 db_siddham 匯出）
├─ cbeta/cbeta-ligatures.svg             # ⚠️⚠️ CBETA 字形外框，**.gitignore 擋著、不進 GitHub**（只隨 Artifacts 版與 InProgress 鏡像）
├─ side-tool.css · side-tool.js · materialize-dark.css · i18n.js   # 家族共用件複製件
└─ locales/{zh-Hant,en,ja}.js
```

## 最容易做錯的幾件事

1. **輸出在上、輸入在下的 DOM 順序不可以對調**——那是這支 app 存在的理由（第 ⑧ 條）。
2. **不要把外殼改回 `100vh`／整頁捲動**：iOS 鍵盤彈出時不縮 layout viewport，輸入會被鍵盤蓋住（DESIGN §3，第 ⑨ 條）。
3. **記號列／清除鈕的 `mousedown` 要 `preventDefault`**，否則每按一下鍵盤就收起來（第 ⑪ 條）。**不要擋 `touchstart`**（記號列會捲不動）。
4. **會聚焦的控制項字級不可小於 16px**（iOS 放大整頁）；現值 20px 是為了 Artifacts 版（第 ⑩ 條）。
5. **轉換核心改 bonji 不改這裡**：`siddham-converter.js`／`vendor/`／Noto 字型都是 bonji 的 byte-identical 複製件（第 ⑱ 條）。
6. **記號列的鍵不要寫死**（六組依序：母音 → 異體字 → 體文 → 上接續 → 下接續 → 接續，第 ㉔ 條；異體字的 `__u` 靠 bonji 轉換層的副作用；接續裡的 6 格 CBETA 字形來自 catalog 的 `uniSiddham` 群、只在接續類收〔`CATALOG_CBETA_SETS` 白名單〕、位置由第 ㉗ 條釘著，見 DESIGN §6.1）：由 `data/catalog.json`（owner 的 xlsx）推出，插入一律小寫（KH 下 `S` 會變 ṣ；第 ②③ 條）。
7. **上緣安全區墊在 `.shell` 上，不要墊在 `.topbar`**——Claude App 裡會被吃進頁首的 48px，標題被遮（第 ⑳ 條）。
8. **Claude App 裡鍵盤彈出時 iframe 不縮、整頁被往上推**：輸出區上緣會被 App 標題列蓋住 ⇒ 悉曇｜拉丁**左右並排 2:1、文字靠底**、**標籤與複製鈕在欄位底部**；底部安全區以**焦點**判斷、不靠高度（第 ㉒ 條，DESIGN §3.2）。
9. **`cbeta/` 絕不可以進 GitHub**（CBETA 字形外框，字型沒有再散布授權；owner 2026-10-09 只准隨 Artifacts 版）——第 ㉕ 條盯著；`git add -A` 也擋得住，但不要用 `-f`。
10. **不要加 `local()` 字型**：手機上沒有 Mojikyo／Siddam，會畫成一般漢字而看起來正常（DESIGN §5，第 ⑯ 條）。

## 複製件登記

| 檔案 | 權威版 |
|---|---|
| `side-tool.css`／`side-tool.js`／`materialize-dark.css`／`i18n.js` | 家族 repo 根（`nodeapp-webapp-family`） |
| `siddham-converter.js`／`vendor/bonji-input/*`／`fonts/*`／`data/catalog.json`／`data/element-catalog.json` | `bonji/public/apps/bonji/` |
| `artifact/vendor/materialize.min.css` | 與 `bonji/artifact/vendor/` 那份相同（cdnjs Materialize 1.0.0） |

**改就改權威版再同步；不要在本 repo 就地改。** `verify.js` 第 ⑱ 條每次比 md5（上游不在旁邊時 SKIP，SKIP 不是 PASS）。

## Claude Artifacts 版

<https://claude.ai/artifact/WcKaiazaQr5C21Ktnc34TG>（private）。**改了前端要更新**：重跑 `build.py`，再以 Artifact 工具帶 `url` 重新發佈 `artifact/dist/` 整包（先 `read` 一次）。
