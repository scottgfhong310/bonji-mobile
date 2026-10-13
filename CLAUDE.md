# bonji-mobile — Session context

手機優先的悉曇梵字轉換器：ASCII / IAST 羅馬轉寫即時轉成悉曇與拉丁轉寫，**輸入貼著鍵盤、輸出在上，打字的同時就看得到結果、不必捲動**。
[`bonji`](https://github.com/scottgfhong310/bonji) 的手機版；**public、零後端**。

本 app 屬於 **nodeapp WebApp 家族**；共同規範與流程在
<https://github.com/scottgfhong310/nodeapp-webapp-family>（`DESIGN_GUIDELINES.md` 規範、`WORKFLOW.md` 流程）。**改動前請先讀那兩份。**
**「為什麼長這樣」一律在 [`DESIGN.md`](./DESIGN.md)**——尤其 §3（鍵盤）與 §5（刻意不帶的功能）。

## 執行 / 驗證

```bash
npm install && npm start                 # → http://localhost:3000/apps/bonji-mobile/
npm run verify                           # 40 條契約檢查
node scripts/verify.js --selftest        # 162 個反向注入，全部必須被抓到
python3 scripts/build-cbeta-glyphs.py    # CBETA 字形（上／下接續 ＋ 接續的 6 格）→ cbeta/cbeta-ligatures.svg（⚠️ 不進 GitHub；本機要有 Siddham.ttf）
python3 artifact/build.py                # Artifacts 版 → artifact/dist/（不進版控；缺 CBETA sprite 會失敗，--no-cbeta 放行）；發佈時的 capabilities 見建置結尾印出的那一行（downloads ＋ db）
```

## 結構

```
app.js                                   # 只有 static ＋ / → 302 ＋ JSON 404（無 API）
scripts/verify.js                        # 契約檢查 ＋ --selftest
scripts/backup-artifact.sh               # Artifacts 資料庫的紀錄清單 → 本機＋iCloud（每日排程與發佈前都走它；見檔頭）
artifact/{build.py, vendor/materialize.min.css}   # Artifacts 版建置（差異全在 PATCHES）
artifact/src/remote-db.js                # ⚠️ 只有 Artifacts 版有：紀錄清單存 artifact 的資料庫（一筆一份文件）
public/apps/bonji-mobile/
├─ index.html · bonji-mobile.css · bonji-mobile.js   # 結構 / 樣式 / 控制器（ESM）
├─ bonji-mobile-lib.js                   # 純核心（IIFE → window.BonjiMobileLib，不碰 DOM）：記號列／可見範圍／草稿／**紀錄清單與 JSON 輸出**
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
6. **記號列的鍵不要寫死**（七組依序：母音 → 異體字 → 接續 → 體文 → 上接續 → 下接續 → 符號〔owner 2026-10-11 逐項指定的順序；接續在體文前面〕，第 ㉔ 條；**畫 Unicode 字形的鍵，隨附的 Noto 都要有那個字**——Mac 上系統後備會接走、看不出缺字，由第 ㊲ 條讀字型的 cmap 盯著；異體字的 `__u` 靠 bonji 轉換層的副作用；接續裡的 6 格 CBETA 字形來自 catalog 的 `uniSiddham` 群、只在接續類收〔`CATALOG_CBETA_SETS` 白名單〕、位置由第 ㉗ 條釘著，見 DESIGN §6.1）：由 `data/catalog.json`（owner 的 xlsx）推出，插入一律小寫（KH 下 `S` 會變 ṣ；第 ②③ 條）。
7. **上緣安全區墊在 `.shell` 上，不要墊在 `.topbar`**——Claude App 裡會被吃進頁首的 48px，標題被遮（第 ⑳ 條）。
8. **Claude App 裡鍵盤彈出時 iframe 不縮、整頁被往上推**：輸出區上緣會被 App 標題列蓋住 ⇒ 悉曇｜拉丁**左右並排 2:1、文字靠底**、**標籤與複製鈕在欄位底部**；底部安全區以**焦點**判斷、不靠高度（第 ㉒ 條，DESIGN §3.2）。
9. **`cbeta/` 絕不可以進 GitHub**（CBETA 字形外框，字型沒有再散布授權；owner 2026-10-09 只准隨 Artifacts 版）——第 ㉕ 條盯著；`git add -A` 也擋得住，但不要用 `-f`。
10. **不要加 `local()` 字型**：手機上沒有 Mojikyo／Siddam，會畫成一般漢字而看起來正常（DESIGN §5，第 ⑯ 條）。
11. **紀錄清單的標題不是鍵**〔owner 2026-10-11〕：可以重複、可以留空（一部咒語分好幾段記）——**不要加查重、覆寫或合併**；同名各段靠順序分開（輸出的 `part`）。第 ㉙ 條。
12. **紀錄清單只存 input 與選項，輸出現算**（每一筆用它自己的選項，第 ㉚ 條）；清單在 `localStorage`——**方便，不是備份**，存完讀回比對、存不住要在畫面上講（第 ㉝ 條）。
13. **不要用 `confirm()`／`alert()`**：Artifacts 的 iframe 裡直接回 false。會毀掉東西的動作一律「再按一次」（`arm()`，第 ㉜ 條）。
14. ⚠️⚠️ **改標題的路上不可以有任何一行寫清單**〔2026-10-11 實際弄丟過 owner 的紀錄〕：標題存 `bonji-mobile-rec-title`、清單存 `bonji-mobile-records`，**兩格分開、各自只在自己被改時寫**；
    會寫清單的只有 `addCurrent`／`recAction`／`saveEdit`，而且都先 `syncItems()`（別的畫面改過就以儲存區為準）。**不要為了省事加一支「整份存檔」**——
    一個比較舊的畫面呼叫它一次，別處後來記的紀錄就全部被蓋掉，而畫面上什麼都不會報。第 ㉞ 條（DESIGN §10.3）。
15. ⚠️⚠️ **Artifacts 版的紀錄清單住在 artifact 的資料庫裡，不在 localStorage**〔owner 2026-10-11 實測：iPhone 的 Claude App 把 artifact 關掉重開，localStorage 就讀不回來〕。
    `artifact/src/remote-db.js`（`window.BonjiMobileRemote`）：`records/<id>` **一筆一份文件**、`state/title` 一份。**不要改成「整份清單一份文件」**——那就是第 14 條的整格重寫。
    GitHub／3001 那一份沒有它，照舊存 localStorage（第 ㉟ 條，DESIGN §10.4）。
16. **`downloadText()` 的函式本體是 `artifact/build.py` 的補丁錨點**——改它，那邊的 `DOWNLOAD_OLD` 要一起改（沒改會建置失敗，不會安靜地漏掉）。
17. **編輯某一筆（清單上的 ✎）在面板裡做，不經過主畫面**〔owner 2026-10-13〕：`startEdit`／`saveEdit` 不可以碰輸入框、標題欄、畫面上的選項；
    存回認 `id` 不認序號；編輯中唯一的出口是 儲存／取消（點面板外不關、「完成」收起來）；沒有更動不寫入、記法清空不給存。第 ㊳ 條（DESIGN §10.5）。
18. **每一筆有 `type`（類型，單行）與 `source`（來源，多行）兩欄，都可以是空的**〔owner 2026-10-13〕：面板上標題欄底下那兩格的值在加入／取代時帶入；編輯表單裡可各自改。
    類型是**自由文字＋快選鈕**（預設「真言」「種子字」＋清單裡用過的，lib 的 `typeChoices`）——不要改成固定選單，也不要把預設的詞搬進 locales（那是資料的值）；
    編輯表單裡那一排快選鈕只動表單那一格，不可以去改面板上的。
    ⚠️ 新增一個紀錄欄位要動**四個地方**，漏一個都不會報錯：lib 的 `makeRecord`（白名單，沒收就被丟掉）、`buildExport`（JSON 輸出）、
    `artifact/src/remote-db.js` 的**寫入與讀回各一處**、`scripts/backup-artifact.sh` 的 `body()`（沒算進去的話，只改那一欄的狀態不會被另存）。
    兩格的值各自一格存（`bonji-mobile-rec-type`／`state/type`、`bonji-mobile-rec-source`／`state/source`），規矩同第 14 條。舊紀錄沒有這兩欄＝空字串。第 ㊴㊵ 條（DESIGN §10.6、§10.7）。

## 複製件登記

| 檔案 | 權威版 |
|---|---|
| `side-tool.css`／`side-tool.js`／`materialize-dark.css`／`i18n.js` | 家族 repo 根（`nodeapp-webapp-family`） |
| `siddham-converter.js`／`vendor/bonji-input/*`／`fonts/*`／`data/catalog.json`／`data/element-catalog.json` | `bonji/public/apps/bonji/` |
| `artifact/vendor/materialize.min.css` | 與 `bonji/artifact/vendor/` 那份相同（cdnjs Materialize 1.0.0） |

**改就改權威版再同步；不要在本 repo 就地改。** `verify.js` 第 ⑱ 條每次比 md5（上游不在旁邊時 SKIP，SKIP 不是 PASS）。

## Claude Artifacts 版

<https://claude.ai/artifact/WcKaiazaQr5C21Ktnc34TG>（private）。**改了前端要更新**，順序固定：

1. ⚠️ **先備份資料庫裡的清單**〔owner 2026-10-11：「每次更新的時候先備份」〕——兩個動作，與每日排程走同一支腳本：
   `ArtifactData` `list` `records`（`query: {limit: 1000}`、`out_dir: /Users/Shared/nodeapp-db-backup/bonji-mobile-artifact/.pull`），記下它回報的筆數 N；
   再跑 `BM_BACKUP_CLOUD=- scripts/backup-artifact.sh /Users/Shared/nodeapp-db-backup/bonji-mobile-artifact/.pull N`
   （`BM_BACKUP_CLOUD=-`＝這次不寫 iCloud：那邊的檔只有排程覆寫得了）。**exit 不是 0 就不要發佈。**
   備份落在 `/Users/Shared/nodeapp-db-backup/bonji-mobile-artifact/`（repo 之外——本 repo 是 public，owner 記的內容不進版控）；
   清單是空的時候腳本不寫新檔，只在 `backup.log` 留一行（「備份過、當時是空的」與「沒備份」因此分得出來）。
2. 重跑 `build.py`（結尾印出要宣告的 capabilities）。
3. 以 Artifact 工具重新發佈 `artifact/dist/`（先 `read` 一次）。`capabilities` 不帶＝沿用上一版；**要改就整組重給**（沒重給的會被撤掉）。
4. 發佈後再 `list` 一次 `records`，筆數要與第 1 步相同——**更新不該動到資料**。

**每日排程**〔owner 2026-10-11：「比照 coffee-deposit」〕：`~/.claude/scheduled-tasks/bonji-mobile-artifact-backup`（每天 21:10 前後；桌面 app 開著才跑，沒開就下次啟動補跑）。
它只做兩件事——取回 `records`、呼叫 `scripts/backup-artifact.sh`；對帳、驗證、輪替（本機留最近 7 個**不同的狀態**）、iCloud 的 slot<星期> 副本、log 都在腳本裡。
**判斷成敗看 `backup.log` 最後一段與 `LAST-SUCCESS.txt`**；⚠️ 排程被停用時的症狀是「什麼都沒發生」，與「一切正常」在磁碟上長得一樣。

現在宣告的是 `downloads`（JSON 下載；沙盒會擋掉 `<a download>`）＋ `db`（紀錄清單；規則 `read`／`write` 都是 `owner`）。
