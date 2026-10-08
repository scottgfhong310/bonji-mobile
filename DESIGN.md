# bonji-mobile — 設計決議

> 版本 v1.0｜2026-10-08

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

## 2. 版型：輸出在上、輸入貼底、整頁不捲

```
┌────────────────┐
│ 頁首（鍵盤開著時收起）│
│ 悉曇（60%）         │ ← 各自捲動；游標在結尾時自動捲到底
│ 拉丁轉寫（40%）      │
├────────────────┤
│ 記號列              │
│ 輸入框（貼底）       │
└────────────────┘
     系統鍵盤
```

- **輸出在上、輸入在下**（聊天 app 的形制）：鍵盤彈出時被壓縮的只是輸出區的高度。
  反過來（bonji 的順序）鍵盤正好蓋住輸出。`verify.js` 第 ⑧ 條釘著 DOM 順序。
- **整頁不捲**：`html, body { overflow: hidden }`，捲動的只有兩塊 `.out-value`（第 ⑨ 條）。
- **兩塊輸出各自捲、各自捲到底**：一塊放一起的話，捲到底看到的是拉丁轉寫的結尾、悉曇的結尾反而在畫面外。
  只在「游標在結尾」時才捲（＝正在往後打）；游標在中間改字時不搶捲動位置。
- **比例寫進 `flex-basis`**（60% / 40%），不寫成 grow 的 3:2——basis 0 時內距會把小的那塊墊到地板，比例就不是那兩個數字（家族 memory `flex-ratio-not-the-grow-numbers`）。
- **輸入框最多長到外殼的 30%**（`--input-max`，由 `fitShell` 依外殼高度算）：再高的話輸出會被擠到看不見，那正是這支 app 要避免的。
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

## 6. 記號列

- 手機鍵盤上 `;` `.` `,` `~` 要切到符號頁才打得到，而這套記法幾乎每個字都要用 ⇒ 常用組合一鍵插入。
- **兩套**：ISO 15919（`;m` `.h` `~m` `aa` … 加上單一的 `;` `.` `,` `~` `-`）與 Kyoto-Harvard（`M` `H` `A` `T` …），隨輸入法切換。
  ⭐ KH 模式也吃 ISO 記法（實測五個範例在兩種輸入法下結果相同）⇒ 說明文字與範例不必跟著切。
- 鍵上的小悉曇字由防腐層即時算出；第 ② 條驗每一顆都真的轉得出悉曇（沒有殘留拉丁字母），
  第 ③ 條用**兩條路**驗 KH 鍵：以 KH 轉 `ins` 必須等於以 ISO 轉它宣稱的 `iso`。
- ⚠️ **按鍵不可以讓輸入框失焦**——失焦＝鍵盤收起，打一個記號就要重新點輸入框。
  擋的是 `mousedown`（觸控時是 touchend 之後補發的相容事件，它的預設動作就是搬焦點）；
  **不擋 `touchstart`**，那會連記號列的橫向捲動一起擋掉。清除鈕同理（第 ⑪ 條）。

## 7. 手機上的其他坑（都有對應的檢查）

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
