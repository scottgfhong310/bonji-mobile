/**
 * bonji-mobile — 頁面控制器（glue）。ESM module：天然 defer，執行時 DOM 與所有
 * classic 依賴（jQuery / Materialize / I18n + locales / SideTool / BonjiMobileLib）皆已就緒。
 *
 * 唯一的悉曇轉換介面是 ./siddham-converter.js（SiddhamConverter 防腐層，bonji 的複製件）；
 * 本檔不得直接 import vendor/bonji-input/siddham.js。
 *
 * 碰 DOM 的行為：外殼貼齊可見範圍（fitShell）、即時轉換、記號列、輸入框長高、
 * 選項（bottom-sheet）、複製、主題、語言、工具列開關、草稿保存、紀錄清單與 JSON 輸出。
 */

import { SiddhamConverter } from "./siddham-converter.js";

(function () {
  'use strict';

  var Lib = window.BonjiMobileLib;
  var THEME_KEY = 'bonji-mobile-theme';
  var TOOLS_KEY = 'bonji-mobile-tools';   // 'on' | 'off'；手機上預設 off（側鍵會壓在輸出右緣）
  var DRAFT_KEY = 'bonji-mobile-draft';   // { input, options }（BonjiMobileLib.normalizeDraft）
  var KEYSET_KEY = 'bonji-mobile-keyset'; // KEYSET_IDS 之一（lib）：記號列現在是哪一組
  var REC_KEY = 'bonji-mobile-records';   // { title, items }（BonjiMobileLib.normalizeStore）：紀錄清單

  var converter = new SiddhamConverter();
  var setIconDone = window.SideTool.setIconDone;
  var root = document.documentElement;

  var $input = document.getElementById('bm-input');
  var $keybar = document.getElementById('keybar');
  var $inputMethod = document.getElementById('opt-input-method');
  var $translit = document.getElementById('opt-translit');
  var $ignoreSpaces = document.getElementById('opt-ignore-spaces');
  var $recModal = document.getElementById('records-modal');
  var $recTitle = document.getElementById('rec-title');
  var out = {
    siddham: document.getElementById('out-siddham'),
    latin: document.getElementById('out-latin')
  };

  var state = { theme: 'dark', baseline: 0, saveTimer: 0, keyset: 'vowel', catalog: null, elements: null, catalogFailed: false, sprite: {},
    rec: { title: '', items: [] }, recSaveTimer: 0, storageOk: true, storageWarned: false, armed: null, armTimer: 0 };

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
    // ⚠️ 紀錄面板的標題欄有焦點時鍵盤同樣開著——那時量到的高度不可以拿來當基準
    var focused = document.activeElement === $input;
    if (!focused && document.activeElement !== $recTitle) state.baseline = box.height;
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
      renderRecCurrent();
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
    renderRecCurrent();
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

  /* ---------- 記號列（母音 → 異體字 → 體文 → 上接續 → 下接續 → 接續） ----------
   * 鍵由 data/catalog.json 推出（bonji 的複製件；分類與字形是 owner 在 BonjiInput.xlsx 定的）。
   * 讀不到就在記號列上講出來——空著的記號列與「這支 app 沒有這個功能」長得一樣。 */
  function getJson(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function loadCatalog() {
    return Promise.all([getJson('./data/catalog.json'), getJson('./data/element-catalog.json')])
      .then(function (a) { state.catalog = a[0]; state.elements = a[1]; })
      .catch(function (e) {
        console.error('catalog.json／element-catalog.json 讀取失敗：', e);
        state.catalogFailed = true;
      })
      .then(loadSprite);
  }

  /* 上接續／下接續的 CBETA 字形（cbeta/cbeta-ligatures.svg，scripts/build-cbeta-glyphs.py 產生）。
   * ⚠️ **它刻意不在 GitHub 裡**（字型沒有再散布的授權；owner 2026-10-09：只隨 Artifacts 版與 InProgress 鏡像）
   *    ⇒ 讀不到是正常狀態，不是錯誤：那兩組的鍵照樣能插入記法，只是鍵上不畫字形。
   * 讀到就整份插進 DOM（隱藏），鍵上用 <use href="#cb-xxxx"> 引用——fill 走 currentColor，跟著主題。 */
  function loadSprite() {
    return fetch('./cbeta/cbeta-ligatures.svg', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .catch(function () { return ''; })
      .then(function (txt) {
        if (txt.indexOf('<symbol') < 0) return;
        var doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
        var svg = doc.documentElement;
        if (!svg || svg.nodeName !== 'svg') return;
        var holder = document.createElement('div');
        holder.id = 'cbeta-sprite';
        holder.hidden = true;
        holder.appendChild(document.importNode(svg, true));
        document.body.appendChild(holder);
        holder.querySelectorAll('symbol[id]').forEach(function (sym) {
          state.sprite[sym.id] = sym.getAttribute('viewBox');
        });
      });
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function cbetaGlyph(ch) {
    var id = 'cb-' + ch.codePointAt(0).toString(16);
    var vb = state.sprite[id];
    if (!vb) return null;
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', vb);
    svg.setAttribute('class', 'key-svg');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function renderKeybar() {
    $keybar.textContent = '';
    var keys = Lib.keysFor(state.catalog, state.elements, state.keyset);
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
      } else if (k.cbeta) {
        var svg = cbetaGlyph(k.cbeta);   // 沒有 sprite（GitHub 那一份）就只印記法
        if (svg) { b.appendChild(svg); b.classList.add('key-cbeta'); if (k.whole) b.classList.add('key-cbeta-whole'); }
        b.setAttribute('title', k.ins + '（CBETA U+' + k.cbeta.codePointAt(0).toString(16).toUpperCase() + '）');
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
  // host：退回 execCommand 時那個暫用 textarea 掛在哪裡。⚠️ Materialize 的 modal 開著時會把跑到它外面的焦點
  //       搶回自己身上（focus trap）⇒ 掛在 body 上的 textarea 選不住；從 modal 裡複製就傳那個 modal。
  function copyText(text, host) {
    host = host || document.body;
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
          host.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          host.removeChild(ta);
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

  /* ---------- 紀錄清單・JSON 輸出 ----------
   * 一筆紀錄＝標題＋當時的輸入＋當時的選項（lib 的 makeRecord）。**標題可以重複、可以留空**〔owner 2026-10-11〕：
   * 一部咒語分好幾段記，每一段掛同一個標題 ⇒ 加入時不查重、不覆寫。
   * 悉曇／拉丁／碼位不存：列清單與輸出 JSON 的當下，每一筆用**它自己的**選項現算（convertWith）。
   * ⚠️ 清單存在 localStorage——**那是這支瀏覽器的方便，不是備份**：可能不在、會丟例外、或（iOS 上的 Artifacts 版）
   *    寫得進讀不回。每次存完讀回來比對，對不上就在面板上講出來（不講的話看起來像 app 把清單弄丟了）。
   * ⚠️ 沒有 window.confirm：Artifacts 的 iframe 裡它不跳對話框、直接回 false ⇒ 會毀掉東西的動作
   *    （取代／刪除／全部清除／載回時蓋掉還沒記下的輸入）一律「再按一次」。 */
  function convertWith(input, options) {
    return new SiddhamConverter(options).convert(input);
  }

  function loadRecords() {
    var raw = null, d = null;
    try { raw = localStorage.getItem(REC_KEY); } catch (e) {}
    try { d = raw ? JSON.parse(raw) : null; } catch (e) {}
    return Lib.normalizeStore(d);
  }

  function saveRecords() {
    clearTimeout(state.recSaveTimer);
    var text = JSON.stringify(state.rec);
    var ok = false;
    try { localStorage.setItem(REC_KEY, text); ok = localStorage.getItem(REC_KEY) === text; } catch (e) {}
    state.storageOk = ok;
    document.getElementById('rec-storage-note').hidden = ok;
    // 面板沒開的時候（悉曇欄底下那顆加入鈕）使用者看不到面板上那行字 ⇒ 第一次存不住時講一次
    if (!ok && !state.storageWarned && state.rec.items.length) {
      state.storageWarned = true;
      M.toast({ html: _esc(I18n.t('rec.storageFail')), classes: 'orange', displayLength: 6000 });
    }
  }
  function saveRecordsSoon() {
    clearTimeout(state.recSaveTimer);
    state.recSaveTimer = setTimeout(saveRecords, 300);
  }

  function currentRecord() {
    return Lib.makeRecord($recTitle.value, $input.value, readOptions(), new Date().toISOString());
  }
  function titleOr(t) { return t || I18n.t('rec.untitled'); }
  function recToast(key, params, cls, ms) {
    M.toast({ html: _esc(I18n.t(key, params)), classes: cls, displayLength: ms || 4000 });
  }

  /* 「再按一次」：第一次按只上膛（鈕變成打勾、toast 講清楚再按一次會發生什麼），4 秒內再按同一顆才執行。 */
  function isArmed(act, i) { return !!state.armed && state.armed.act === act && state.armed.i === i; }
  function disarm() {
    clearTimeout(state.armTimer);
    state.armed = null;
  }
  function arm(act, i, key, params) {
    disarm();
    state.armed = { act: act, i: i };
    state.armTimer = setTimeout(function () { state.armed = null; renderRecords(); }, 4000);
    renderRecords();
    recToast(key, params, 'orange');
  }

  function addCurrent(trigger) {
    var rec = currentRecord();
    if (!rec) { recToast('rec.toast.nothing', null, 'orange'); return; }
    disarm();
    state.rec.items = Lib.addRecord(state.rec.items, rec);
    state.rec.title = rec.title;
    saveRecords();
    renderRecords();
    setIconDone(trigger);
    // 短一點：toast 在頁首上方，停太久會擋住紀錄鈕（加完常常接著就要開面板）
    recToast('rec.toast.added', { n: state.rec.items.length, t: titleOr(rec.title) }, 'teal', 1800);
  }

  function recAction(act, i) {
    var items = state.rec.items;
    var n = i + 1;
    if (act === 'clear') {
      if (!items.length) return;
      if (!isArmed(act, -1)) { arm(act, -1, 'rec.toast.confirmClear', { n: items.length }); return; }
      disarm();
      state.rec.items = [];
      saveRecords();
      renderRecords();
      recToast('rec.toast.cleared', { n: items.length }, 'grey');
      return;
    }
    var it = items[i];
    if (!it) return;
    if (act === 'load') {
      // 輸入框裡有還沒記下、而且與這一筆不同的內容 ⇒ 載回會把它蓋掉，先講一次
      var dirty = !!$input.value.trim() && $input.value !== it.input;
      if (dirty && !isArmed(act, i)) { arm(act, i, 'rec.toast.confirmLoad', { n: n }); return; }
      disarm();
      $recTitle.value = it.title;
      state.rec.title = it.title;
      $inputMethod.value = it.options.inputMethod;
      $translit.value = it.options.transliteration;
      $ignoreSpaces.checked = it.options.ignoreSpacesAndHyphens;
      $input.value = it.input;
      saveRecords();
      onInput();
      M.Modal.getInstance($recModal).close();
      recToast('rec.toast.loaded', { n: n, t: titleOr(it.title) }, 'teal');
      return;
    }
    if (act === 'replace') {
      var rec = currentRecord();
      if (!rec) { recToast('rec.toast.nothing', null, 'orange'); return; }
      if (!isArmed(act, i)) { arm(act, i, 'rec.toast.confirmReplace', { n: n }); return; }
      disarm();
      state.rec.items = Lib.replaceRecord(items, i, rec);
      state.rec.title = rec.title;
      saveRecords();
      renderRecords();
      recToast('rec.toast.replaced', { n: n }, 'teal');
      return;
    }
    if (act === 'remove') {
      if (!isArmed(act, i)) { arm(act, i, 'rec.toast.confirmRemove', { n: n }); return; }
      disarm();
      state.rec.items = Lib.removeRecord(items, i);
      saveRecords();
      renderRecords();
      recToast('rec.toast.removed', { n: n }, 'grey');
    }
  }

  // 只清標題欄（清單裡已經記下的各筆不動）。本來就是空的就什麼都不做——不跳一個「已清除」騙人（同 clearInput）
  function clearTitle(trigger) {
    if (!$recTitle.value) return;
    $recTitle.value = '';
    state.rec.title = '';
    saveRecords();
    setIconDone(trigger);
    recToast('rec.toast.titleCleared', null, 'grey', 1800);
  }

  // 面板上「目前的輸入」那一格＝按「加入清單」會記下的那一段（空的時候加入鈕停用）
  function renderRecCurrent() {
    var box = document.getElementById('rec-current');
    var has = !!$input.value.trim();
    box.textContent = has ? out.siddham.textContent : I18n.t('rec.currentEmpty');
    box.classList.toggle('siddham-text', has);
    box.classList.toggle('is-empty', !has);
    document.getElementById('rec-add').classList.toggle('disabled', !has);
  }

  function node(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function recButton(act, i, icon, titleKey, danger) {
    var armed = isArmed(act, i);
    var a = node('a', 'rec-btn' + (danger ? ' rec-danger' : '') + (armed ? ' armed' : ''));
    a.href = '#!';
    a.setAttribute('data-act', act);
    a.setAttribute('data-i', String(i));
    a.setAttribute('title', I18n.t(titleKey));
    a.setAttribute('aria-label', I18n.t(titleKey));
    a.appendChild(node('i', 'material-icons', armed ? 'check' : icon));
    return a;
  }

  // JSON 輸出的文字：畫面上那一份＝複製／下載的那一份（每次現算，exportedAt 是那一刻）。清單是空的回 ''。
  function refreshJson() {
    var exp = Lib.buildExport(state.rec.items, convertWith, new Date().toISOString());
    var text = exp.count ? JSON.stringify(exp, null, 2) : '';
    var pre = document.getElementById('rec-json');
    pre.textContent = text || I18n.t('rec.jsonEmpty');
    pre.classList.toggle('is-empty', !text);
    return { exp: exp, text: text };
  }

  function renderRecords() {
    var items = state.rec.items;
    var badge = document.getElementById('rec-count');
    badge.textContent = items.length ? String(items.length) : '';
    badge.hidden = !items.length;
    document.getElementById('rec-list-title').textContent = I18n.t('rec.list', { n: items.length });

    var clearBtn = document.getElementById('rec-clear');
    clearBtn.hidden = !items.length;
    clearBtn.classList.toggle('armed', isArmed('clear', -1));
    clearBtn.querySelector('i').textContent = isArmed('clear', -1) ? 'check' : 'delete_sweep';

    var exp = refreshJson().exp;
    var total = {};   // 同一個標題共有幾段——只有一段的不必標「第 1 段」
    exp.records.forEach(function (r) { total['t:' + r.title] = (total['t:' + r.title] || 0) + 1; });

    var list = document.getElementById('rec-list');
    list.textContent = '';
    if (!items.length) {
      list.appendChild(node('li', 'rec-empty', I18n.t('rec.empty')));
    }
    exp.records.forEach(function (r, i) {
      var li = node('li', 'rec-item');
      var main = node('a', 'rec-main' + (isArmed('load', i) ? ' armed' : ''));
      main.href = '#!';
      main.setAttribute('data-act', 'load');
      main.setAttribute('data-i', String(i));
      main.setAttribute('title', I18n.t('rec.load'));
      var head = node('span', 'rec-head');
      head.appendChild(node('span', 'rec-seq', String(r.seq)));
      head.appendChild(node('span', 'rec-name' + (r.title ? '' : ' is-empty'), titleOr(r.title)));
      if (total['t:' + r.title] > 1) head.appendChild(node('span', 'rec-part', I18n.t('rec.part', { p: r.part })));
      main.appendChild(head);
      // 轉不出來的那一筆把原因寫在原本放悉曇的那一行——不留白
      main.appendChild(r.output
        ? node('span', 'rec-sid', r.output.siddham)
        : node('span', 'rec-err', I18n.t('toast.convertFail', { m: r.error || '' })));
      main.appendChild(node('span', 'rec-in mono', r.input));
      li.appendChild(main);
      li.appendChild(recButton('replace', i, 'system_update_alt', 'rec.replace', false));
      li.appendChild(recButton('remove', i, 'delete', 'rec.remove', true));
      list.appendChild(li);
    });
    renderRecCurrent();
  }

  function openRecords() {
    $input.blur();   // 先收鍵盤（同選項面板）
    disarm();
    renderRecords();
    M.Modal.getInstance($recModal).open();
    // modal-fixed-footer ⇒ 捲動的是 .modal-content，它會留在上次關掉時的位置；歸零要在 open() 之後（之前是 display:none）
    $recModal.querySelector('.modal-content').scrollTop = 0;
  }

  /* 下載一段文字。回傳 Promise<boolean>：true＝交給瀏覽器了；false＝使用者自己取消（不是錯誤、不必講）。
   * ⚠️ Artifacts 版的沙盒會擋掉 <a download>（blob: 也一樣）而且不報錯
   *    ⇒ artifact/build.py 把這一整支換成走 downloads capability 的版本（錨點就是這支函式的全文，改這裡那邊會建置失敗）。 */
  function downloadText(name, text) {
    return new Promise(function (resolve) {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      resolve(true);
    });
  }

  function copyJson(trigger) {
    var text = refreshJson().text;
    if (!text) { recToast('rec.toast.empty', null, 'orange'); return; }
    copyText(text, $recModal).then(function () {
      setIconDone(trigger);
      M.toast({ html: _esc(I18n.t('toast.copied')), classes: 'teal' });
    }).catch(function () {
      M.toast({ html: _esc(I18n.t('toast.copyFail')), classes: 'red' });
    });
  }

  function downloadJson(trigger) {
    var text = refreshJson().text;
    if (!text) { recToast('rec.toast.empty', null, 'orange'); return; }
    var name = Lib.exportFilename(new Date());
    downloadText(name, text).then(function (done) {
      if (!done) return;
      setIconDone(trigger);
      recToast('toast.downloaded', { n: name }, 'teal');
    }).catch(function (err) {
      recToast('rec.toast.downloadFail', { m: String((err && (err.message || err.code)) || err) }, 'red');
    });
  }

  function bindRecords() {
    document.getElementById('open-records').addEventListener('click', function (e) {
      e.preventDefault();
      openRecords();
    });

    // 悉曇欄底下那顆：正在打字時按它不該讓鍵盤收起來（打一段、加一筆、接著打下一段）
    var quick = document.getElementById('rec-add-quick');
    quick.addEventListener('mousedown', function (e) { e.preventDefault(); });
    quick.addEventListener('click', function (e) { e.preventDefault(); addCurrent(quick); });

    document.getElementById('rec-add').addEventListener('click', function (e) {
      e.preventDefault();
      addCurrent(e.currentTarget);
    });
    document.getElementById('rec-clear').addEventListener('click', function (e) {
      e.preventDefault();
      recAction('clear', -1);
    });
    document.getElementById('rec-list').addEventListener('click', function (e) {
      var a = e.target.closest('[data-act]');
      if (!a) return;
      e.preventDefault();
      recAction(a.getAttribute('data-act'), parseInt(a.getAttribute('data-i'), 10));
    });
    document.getElementById('rec-copy').addEventListener('click', function (e) {
      e.preventDefault();
      copyJson(e.currentTarget);
    });
    document.getElementById('rec-download').addEventListener('click', function (e) {
      e.preventDefault();
      downloadJson(e.currentTarget);
    });

    // 標題：邊打邊存（不改寫欄位裡的字——正規化只發生在記下來的那一刻）
    $recTitle.addEventListener('input', function () {
      state.rec.title = Lib.normalizeTitle($recTitle.value);
      saveRecordsSoon();
    });
    // 清除標題：擋 mousedown ⇒ 焦點維持原狀——正在打標題時鍵盤留著接著打，沒在打時鍵盤不會跳出來
    var titleClear = document.getElementById('rec-title-clear');
    titleClear.addEventListener('mousedown', function (e) { e.preventDefault(); });
    titleClear.addEventListener('click', function (e) { e.preventDefault(); clearTitle(titleClear); });
    $recTitle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $recTitle.blur(); }   // 單行欄位：Enter＝打完了，收鍵盤
    });
    $recTitle.addEventListener('blur', function () { setTimeout(fitShell, 0); });
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
      renderRecords();   // 清單裡的「第 n 段」「（無標題）」與空狀態跟著語言走
      renderKeysetToggle();
      if (!Lib.keysFor(state.catalog, state.elements, state.keyset).length) renderKeybar();   // 失敗說明跟著語言走
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
    // onCloseStart 而不是 onCloseEnd：背景分頁裡動畫不推進，End 不會來（家族 memory animation-complete-callbacks-stall）
    M.Modal.init($recModal, {
      onCloseStart: function () { $recTitle.blur(); disarm(); saveRecords(); }
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

    state.rec = loadRecords();
    $recTitle.value = state.rec.title;
    // 探針：寫進去再讀回來比對（問「localStorage 在不在」永遠回「在」）。⚠️ 只證明這一刻存得住，證明不了撐得過關掉頁面
    var probeOk = false;
    try {
      localStorage.setItem(REC_KEY + '-probe', '1');
      probeOk = localStorage.getItem(REC_KEY + '-probe') === '1';
      localStorage.removeItem(REC_KEY + '-probe');
    } catch (e) {}
    state.storageOk = probeOk;
    document.getElementById('rec-storage-note').hidden = probeOk;

    bindKeybar();
    bindEvents();
    bindRecords();
    fitShell();
    convert();
    renderRecords();
    loadCatalog().then(function () { renderKeybar(); fitShell(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
