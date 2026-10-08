/**
 * bonji-mobile-lib.js — 純核心（IIFE → window.BonjiMobileLib）。**不碰 DOM**、零依賴。
 *
 * 悉曇轉換本身不在這裡：唯一的轉換介面是 ./siddham-converter.js（ESM 防腐層，
 * bonji 的 byte-identical 複製件）。本檔放的是**這支 app 自己的、離開畫面仍成立**的邏輯：
 *
 *   KEYSET_IDS                 記號列的兩組：'bindu'（體文）／'ligature'（接續）
 *   keysFromCatalog(cat, id)   → [{ ins, glyph }] —— 由 bonji 的 data/catalog.json 推出該組的鍵
 *   normalizeKeyset(id)        → 白名單版本（從 localStorage 讀回來的不可信）
 *   insertAt(value, s, e, t)   → { value, caret } —— 把 t 插在選取範圍 [s, e) 上
 *   shellBox(m)                → { top, height } —— 外殼該貼齊的可見範圍（鍵盤彈出後）
 *   keyboardOpen(base, h)      → boolean —— 可見高度比基準少到「一定是鍵盤」了沒
 *   normalizeOptions(o)        → 三個選項的白名單版本（從 localStorage 讀回來的不可信）
 *   normalizeDraft(d)          → { input, options } —— 草稿同上
 *
 * 資料格式：catalog `{ categories: [{ id, entries: [{ code, char, group }] }] }`（bonji 的 BonjiInput.xlsx 匯出）；
 *           草稿 `{ input: string, options: { inputMethod, transliteration, ignoreSpacesAndHyphens } }`。
 * 後端 API：無（零後端，DATABASE_GUIDELINES §0 的第 0 層）。
 */
(function (root) {
  'use strict';

  /* ---------- 記號列 ----------
   * 手機鍵盤上 `;` `.` `,` `~` 要切到符號頁才打得到，而這套記法幾乎每個字都要用
   * ⇒ 做成一鍵插入，分兩組切換（輸入框右側那顆鈕）：
   *   體文 bindu    —— 母音符號與點畫（`aa` `i` … `;m` `.h` `~m` `:-`）
   *   接續 ligature —— 子音的接續形（`k` `kh` … `h` `k.s`）
   * ⚠️ **鍵不寫死在這裡**：分類與字形是 owner 在 BonjiInput.xlsx 裡定的，經 bonji 的
   *    data/catalog.json 匯出；本 app 的 data/catalog.json 是它的 byte-identical 複製件。
   *    寫死一份就是第二份真相，xlsx 改了這裡不會知道。
   * 只取 group === 'siddham'（Unicode 悉曇，Noto 畫得出來）；Mojikyo／Siddam 兩群手機上沒有字型。
   * ⚠️ **插入的是小寫記法**：ISO 15919 的對應本來就不分大小寫（引擎先 toLowerCase），
   *    而 Kyoto-Harvard 的大寫有意義——catalog 的 `S`（舊寫法的齒音 s）在 KH 下會變成 ṣ（實測）。
   *    小寫之後兩種輸入法結果相同，記號列就不必分兩套。鍵上印的也是插入的那個字串。
   * 同一組裡同一個記法只留第一個（現況 0 個重複；防的是 xlsx 日後多一列）。 */
  var KEYSET_IDS = ['bindu', 'ligature'];

  function keysFromCatalog(catalog, id) {
    var cats = catalog && catalog.categories;
    if (!Array.isArray(cats)) return [];
    var cat = null;
    for (var i = 0; i < cats.length; i++) if (cats[i] && cats[i].id === id) { cat = cats[i]; break; }
    if (!cat || !Array.isArray(cat.entries)) return [];
    var seen = {}, out = [];
    cat.entries.forEach(function (e) {
      if (!e || e.group !== 'siddham' || typeof e.code !== 'string' || !e.code) return;
      var ins = e.code.toLowerCase();
      if (seen[ins]) return;
      seen[ins] = true;
      out.push({ ins: ins, glyph: typeof e.char === 'string' ? e.char : '' });
    });
    return out;
  }

  function normalizeKeyset(id) {
    return KEYSET_IDS.indexOf(id) >= 0 ? id : KEYSET_IDS[0];
  }

  /* ---------- 插入 ----------
   * 取代選取範圍（沒有選取時 s === e，即插在游標處）。超出範圍的索引夾回 [0, len]，
   * s > e 時對調——呼叫端讀 selectionStart/End 本來就保證 s ≤ e，這是防守。 */
  function insertAt(value, s, e, text) {
    value = String(value == null ? '' : value);
    text = String(text == null ? '' : text);
    var n = value.length;
    s = clamp(toInt(s, n), 0, n);
    e = clamp(toInt(e, s), 0, n);
    if (s > e) { var t = s; s = e; e = t; }
    return { value: value.slice(0, s) + text + value.slice(e), caret: s + text.length };
  }

  /* ---------- 可見範圍 ----------
   * m = { vvHeight, vvTop, innerHeight }（visualViewport 的高度與 offsetTop、window.innerHeight）。
   * - 有 visualViewport：外殼貼齊它（iOS Safari 鍵盤彈出時**不縮** layout viewport，
   *   還會把頁面往上推 vvTop——只看 innerHeight 的話，下半截正好被鍵盤蓋住）。
   * - 沒有：退回 innerHeight、top 0。
   * 高度取整數並至少 1：0 或負值會讓整個外殼消失，比「高度不準」糟得多。 */
  function shellBox(m) {
    m = m || {};
    var h = num(m.vvHeight);
    var top = num(m.vvTop);
    if (!(h > 0)) { h = num(m.innerHeight); top = 0; }
    if (!(h > 0)) return null;
    return { top: Math.max(0, Math.round(top || 0)), height: Math.max(1, Math.round(h)) };
  }

  // 「鍵盤開著」＝可見高度比沒有鍵盤時的基準少了一大截。
  // 門檻 120px：網址列收合／展開只差約 50–80px，不可以被當成鍵盤。
  var KEYBOARD_MIN = 120;
  function keyboardOpen(baseline, height) {
    baseline = num(baseline); height = num(height);
    if (!(baseline > 0) || !(height > 0)) return false;
    return baseline - height >= KEYBOARD_MIN;
  }

  /* ---------- 選項與草稿（從 localStorage 讀回來的，一律當成不可信） ---------- */
  var DEFAULT_OPTIONS = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  var ALLOWED = { inputMethod: ['ISO15919', 'KH'], transliteration: ['ISO15919', 'IAST'] };

  function normalizeOptions(o) {
    o = (o && typeof o === 'object') ? o : {};
    return {
      inputMethod: ALLOWED.inputMethod.indexOf(o.inputMethod) >= 0 ? o.inputMethod : DEFAULT_OPTIONS.inputMethod,
      transliteration: ALLOWED.transliteration.indexOf(o.transliteration) >= 0 ? o.transliteration : DEFAULT_OPTIONS.transliteration,
      ignoreSpacesAndHyphens: typeof o.ignoreSpacesAndHyphens === 'boolean'
        ? o.ignoreSpacesAndHyphens : DEFAULT_OPTIONS.ignoreSpacesAndHyphens
    };
  }

  function normalizeDraft(d) {
    d = (d && typeof d === 'object') ? d : {};
    return { input: typeof d.input === 'string' ? d.input : '', options: normalizeOptions(d.options) };
  }

  /* ---------- 小工具 ---------- */
  function num(x) { return typeof x === 'number' && isFinite(x) ? x : NaN; }
  function toInt(x, dflt) { return typeof x === 'number' && isFinite(x) ? Math.floor(x) : dflt; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  root.BonjiMobileLib = {
    KEYSET_IDS: KEYSET_IDS,
    KEYBOARD_MIN: KEYBOARD_MIN,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    keysFromCatalog: keysFromCatalog,
    normalizeKeyset: normalizeKeyset,
    insertAt: insertAt,
    shellBox: shellBox,
    keyboardOpen: keyboardOpen,
    normalizeOptions: normalizeOptions,
    normalizeDraft: normalizeDraft
  };
})(typeof window !== 'undefined' ? window : globalThis);
