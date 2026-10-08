/**
 * bonji-mobile — 頁面控制器（glue）。ESM module：天然 defer，執行時 DOM 與所有
 * classic 依賴（jQuery / Materialize / I18n + locales / SideTool / BonjiMobileLib）皆已就緒。
 *
 * 唯一的悉曇轉換介面是 ./siddham-converter.js（SiddhamConverter 防腐層，bonji 的複製件）；
 * 本檔不得直接 import vendor/bonji-input/siddham.js。
 *
 * 碰 DOM 的行為：外殼貼齊可見範圍（fitShell）、即時轉換、記號列、輸入框長高、
 * 選項（bottom-sheet）、複製、主題、語言、工具列開關、草稿保存。
 */

import { SiddhamConverter } from "./siddham-converter.js";

(function () {
  'use strict';

  var Lib = window.BonjiMobileLib;
  var THEME_KEY = 'bonji-mobile-theme';
  var TOOLS_KEY = 'bonji-mobile-tools';   // 'on' | 'off'；手機上預設 off（側鍵會壓在輸出右緣）
  var DRAFT_KEY = 'bonji-mobile-draft';   // { input, options }（BonjiMobileLib.normalizeDraft）
  var KEYSET_KEY = 'bonji-mobile-keyset'; // 'bindu' | 'ligature'：記號列現在是哪一組

  var converter = new SiddhamConverter();
  var setIconDone = window.SideTool.setIconDone;
  var root = document.documentElement;

  var $input = document.getElementById('bm-input');
  var $keybar = document.getElementById('keybar');
  var $inputMethod = document.getElementById('opt-input-method');
  var $translit = document.getElementById('opt-translit');
  var $ignoreSpaces = document.getElementById('opt-ignore-spaces');
  var out = {
    siddham: document.getElementById('out-siddham'),
    latin: document.getElementById('out-latin')
  };

  var state = { theme: 'dark', baseline: 0, saveTimer: 0, keyset: 'bindu', catalog: null, catalogFailed: false };

  /* ---------- 外殼：貼齊可見範圍 ----------
   * iOS Safari 鍵盤彈出時不縮 layout viewport、而且會把頁面往上推；只有 visualViewport
   * 知道「現在真正看得到的是哪一塊」。外殼是 position:fixed，top／height 跟著它走
   * ⇒ 輸入永遠貼在鍵盤上緣、輸出吃掉剩下的高度，整頁不必捲。
   * Android Chrome 有 interactive-widget=resizes-content，兩個 viewport 一起縮，同一套算式也成立。 */
  function fitShell() {
    var vv = window.visualViewport;
    var box = Lib.shellBox({
      vvHeight: vv ? vv.height : NaN,
      vvTop: vv ? vv.offsetTop : NaN,
      innerHeight: window.innerHeight
    });
    if (!box) return;
    root.style.setProperty('--shell-top', box.top + 'px');
    root.style.setProperty('--shell-h', box.height + 'px');
    // 輸入框最多長到外殼的 30%：再高的話輸出會被擠到看不見，那正是這支 app 要避免的
    root.style.setProperty('--input-max', Math.max(46, Math.round(box.height * 0.3)) + 'px');

    // 「鍵盤開著」的基準＝輸入框沒有焦點時量到的高度（那時不可能有鍵盤）
    var focused = document.activeElement === $input;
    if (!focused) state.baseline = box.height;
    document.body.classList.toggle('kb-open', focused && Lib.keyboardOpen(state.baseline, box.height));
    autosize();
  }

  /* ---------- 輸入框長高 ---------- */
  function autosize() {
    // ⚠️ height:auto 會把 scrollTop 歸零：長到上限之後，游標明明在結尾，
    //    畫面卻停在第一行、看不到正在打的字（實測）⇒ 量完要把捲動位置放回去。
    var prev = $input.scrollTop;
    $input.style.height = 'auto';
    // border-box ⇒ 內容高 ＋ 上下框線各 1px
    $input.style.height = ($input.scrollHeight + 2) + 'px';
    $input.scrollTop = $input.selectionEnd === $input.value.length ? $input.scrollHeight : prev;
  }

  /* ---------- 轉換 ---------- */
  function readOptions() {
    return {
      inputMethod: $inputMethod.value,
      transliteration: $translit.value,
      ignoreSpacesAndHyphens: $ignoreSpaces.checked
    };
  }

  function convert() {
    converter.setOptions(readOptions());
    var input = $input.value;
    document.body.classList.toggle('is-empty', !input);
    if (!input) {
      out.siddham.textContent = '';
      out.latin.textContent = '';
      return;
    }
    var r;
    try {
      r = converter.convert(input);
    } catch (e) {
      console.error('SiddhamConverter.convert 失敗：', e);
      M.toast({ html: _esc(I18n.t('toast.convertFail', { m: String(e.message || e) })), classes: 'red' });
      return;
    }
    out.siddham.textContent = r.siddham;
    out.latin.textContent = r.latin;
    // 游標在結尾（＝正在往後打）時，兩塊輸出都捲到底，剛打的字才看得到（捲的是外層 .out-value）
    if ($input.selectionEnd === input.length) {
      [out.siddham, out.latin].forEach(function (el) { var box = el.parentNode; box.scrollTop = box.scrollHeight; });
    }
  }

  function onInput() {
    autosize();
    convert();
    saveDraftSoon();
  }

  /* ---------- 記號列（體文 ⇄ 接續） ----------
   * 鍵由 data/catalog.json 推出（bonji 的複製件；分類與字形是 owner 在 BonjiInput.xlsx 定的）。
   * 讀不到就在記號列上講出來——空著的記號列與「這支 app 沒有這個功能」長得一樣。 */
  function loadCatalog() {
    return fetch('./data/catalog.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (c) { state.catalog = c; })
      .catch(function (e) {
        console.error('catalog.json 讀取失敗：', e);
        state.catalogFailed = true;
      });
  }

  function renderKeybar() {
    $keybar.textContent = '';
    var keys = Lib.keysFromCatalog(state.catalog, state.keyset);
    if (!keys.length) {
      if (!state.catalog && !state.catalogFailed) return;   // 還在讀
      var note = document.createElement('span');
      note.className = 'keybar-note';
      note.textContent = I18n.t('keybar.loadFail');
      $keybar.appendChild(note);
      return;
    }
    keys.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.setAttribute('data-ins', k.ins);
      b.setAttribute('aria-label', k.ins);
      if (k.glyph) {
        var g = document.createElement('span');
        g.className = 'key-glyph';
        g.textContent = k.glyph;
        b.appendChild(g);
      }
      var s = document.createElement('span');
      s.className = 'key-ins';
      s.textContent = k.ins;
      b.appendChild(s);
      $keybar.appendChild(b);
    });
    $keybar.scrollLeft = 0;
  }

  // 鈕上的字＝記號列現在是哪一組
  function renderKeysetToggle() {
    var btn = document.getElementById('keyset-toggle');
    btn.textContent = I18n.t('keyset.' + state.keyset);
    btn.setAttribute('data-keyset', state.keyset);
  }

  function setKeyset(id) {
    state.keyset = Lib.normalizeKeyset(id);
    try { localStorage.setItem(KEYSET_KEY, state.keyset); } catch (e) {}
    renderKeysetToggle();
    renderKeybar();
  }

  function toggleKeyset() {
    var ids = Lib.KEYSET_IDS;
    setKeyset(ids[(ids.indexOf(state.keyset) + 1) % ids.length]);
  }

  function bindKeybar() {
    // ⚠️ 按鍵不可以把焦點從輸入框搶走——失焦＝鍵盤收起，打一個記號就要重新點輸入框。
    //    mousedown（觸控時是 touchend 之後補發的相容事件）的預設動作就是搬焦點 ⇒ 擋掉它。
    //    不擋 touchstart：那會連記號列的橫向捲動一起擋掉。
    $keybar.addEventListener('mousedown', function (e) {
      if (e.target.closest('.key')) e.preventDefault();
    });
    $keybar.addEventListener('click', function (e) {
      var b = e.target.closest('.key');
      if (!b) return;
      e.preventDefault();
      insert(b.getAttribute('data-ins'));
    });
  }

  function insert(text) {
    var r = Lib.insertAt($input.value, $input.selectionStart, $input.selectionEnd, text);
    $input.value = r.value;
    // 先聚焦再放游標：聚焦會把選取範圍重設到別處（iOS）
    if (document.activeElement !== $input) $input.focus();
    try { $input.setSelectionRange(r.caret, r.caret); } catch (e) {}
    onInput();
  }

  /* ---------- 複製 ---------- */
  function copyText(text) {
    function fallback() {
      return new Promise(function (resolve, reject) {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.top = '0';
          ta.style.left = '0';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          ok ? resolve() : reject(new Error('execCommand copy failed'));
        } catch (e) { reject(e); }
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    return fallback();
  }

  function copyOutput(key, trigger) {
    var text = out[key] ? out[key].textContent : '';
    if (!text) {
      M.toast({ html: _esc(I18n.t('toast.nothingToCopy')), classes: 'orange' });
      return;
    }
    copyText(text).then(function () {
      setIconDone(trigger);
      M.toast({ html: _esc(I18n.t('toast.copied')), classes: 'teal' });
    }).catch(function () {
      M.toast({ html: _esc(I18n.t('toast.copyFail')), classes: 'red' });
    });
  }

  /* ---------- 清除 ----------
   * 只清輸入；選項留著。清完把焦點放回輸入框（鍵盤若開著就留著，接著打）。
   * 本來就是空的就什麼都不做——不跳一個「已清除」騙人。 */
  function clearInput() {
    if (!$input.value) return;
    $input.value = '';
    onInput();
    setIconDone(document.getElementById('clear-input'));
    M.toast({ html: _esc(I18n.t('toast.inputCleared')), classes: 'grey' });
    $input.focus();
  }

  /* ---------- 草稿（per-viewer 的方便，不是紀錄） ----------
   * 手機瀏覽器會把背景分頁整個丟掉，切回來時輸入就沒了 ⇒ 存一份草稿。
   * ⚠️ localStorage 可能不在、會丟例外、或（iOS 上的 Artifacts 版）寫得進讀不回——
   *    一律 try/catch，讀不回就當沒有草稿，頁面照樣正常。 */
  function saveDraftSoon() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveDraft, 300);
  }
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ input: $input.value, options: readOptions() }));
    } catch (e) {}
  }
  function loadDraft() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) {}
    var d = null;
    try { d = raw ? JSON.parse(raw) : null; } catch (e) {}
    return Lib.normalizeDraft(d);
  }

  /* ---------- 主題 / 語言 / 工具列開關 ---------- */
  function applyTheme(theme) {
    state.theme = theme;
    root.setAttribute('data-theme', theme);
    // 共用 materialize-dark.css 以 html.light-mode 標記淺色，兩個 class 要一起切（§5.1）
    root.classList.toggle('dark-mode', theme === 'dark');
    root.classList.toggle('light-mode', theme === 'light');
    var icon = document.querySelector('#setting-mode i');
    if (icon) icon.textContent = theme === 'dark' ? 'dark_mode' : 'light_mode';
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  function cycleLang() {
    var next = I18n.cycle();
    M.toast({ html: _esc(I18n.t('toast.lang', { name: I18n.name(next) })), classes: 'teal' });
  }

  // 形制照 bonji 的 tools-toggle.js（xlsx-viewer 先例）；「只在手機」由 CSS 決定，這裡不判斷寬度
  function applyTools(show) {
    var btn = document.getElementById('tools-toggle');
    document.body.classList.toggle('tools-hidden', !show);
    btn.classList.toggle('active', show);
    try { localStorage.setItem(TOOLS_KEY, show ? 'on' : 'off'); } catch (e) {}
    if (show && window.SideTool && window.SideTool.refreshOverflow) window.SideTool.refreshOverflow();
  }
  function toggleTools() { applyTools(document.body.classList.contains('tools-hidden')); }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    $input.addEventListener('input', onInput);

    [$inputMethod, $translit, $ignoreSpaces].forEach(function (el) {
      el.addEventListener('change', function () {
        convert();
        saveDraftSoon();
      });
    });

    document.querySelectorAll('.examples .ex').forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        $input.value = chip.getAttribute('data-ex') || '';
        // 不聚焦：點範例是想看結果，不是要打字——聚焦會把鍵盤彈出來蓋掉一半輸出
        onInput();
      });
    });

    document.querySelectorAll('.out-copy[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        copyOutput(btn.getAttribute('data-copy'), btn);
      });
    });

    var keysetBtn = document.getElementById('keyset-toggle');
    // 同記號列：切換不該讓鍵盤收起來（正在打字時換一組鍵是常態）
    keysetBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    keysetBtn.addEventListener('click', function (e) { e.preventDefault(); toggleKeyset(); });
    document.addEventListener('i18n:changed', function () {
      renderKeysetToggle();
      if (!Lib.keysFromCatalog(state.catalog, state.keyset).length) renderKeybar();   // 失敗說明跟著語言走
    });

    var clearBtn = document.getElementById('clear-input');
    // 同記號列：按清除不該讓鍵盤收起來
    clearBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    clearBtn.addEventListener('click', function (e) { e.preventDefault(); clearInput(); });

    document.getElementById('open-options').addEventListener('click', function (e) {
      e.preventDefault();
      $input.blur();   // 先收鍵盤：bottom-sheet 從下方滑出，鍵盤開著會把它擠到看不見
      M.Modal.getInstance(document.getElementById('options-modal')).open();
    });

    var toolsBtn = document.getElementById('tools-toggle');
    toolsBtn.addEventListener('click', toggleTools);
    toolsBtn.addEventListener('keydown', function (e) {   // role="button" ⇒ Enter／Space 也要能按
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTools(); }
    });

    document.getElementById('setting-mode').addEventListener('click', function (e) {
      e.preventDefault();
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('setting-lang').addEventListener('click', function (e) {
      e.preventDefault();
      cycleLang();
    });

    $input.addEventListener('focus', fitShell);
    $input.addEventListener('blur', function () { setTimeout(fitShell, 0); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitShell);
      window.visualViewport.addEventListener('scroll', fitShell);
    }
    window.addEventListener('resize', fitShell);
    window.addEventListener('orientationchange', function () {
      state.baseline = 0;     // 轉向後舊基準作廢；下一次失焦時重量
      setTimeout(fitShell, 50);
    });
  }

  // toast 的 html 是 innerHTML：把帶進來的值（例外訊息、語言名）當文字處理
  function _esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    M.Modal.init(document.getElementById('options-modal'), {
      onCloseStart: function () { saveDraftSoon(); }
    });

    var saved = 'dark';
    try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
    applyTheme(saved === 'light' ? 'light' : 'dark');

    var tools = 'off';
    try { tools = localStorage.getItem(TOOLS_KEY) || 'off'; } catch (e) {}
    applyTools(tools === 'on');

    I18n.apply(document);

    var d = loadDraft();
    $inputMethod.value = d.options.inputMethod;
    $translit.value = d.options.transliteration;
    $ignoreSpaces.checked = d.options.ignoreSpacesAndHyphens;
    $input.value = d.input;

    var ks = null;
    try { ks = localStorage.getItem(KEYSET_KEY); } catch (e) {}
    state.keyset = Lib.normalizeKeyset(ks);
    renderKeysetToggle();

    bindKeybar();
    bindEvents();
    fitShell();
    convert();
    loadCatalog().then(function () { renderKeybar(); fitShell(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
