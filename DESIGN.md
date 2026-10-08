# bonji-mobile — 設計決議

> 版本 v1.2｜2026-10-08

「怎麼用」在 README，「為什麼長這樣」在這裡。家族共同規範（結構／i18n／主題／側鍵）只標引用、不重複：
[DESIGN_GUIDELINES](https://github.com/scottgfhong310/nodeapp-webapp-family/blob/main/DESIGN_GUIDELINES.md)。

---

## 1. 這支 app 為什麼存在

[`bonji`](https://github.com/scottgfhong310/bonji) 在手機上用不順，量出來的原因很具體〔2026-10-08，3001，375×812〕：

| 元素 | 位置（頁頂起算） |
|---|---|
| 輸入框 | 221–269px |
| 悉曇輸出 | 841–926px |
| 拉丁轉寫 | 972–1028px |
| 整頁 | 1445px |

**鍵盤還沒彈出，輸出就已經在第一屏之外**；iPhone 鍵盤彈出後可見高度剩約 450px，而輸入與輸出相距約 600px。
成因是兩欄在 < 992px 疊成一欄，輸入與輸出之間又夾著 Composition、提示、範例與三個選項。

**這支 app 只解決一件事：輸入的同時看得到輸出，不必捲動。** 其餘功能刻意不帶（§5）。

### 1.1 為什麼是新 repo 而不是 bonji 的第二頁〔owner 2026-10-08 拍板〕

討論時兩條路都擺上桌（第二頁的先例是 `coffee-deposit` 的 `cart.html`）。owner 選新 repo、public、零後端，連 Artifacts 版一起做。
**代價是轉換核心多一份複製件**（`siddham-converter.js` ＋ vendored 引擎，見 §4），由 `verify.js` 第 ⑱ 條逐次比 md5。

---

## 2. 版型：輸出在上（悉曇｜拉丁 2:1 並排）、輸入貼底、整頁不捲

```
┌──────────────────────┐
│ 頁首（鍵盤開著時收起）        │
│ ┌悉曇（2）────┐┌拉丁（1）┐ │ ← 各自捲動；文字靠底、貼著記號列
│ │            ││        │ │
│ │  𑖌𑖽 ……    ││ oṃ … │ │
│ └────────────┘└────────┘ │
├──────────────────────┤
│ 記號列（體文／接續）          │
│ 輸入框 ×  [體文]            │
└──────────────────────┘
        系統鍵盤
```

- **輸出在上、輸入在下**（聊天 app 的形制）：鍵盤彈出時被壓縮的只是輸出區的高度。
  反過來（bonji 的順序）鍵盤正好蓋住輸出。`verify.js` 第 ⑧ 條釘著 DOM 順序。
- **悉曇與拉丁轉寫左右並排、寬 2:1**〔owner 2026-10-08，v1.2〕：v1.1 是上下排（60%／40%），
  而 Claude App 裡鍵盤彈出時**頁面被往上推**（§3.2），輸出區的上半截落到 App 標題列底下——**悉曇整塊看不見**（owner 截圖實況）。
  並排之後兩欄同高，被推掉的只是兩欄共同的上緣那一截。
  **2:1 寫進 `flex-basis`**（`calc((100% - 8px) * 2 / 3)`）而不是 grow 的 2:1——兩塊的內距與框線相同，grow 只分剩下的寬度，
  375px 寬時實算是 1.78:1（家族 memory `flex-ratio-not-the-grow-numbers`）；實測 229／114＝2.000。
- **文字靠底**（`.out-text { margin-top: auto }`）：短的輸出貼著記號列——頁面被往上推時上緣那一截可能看不到，底部一定看得到，
  而且離輸入框最近。⚠️ **不用 `justify-content: flex-end`**：那在捲動容器裡會讓溢出的上半截捲不上去（實測 `margin-top:auto` 長內容可捲回頂端）。
  悉曇文字底部留 `.3em`：下接續／母音符號會畫出行盒之外（實測溢出 4px），內容很短也冒出一條捲軸。
- **整頁不捲**：`html, body { overflow: hidden }`，捲動的只有兩塊 `.out-value`（第 ⑨ 條）。
- **兩塊輸出各自捲、各自捲到底**：只在「游標在結尾」時才捲（＝正在往後打）；游標在中間改字時不搶捲動位置。
- **輸入框最多長到外殼的 30%**（`--input-max`）：再高的話輸出會被擠到看不見，那正是這支 app 要避免的。
- **鍵盤開著時頁首收起**（`body.kb-open`）：小螢幕上那 48px 給輸出比較有用。

## 3. 鍵盤：外殼貼齊 visualViewport

**這是本 app 唯一真正的技術風險，而且 preview 模擬不出系統鍵盤。**

- iOS Safari 鍵盤彈出時**不縮** layout viewport、還會把頁面往上推；只看 `innerHeight`／`100vh` 的話，下半截正好被鍵盤蓋住。
  ⇒ 外殼是 `position: fixed`，`top`／`height` 由 `fitShell()` 依 `visualViewport.offsetTop`／`.height` 寫進 `--shell-top`／`--shell-h`，
  監聽 `visualViewport` 的 `resize` 與 `scroll`。算式在 lib 的 `shellBox()`（純函式，第 ⑤ 條驗含 offsetTop 的情況）。
- Android Chrome：viewport meta 帶 `interactive-widget=resizes-content`，兩個 viewport 一起縮，同一套算式成立。
- 沒有 `visualViewport` 時退回 `innerHeight`，CSS 預設值是 `100dvh`。
- **「鍵盤開著」的判準**：可見高度比「輸入框沒有焦點時量到的高度」少 ≥ 120px（`keyboardOpen()`）。
  網址列收合／展開只差約 50–80px，不可以被當成鍵盤（第 ⑥ 條）。轉向後基準作廢，下一次失焦時重量。
- **toast 移到上方**：Materialize 在窄螢幕把 toast 放底部，iOS 上那是 layout viewport 的底部——**正好在鍵盤後面**，還會蓋住輸入列。

### 3.1 證據分級（刻意分開記）

| 驗了什麼 | 怎麼驗的 | 證明到哪裡 |
|---|---|---|
| 視窗縮成 375×430 時版面不溢出、整頁不捲、兩塊輸出捲到底 | preview `resize_window`（**這是 Android 的行為**：連 layout viewport 一起縮） | 版型與 `fitShell` 的 innerHeight 路徑 |
| iOS 的 `offsetTop` 路徑 | 只有 `shellBox()` 的單元測試 | 算式對，**不證明** Safari 真的那樣報值 |
| 真的在手機上打字 | **尚未** | 要 owner 在 iPhone／Android 上實測 |

### 3.2 Claude App：iframe 不縮，整頁被往上推〔owner 2026-10-08 截圖〕

owner 在 iPhone 的 Claude App 裡打字的截圖顯示兩件事，**成因是同一個**：

- 輸入列與鍵盤之間有約 32pt 的空白（≈ 底部安全區 34pt）；
- 悉曇區整塊不見，只看得到拉丁轉寫（v1.1 是上下排）。

⇒ App 裡鍵盤彈出時 **artifact 的 iframe 沒有縮**，而是整頁被往上推到輸入列落在鍵盤上方。iframe 自己的 `visualViewport` 看不到任何變化，
於是 `keyboardOpen()` 不成立：底部安全區照墊、頁首也沒收；而外殼上半截（頁首＋上排的悉曇）被推到 App 標題列底下。

- **底部安全區改以焦點判斷**：`.shell:has(#bm-input:focus) { padding-bottom: 0 }`——觸控裝置上輸入框有焦點＝鍵盤開著；桌機的 inset 本來就是 0。
  剩下的間距只有輸入列自己的 8px（＝原本 40pt 的約 20%）。
  ⚠️ preview 窗格在背景時 `document.hasFocus()` 為 false、`:focus` 不成立——**程式化的 `focus()` 量不到這條規則**，要用真的點擊（實測：點擊後 0px、失焦 34px）。
- **悉曇區看不見**：改成左右並排＋文字靠底（§2），不靠偵測。
- ✅ **owner 於 iPhone Claude App 實測確認**〔2026-10-08 14:34 截圖：「感覺很好」〕。截圖證明到哪裡，分開記：
  - 輸入列的底色一路接到鍵盤上緣，第一張截圖那條 32pt 的深色帶不見了 ⇒ **聚焦不墊底的修正有效**；
  - 兩欄的文字貼著記號列、都看得到，而**兩欄的頂端（標籤、複製鈕）落在 App 標題列底下** ⇒ 「整頁被往上推」的推論成立，
    也證明**只並排、不靠底是不夠的**；
  - owner 用體文／接續兩組實際打出 `o;m ma .ni pa dme h_uu;m`。
  ⚠️ **已知副作用**：鍵盤開著時兩欄的複製鈕被 App 標題列蓋住，要先收鍵盤才按得到（尚未處理）。
  ⚠️ iOS Safari／Android 瀏覽器上的鍵盤跟隨仍未在真機驗——這次確認的只有 Claude App。

## 4. 轉換核心：bonji 的複製件

- `siddham-converter.js`（防腐層）與 `vendor/bonji-input/`（MIT、釘選 `0a7eadd…`）是 **bonji 的 byte-identical 複製件**，權威版在 bonji。
  **改就改 bonji 再同步**；本 repo 就地改會讓兩支 app 的轉換結果分岔，而畫面上看不出來。
- ⚠️ **從 bonji 複製，不是從 `tibetan-siddham`**：那一份 vendored 引擎與 bonji 的不同（多了 14 個項目，2026-10-08 實查），
  而樹根 CLAUDE.md 寫的是兩者「同一支」。這件事尚未釐清，不在本 app 範圍內。
- 原生 ESM 的偏離同 bonji：引擎是純 ESM，控制器以 `<script type="module">` 載入；`bonji-mobile-lib.js` 仍是 IIFE → `window.BonjiMobileLib`。
- **lib 放的是本 app 自己的純邏輯**：記號列定義、游標插入、可見範圍算式、鍵盤判準、選項／草稿白名單。

## 5. 刻意不帶的功能

| bonji 有的 | 為什麼不帶 |
|---|---|
| 輔助輸入的 Cbeta／Mojikyo 兩群、Composition | 手機上沒有安裝那兩支字型，`local()` 一定落空，字格會畫成一般漢字——看起來正常卻是錯的字 |
| ASCII 記法／HTML 片段／Unicode 碼位三種輸出 | 第一屏放不下五塊；手機上的用途是「打了看結果」 |
| 標題、JSON 匯出／清單／載回 | 需要後端；本 app 零後端 |
| 兩張對照表 | 記號列＋說明取代 |

⇒ **字型只有 Noto Sans Siddham**（SIL OFL），CSS 裡**一個 `local()` 都沒有**（第 ⑯ 條）。

⚠️ **「在 iPhone 上裝 Siddam／Mojikyo 就好」行不通**〔2026-10-08 查證，owner 決定維持只用 Noto〕：
iOS 可以用描述檔或字型 App 安裝字型，但那是給原生 App 用的；**WebKit（Safari、Claude App 內嵌的網頁、iOS 上所有瀏覽器）
為了防字型指紋，只讓網頁讀到系統內建字型**，使用者自己裝的 `local()` 一律找不到（WebKit 開發者 2022 年在 webkit-dev 的說法、
WebKit bug 200627）。⚠️ 來源是 2016–2022 年的，未在現行 iOS 上實測。
網頁要畫出那兩套造字只剩「由伺服器送字型檔」一條路，而那兩支沒有再散布的授權——public repo 與 Artifacts 都不行，
只有比照 `siddham-fonts` 的孵化器私人版（不建 repo、不發佈）在授權上站得住，**owner 選擇不做**。

## 6. 記號列（體文 ⇄ 接續）

- 手機鍵盤上 `;` `.` `,` `~` 要切到符號頁才打得到，而這套記法幾乎每個字都要用 ⇒ 一鍵插入。
- **兩組，輸入框右側的鈕切換**〔owner 2026-10-08〕：**體文** 18 鍵（`a` `.h` `aa` `i` … `~m` `;m` `:-` `_u`，母音符號與點畫）／
  **接續** 34 鍵（`k` `kh` `g` … `S`→`s` `h` `k.s`，子音的接續形）。鈕上的字＝記號列現在是哪一組；偏好存 `bonji-mobile-keyset`。
  ⚠️ 位置照 owner 指定：**輸入框 → 清除 → 切換**（第 ㉑ 條）。切換鈕同樣擋 `mousedown`，正在打字時換組不收鍵盤（第 ⑪ 條）。
- ⭐ **鍵不寫死**：分類與字形是 owner 在 `BonjiInput.xlsx` 裡定的，經 bonji 的 `data/catalog.json` 匯出；
  本 app 的 `data/catalog.json` 是它的 **byte-identical 複製件**（第 ⑱ 條），`keysFromCatalog()` 只取 `group === 'siddham'`
  （Unicode 悉曇；Mojikyo／Siddam 兩群手機上沒有字型）。寫死一份就是第二份真相，xlsx 改了這裡不會知道。
  （v1.0 的記號列是寫死的兩套——ISO 15919 與 Kyoto-Harvard——已整個換掉。）
- ⚠️ **插入的是小寫記法**：ISO 15919 的對應本來就不分大小寫，而 KH 的大寫有意義——catalog 的 `S`（舊寫法的齒音 s）
  在 KH 下會變成 ṣ（實測 `𑖭𑖿` vs `𑖬𑖿`）。小寫之後 52 鍵在兩種輸入法下逐一相同（第 ③ 條），**記號列因此只要一套**。
- 鍵上的字形是 catalog 的 `char`；第 ② 條拿它與引擎轉出來的字比（兩條路取期望值：xlsx 對引擎）。
  ⚠️ **唯一的已知例外**：體文 `a` 的字形是 U+115C0（nukta），而 `a` 是固有母音、引擎不畫任何符號
  ——那是來源資料的寫法，照原樣顯示、寫成例外清單（清單以外的對不上一律紅）。
- 讀不到 `catalog.json` 時記號列上直接講出來（`keybar.loadFail`）——空著的記號列與「沒有這個功能」長得一樣。
- ⚠️ **按鍵不可以讓輸入框失焦**——失焦＝鍵盤收起。擋的是 `mousedown`（觸控時是 touchend 之後補發的相容事件，
  它的預設動作就是搬焦點）；**不擋 `touchstart`**，那會連記號列的橫向捲動一起擋掉。

## 7. 手機上的其他坑（都有對應的檢查）

- **上緣安全區墊在外殼上、不是頁首**〔owner 2026-10-08，Claude App 實測「標題被上緣遮了約 75%」〕：
  App 裡 artifact 的 `safe-area-inset-top` 約是一整個瀏海（iPhone 59px），App 的標題列就疊在那一塊上。
  v1.0 把它寫在 `.topbar` 的 `padding-top`，而頁首是 `height:48px` ＋ `border-box` ⇒ **墊高被吃進那 48px**，標題只往下移一半。
  外殼是 `position:fixed`，Artifacts 骨架給 `:root` 的那份 padding 碰不到它 ⇒ 改由 `.shell { padding-top: env(…) }` 墊，toast 的 `top` 一併讓開（第 ⑳ 條）。
  preview 無法模擬 `env()`，以注入 59px 的同等樣式量：舊寫法標題字形 50–68px（被 59px 蓋掉一半），新寫法 74–92px。
- **字級 ≥ 16px**，否則 iOS 聚焦時放大整頁；取 **20px**（`--ctl-font`），因為 Artifacts 版會被宿主等比縮小，16px 落地後小於 16 照樣放大（家族 memory `artifact-runtime-gotchas` 第 3 條）。第 ⑩ 條。
- **輸入框關掉自動大寫／自動校正**：iOS 會把句首改成大寫——KH 的大小寫有意義（`T` ≠ `t`），自動校正會把記法改成英文單字。第 ⑬ 條。
- **select 用系統原生**（`browser-default`）：Materialize 自製下拉在觸控裝置上會選到下一列（家族 `coffee-deposit` 實測）。
- **不用 `.materialize-textarea`**：它靠 keyup 長高且 `overflow:hidden`，長按貼上的內容會被裁掉；長高由 `autosize()` 自己做。
  ⚠️ `height:auto` 會把 `scrollTop` 歸零——長到上限後游標在結尾、畫面卻停在第一行（實測），量完要放回去。第 ⑫ 條。
- **範例 chip 不聚焦輸入框**：點範例是想看結果，聚焦會把鍵盤彈出來蓋掉一半輸出。
- **側鍵在手機上預設收起**（右上角 ⋮ 叫回來）：實測叫出來時會壓到拉丁轉寫的複製鈕。形制照 bonji 的 `tools-toggle.js`；
  「只在手機」只由 CSS 的 600px 決定。寬螢幕上外殼讓出側鍵那一條（`right: 70px`），實測 660px 寬時外殼右緣 590、側鍵左緣 600。

## 8. 草稿

輸入與三個選項存在 `localStorage`（`bonji-mobile-draft`），300ms debounce——手機瀏覽器會把背景分頁整個丟掉，切回來時輸入就沒了。
**這是 per-viewer 的方便，不是紀錄**：讀回來的一律經 `normalizeDraft()` 白名單（第 ⑦ 條）；讀不回（含 iOS 上 Artifacts 版那種「寫得進讀不回」）就當沒有草稿。

## 9. Artifacts 版

<https://claude.ai/artifact/WcKaiazaQr5C21Ktnc34TG>（private）。由 `python3 artifact/build.py` 組出，形制照 bonji：**不存複製件**，差異只有一處補丁
——`materialize.min.css` 自己託管（CSP 擋 cdnjs 樣式表且不報錯）。零後端 ⇒ 不需要任何 capability。

⚠️ **已知未驗**：Artifacts 版跑在宿主頁的 iframe 裡。鍵盤彈出時 iframe 自己的 `visualViewport` 會不會跟著縮，**取決於宿主怎麼排版那個 iframe**，
不是本 app 控制得了的。若手機上實測輸入被鍵盤蓋住，原因多半在這一層，要另想辦法（不是改 `fitShell` 的算式）。
