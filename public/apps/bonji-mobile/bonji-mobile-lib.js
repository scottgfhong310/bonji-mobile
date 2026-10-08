/**
 * bonji-mobile-lib.js — 純核心（IIFE → window.BonjiMobileLib）。**不碰 DOM**、零依賴。
 *
 * 悉曇轉換本身不在這裡：唯一的轉換介面是 ./siddham-converter.js（ESM 防腐層，
 * bonji 的 byte-identical 複製件）。本檔放的是**這支 app 自己的、離開畫面仍成立**的邏輯：
 *
 *   KEYSETS                    記號列的鍵（依輸入法分兩套）
 *   keysFor(inputMethod)       → 該輸入法的鍵陣列（認不得的輸入法退回 ISO15919）
 *   previewOf(key)             → { ascii, dotted } | null —— 鍵上那個小悉曇字要怎麼算
 *   insertAt(value, s, e, t)   → { value, caret } —— 把 t 插在選取範圍 [s, e) 上
 *   shellBox(m)                → { top, height } —— 外殼該貼齊的可見範圍（鍵盤彈出後）
 *   keyboardOpen(base, h)      → boolean —— 可見高度比基準少到「一定是鍵盤」了沒
 *   normalizeOptions(o)        → 三個選項的白名單版本（從 localStorage 讀回來的不可信）
 *   normalizeDraft(d)          → { input, options } —— 草稿同上
 *
 * 資料格式：草稿 `{ input: string, options: { inputMethod, transliteration, ignoreSpacesAndHyphens } }`。
 * 後端 API：無（零後端，DATABASE_GUIDELINES §0 的第 0 層）。
 */
(function (root) {
  'use strict';

  /* ---------- 記號列 ----------
   * 手機鍵盤上 `;` `.` `,` `~` 要切到符號頁才打得到，而這套記法幾乎每個字都要用
   * ⇒ 常用組合做成一鍵插入。
   * kind：'sign'（以 ◌ 承載）／'vowel'（獨立母音）／'cons'（子音＋a 示其本字）／'punct'（無預覽）。
   * iso：預覽一律用 ISO15919 記法算（KH 的鍵也換成它，算出來的字才對得上）。
   * ⚠️ 預覽只是「這顆鍵是什麼」的提示；插進輸入框的永遠是 ins。 */
  var ISO = [
    { ins: ';m', kind: 'sign' }, { ins: '.h', kind: 'sign' }, { ins: '~m', kind: 'sign' },
    { ins: 'aa', kind: 'vowel' }, { ins: 'ii', kind: 'vowel' }, { ins: 'uu', kind: 'vowel' },
    { ins: '.t', kind: 'cons' }, { ins: '.th', kind: 'cons' }, { ins: '.d', kind: 'cons' },
    { ins: '.dh', kind: 'cons' }, { ins: '.n', kind: 'cons' }, { ins: ';n', kind: 'cons' },
    { ins: '~n', kind: 'cons' }, { ins: ';s', kind: 'cons' }, { ins: '.s', kind: 'cons' },
    { ins: ',r', kind: 'vowel' },
    { ins: '-', kind: 'punct' }, { ins: ';', kind: 'punct' }, { ins: '.', kind: 'punct' },
    { ins: ',', kind: 'punct' }, { ins: '~', kind: 'punct' }
  ];
  // Kyoto-Harvard：大寫字母本來就在鍵盤上，但要按 shift，而手機的 shift 只管下一個字
  var KH = [
    { ins: 'M', iso: ';m', kind: 'sign' }, { ins: 'H', iso: '.h', kind: 'sign' },
    { ins: '~M', iso: '~m', kind: 'sign' },
    { ins: 'A', iso: 'aa', kind: 'vowel' }, { ins: 'I', iso: 'ii', kind: 'vowel' },
    { ins: 'U', iso: 'uu', kind: 'vowel' },
    { ins: 'T', iso: '.t', kind: 'cons' }, { ins: 'Th', iso: '.th', kind: 'cons' },
    { ins: 'D', iso: '.d', kind: 'cons' }, { ins: 'Dh', iso: '.dh', kind: 'cons' },
    { ins: 'N', iso: '.n', kind: 'cons' }, { ins: 'G', iso: ';n', kind: 'cons' },
    { ins: 'J', iso: '~n', kind: 'cons' }, { ins: 'z', iso: ';s', kind: 'cons' },
    { ins: 'S', iso: '.s', kind: 'cons' }, { ins: 'R', iso: ',r', kind: 'vowel' },
    { ins: '-', kind: 'punct' }
  ];
  var KEYSETS = { ISO15919: ISO, KH: KH };

  function keysFor(inputMethod) {
    return KEYSETS[inputMethod] || KEYSETS.ISO15919;
  }

  function previewOf(key) {
    if (!key || key.kind === 'punct') return null;
    var a = key.iso || key.ins;
    if (key.kind === 'cons') return { ascii: a + 'a', dotted: false };
    if (key.kind === 'sign') return { ascii: a, dotted: true };
    return { ascii: a, dotted: false };
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
    KEYSETS: KEYSETS,
    KEYBOARD_MIN: KEYBOARD_MIN,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    keysFor: keysFor,
    previewOf: previewOf,
    insertAt: insertAt,
    shellBox: shellBox,
    keyboardOpen: keyboardOpen,
    normalizeOptions: normalizeOptions,
    normalizeDraft: normalizeDraft
  };
})(typeof window !== 'undefined' ? window : globalThis);
