# bonji-mobile — Session context

手機優先的悉曇梵字轉換器：ASCII / IAST 羅馬轉寫即時轉成悉曇與拉丁轉寫，**輸入貼著鍵盤、輸出在上，打字的同時就看得到結果、不必捲動**。
[`bonji`](https://github.com/scottgfhong310/bonji) 的手機版；**public、零後端**。

本 app 屬於 **nodeapp WebApp 家族**；共同規範與流程在
<https://github.com/scottgfhong310/nodeapp-webapp-family>（`DESIGN_GUIDELINES.md` 規範、`WORKFLOW.md` 流程）。**改動前請先讀那兩份。**
**「為什麼長這樣」一律在 [`DESIGN.md`](./DESIGN.md)**——尤其 §3（鍵盤）與 §5（刻意不帶的功能）。

## 執行 / 驗證

```bash
npm install && npm start                 # → http://localhost:3000/apps/bonji-mobile/
npm run verify                           # 19 條契約檢查
node scripts/verify.js --selftest        # 17 個反向注入，全部必須被抓到
python3 artifact/build.py                # Artifacts 版 → artifact/dist/（不進版控）
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
├─ side-tool.css · side-tool.js · materialize-dark.css · i18n.js   # 家族共用件複製件
└─ locales/{zh-Hant,en,ja}.js
```

## 最容易做錯的幾件事

1. **輸出在上、輸入在下的 DOM 順序不可以對調**——那是這支 app 存在的理由（第 ⑧ 條）。
2. **不要把外殼改回 `100vh`／整頁捲動**：iOS 鍵盤彈出時不縮 layout viewport，輸入會被鍵盤蓋住（DESIGN §3，第 ⑨ 條）。
3. **記號列／清除鈕的 `mousedown` 要 `preventDefault`**，否則每按一下鍵盤就收起來（第 ⑪ 條）。**不要擋 `touchstart`**（記號列會捲不動）。
4. **會聚焦的控制項字級不可小於 16px**（iOS 放大整頁）；現值 20px 是為了 Artifacts 版（第 ⑩ 條）。
5. **轉換核心改 bonji 不改這裡**：`siddham-converter.js`／`vendor/`／Noto 字型都是 bonji 的 byte-identical 複製件（第 ⑱ 條）。
6. **不要加 `local()` 字型**：手機上沒有 Mojikyo／Siddam，會畫成一般漢字而看起來正常（DESIGN §5，第 ⑯ 條）。

## 複製件登記

| 檔案 | 權威版 |
|---|---|
| `side-tool.css`／`side-tool.js`／`materialize-dark.css`／`i18n.js` | 家族 repo 根（`nodeapp-webapp-family`） |
| `siddham-converter.js`／`vendor/bonji-input/*`／`fonts/*` | `bonji/public/apps/bonji/` |
| `artifact/vendor/materialize.min.css` | 與 `bonji/artifact/vendor/` 那份相同（cdnjs Materialize 1.0.0） |

**改就改權威版再同步；不要在本 repo 就地改。** `verify.js` 第 ⑱ 條每次比 md5（上游不在旁邊時 SKIP，SKIP 不是 PASS）。

## Claude Artifacts 版

<https://claude.ai/artifact/WcKaiazaQr5C21Ktnc34TG>（private）。**改了前端要更新**：重跑 `build.py`，再以 Artifact 工具帶 `url` 重新發佈 `artifact/dist/` 整包（先 `read` 一次）。
