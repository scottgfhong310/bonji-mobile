/**
 * bonji-mobile-lib.js — 純核心（IIFE → window.BonjiMobileLib）。**不碰 DOM**、零依賴。
 *
 * 悉曇轉換本身不在這裡：唯一的轉換介面是 ./siddham-converter.js（ESM 防腐層，
 * bonji 的 byte-identical 複製件）。本檔放的是**這支 app 自己的、離開畫面仍成立**的邏輯：
 *
 *   KEYSET_IDS                 記號列的七組（切換順序）：'vowel'（母音）→ 'variant'（異體字）→ 'ligature'（接續）→ 'bindu'（體文）
 *                              → 'ligature_u'（上接續）→ 'ligature_l'（下接續）→ 'symbol'（符號）
 *   keysFromCatalog(cat, id)   → [{ ins, glyph }] —— 由 bonji 的 data/catalog.json 推出該組的鍵
 *   keysFromElements(el, id)   → [{ ins, cbeta }] —— 由 data/element-catalog.json 的 Cbeta 群推出（上／下接續）
 *   keysFor(cat, el, id)       → 依組別分派到上面兩支
 *   normalizeKeyset(id)        → 白名單版本（從 localStorage 讀回來的不可信）
 *   insertAt(value, s, e, t)   → { value, caret } —— 把 t 插在選取範圍 [s, e) 上
 *   shellBox(m)                → { top, height } —— 外殼該貼齊的可見範圍（鍵盤彈出後）
 *   keyboardOpen(base, h)      → boolean —— 可見高度比基準少到「一定是鍵盤」了沒
 *   normalizeOptions(o)        → 三個選項的白名單版本（從 localStorage 讀回來的不可信）
 *   normalizeDraft(d)          → { input, options } —— 草稿同上
 *   normalizeTitle(t)          → 標題的單行版本（**可以是空的、可以重複**）
 *   makeRecord(t, i, o, iso, id, order) → 一筆紀錄 `{ title, input, options, savedAt, id, order }`；input 是空的回 null
 *   normalizeStore(s)          → { title, items } —— 紀錄清單（從 localStorage 讀回來的不可信）
 *   storeDrift(last, now)      → 'same' | 'changed' | 'lost' —— 儲存區裡的清單與這個畫面上次看到的比起來怎麼了
 *   nextOrder(items, now)      → 新的一筆的排序值（一定排在現有每一筆之後）
 *   mergeRemote(remote, put, del) → 遠端清單 ⊕ 這個畫面還沒被確認的寫入，依 order 排（Artifacts 版的同步用）
 *   addRecord／replaceRecord／removeRecord(items, …) → 新陣列（不改輸入）
 *   indexOfId(items, id)       → 那一筆現在在第幾格（找不到 -1）
 *   editRecord(orig, t, i, o, iso) → 編輯後的那一筆（id／order 沿用）；沒有更動回 orig 本身、input 清空回 null
 *   buildExport(items, convert, iso) → JSON 輸出的那個物件（輸出是匯出當下**算出來的**，不落地）
 *   exportFilename(date)       → `bonji-mobile-yyyyMMddHHmmss.json`
 *
 * 資料格式：catalog `{ categories: [{ id, entries: [{ code, char, group }] }] }`（bonji 的 BonjiInput.xlsx 匯出）；
 *           草稿 `{ input: string, options: { inputMethod, transliteration, ignoreSpacesAndHyphens } }`；
 *           紀錄清單 `{ items: [{ title, input, options, savedAt, id, order }] }`（標題欄的值另存一格，見控制器；舊格式的 `title` 仍讀得懂）；
 *           `id`＝這一筆的身分（Artifacts 版一筆一份文件，文件名就是它）、`order`＝排序值；兩者都**不進 JSON 輸出**。
 *           JSON 輸出 `{ app, exportedAt, count, records: [{ seq, part, title, options, input, output, savedAt }] }`。
 * 後端 API：無（零後端，DATABASE_GUIDELINES §0 的第 0 層）。
 */
(function (root) {
  'use strict';

  /* ---------- 記號列 ----------
   * 手機鍵盤上 `;` `.` `,` `~` 要切到符號頁才打得到，而這套記法幾乎每個字都要用
   * ⇒ 做成一鍵插入，分七組切換（輸入框右側那顆鈕，依 KEYSET_IDS 的順序循環）。
   *    ⭐ **順序是 owner 逐項指定的**〔2026-10-11：母音 → 異體字 → 接續 → 體文 → 上接續 → 下接續 → 符號〕——
   *       打一個音節的手順是「子音（接續）→ 母音符號與點畫（體文）」，所以接續排在體文前面。下面各組的說明不照這個順序排：
   *   母音 vowel    —— 獨立母音（`a` `aa` `i` … `au` `a;m` `a~m` `a.h`）
   *   異體字 variant —— 獨立母音的異體（`__i` 𑗘 `_i` 𑗙 `_ii` 𑗚 `__u` 𑗛；Mojikyo 那 3 格沒有記法、group 也不是 siddham，不會進來）
   *                    ⚠️ `__u` 不是引擎的記法：引擎的 u 異體是 `_u`，而轉換層把 `_u` 定義成替代母音符號 𑗜，
   *                    `__u` 轉得出 𑗛 是轉換層留下前面那個 `_` 的結果——由 verify.js 第 ② 條逐一盯著
   *   體文 bindu    —— 母音符號與點畫（`aa` `i` … `;m` `.h` `~m` `:-`）
   *   上接續 ligature_u／下接續 ligature_l —— CBETA 造字的上半／下半部件（見 keysFromElements）
   *   接續 ligature —— 子音的接續形（`k` `kh` … `h` `k.s`）
   * ⚠️ **鍵不寫死在這裡**：分類與字形是 owner 在 BonjiInput.xlsx 裡定的，經 bonji 的
   *    data/catalog.json 匯出；本 app 的 data/catalog.json 是它的 byte-identical 複製件。
   *    寫死一份就是第二份真相，xlsx 改了這裡不會知道。
   * 只取 group === 'siddham'（Unicode 悉曇，Noto 畫得出來）；Mojikyo／Siddam 兩群手機上沒有字型。
   * ⚠️ **插入的是小寫記法**：ISO 15919 的對應本來就不分大小寫（引擎先 toLowerCase），
   *    而 Kyoto-Harvard 的大寫有意義——catalog 的 `S`（舊寫法的齒音 s）在 KH 下會變成 ṣ（實測）。
   *    小寫之後兩種輸入法結果相同，記號列就不必分兩套。鍵上印的也是插入的那個字串。
   * 同一組裡同一個記法只留第一個（現況 0 個重複；防的是 xlsx 日後多一列）。 */
  // 符號 symbol〔owner 2026-10-11〕—— catalog 的 symbol 類：句讀與章節記號（`|` 𑗅 `||` 𑗉 `--` `,,` `..` `*` `2` `@` `=`）
  //   與裝飾記號（`*1`～`*7` `*0` `o2` `o2x` `ox2`～`ox4` `oxx`）。全是 Unicode 悉曇（group siddham），Noto 畫得出來。
  //   排在最後〔owner 2026-10-11 指定的順序〕。
  var KEYSET_IDS = ['vowel', 'variant', 'ligature', 'bindu', 'ligature_u', 'ligature_l', 'symbol'];
  // 這兩組的資料不在 catalog.json（那裡只有 Mojikyo 群），而在 element-catalog.json 的 Cbeta 群
  var ELEMENT_SETS = { ligature_u: true, ligature_l: true };

  /* catalog.json 裡 `uniSiddham` 群（CBETA `Siddam` 字型）的格，只在這幾類收進記號列，鍵上畫 CBETA 字形的 SVG。
   * 〔owner 2026-10-09：接續加 6 格 CBETA 字形（盄 眈 眄 盷 矧 祋），各自接在同音的 Unicode 那一格之後〕
   * ⚠️ 刻意是白名單、不是「所有類別都收 uniSiddham」：母音類也有一格（`a~m` 焐），owner 沒有要它進記號列。 */
  var CATALOG_CBETA_SETS = { ligature: true };

  function keysFromCatalog(catalog, id) {
    var cats = catalog && catalog.categories;
    if (!Array.isArray(cats)) return [];
    var cat = null;
    for (var i = 0; i < cats.length; i++) if (cats[i] && cats[i].id === id) { cat = cats[i]; break; }
    if (!cat || !Array.isArray(cat.entries)) return [];
    var seen = {}, out = [];
    cat.entries.forEach(function (e) {
      if (!e || typeof e.code !== 'string' || !e.code || typeof e.char !== 'string') return;
      var cbeta = e.group === 'uniSiddham' && CATALOG_CBETA_SETS[id];
      if (e.group !== 'siddham' && !cbeta) return;
      var ins = e.code.toLowerCase();
      // 去重的鍵是（記法, 字形）：同一個記法的 Unicode 字形與 CBETA 字形是兩顆鍵（`.t` 𑖘𑖿 與 `.t` 盄）
      var key = ins + '|' + e.char;
      if (seen[key]) return;
      seen[key] = true;
      // whole：完整字母（不是上／下接續那種部件）——控制器據此把字形畫小一點，與旁邊的 Noto 字同大
      out.push(cbeta ? { ins: ins, cbeta: e.char, whole: true } : { ins: ins, glyph: e.char });
    });
    return out;
  }

  /* 上接續／下接續：`data/element-catalog.json`（bonji 的複製件，由 db_siddham 匯出）的 Cbeta 群。
   * 每格一個 CJK 碼位，要用 CBETA 的 `Siddam` 字型才畫得出悉曇部件——手機上沒有那支字型，
   * 所以鍵上的字形改畫 `cbeta/cbeta-ligatures.svg` 裡的同一個字（scripts/build-cbeta-glyphs.py 產生；
   * ⚠️ 不進 GitHub，見該腳本檔頭）。本函式只回 `cbeta`（那個碼位），畫不畫得出來是控制器的事。
   * ⚠️ **不去重**：同一個記法有好幾個字形（上接續 `k` 有 3 種），每個字形一顆鍵——認出字形正是這兩組的用途。
   * 插入一律小寫（同 keysFromCatalog）；沒有記法的格略過（插不進任何東西）。 */
  function keysFromElements(elements, id) {
    var groups = elements && elements.groups;
    if (!Array.isArray(groups)) return [];
    var g = null;
    for (var i = 0; i < groups.length; i++) if (groups[i] && groups[i].id === 'cbeta') { g = groups[i]; break; }
    var cats = g && g.categories;
    if (!Array.isArray(cats)) return [];
    var cat = null;
    for (var j = 0; j < cats.length; j++) if (cats[j] && cats[j].id === id) { cat = cats[j]; break; }
    if (!cat || !Array.isArray(cat.entries)) return [];
    var out = [];
    cat.entries.forEach(function (e) {
      if (!e || typeof e.code !== 'string' || !e.code || typeof e.char !== 'string' || !e.char) return;
      out.push({ ins: e.code.toLowerCase(), cbeta: e.char });
    });
    return out;
  }

  function keysFor(catalog, elements, id) {
    return ELEMENT_SETS[id] ? keysFromElements(elements, id) : keysFromCatalog(catalog, id);
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

  /* ---------- 紀錄清單與 JSON 輸出 ----------
   * 一筆紀錄＝「標題＋當時的輸入＋當時的三個選項」；清單依加入的順序排。
   * ⭐ **標題可以重複、也可以是空的**〔owner 2026-10-11〕：一部咒語分好幾段記，每一段都掛同一個標題
   *    ⇒ 標題**不是鍵**。加入時不查重、不覆寫、不合併；分得開同名各段的是順序（輸出的 `part`）。
   * ⭐ **輸出不落地**：清單只存 input 與 options，悉曇／拉丁／碼位在列清單與輸出 JSON 的當下由轉換器算出來
   *    ——存一份的話，轉換核心（bonji 的複製件）改版之後清單裡會留著舊結果，而畫面上看不出來。
   * ⚠️ 這裡的 `input` 是**原樣**（打了什麼就是什麼，載回輸入框時逐字相同）；bonji 的匯出檔把 `input`
   *    存成正規化後的 ASCII 記法、不另存 `output.ascii`——本 app 兩個都給（`input` 原樣、`output.ascii` 正規化）。 */
  function normalizeTitle(t) {
    return typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '';
  }

  // input 全是空白＝沒有東西可記 ⇒ null（呼叫端據此講「沒有可加入的內容」，不加一筆空的）
  // savedAt＝這一筆內容記下的那一刻（ISO 字串，由呼叫端給）；取代一筆時是取代的那一刻，不是它最初加入的時間
  // id／order：沒給或不合格時是 ''／0（由控制器在加入的那一刻補上）。id 只收文件路徑容得下的字元。
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function makeRecord(title, input, options, savedAt, id, order) {
    if (typeof input !== 'string' || !input.trim()) return null;
    return {
      title: normalizeTitle(title),
      input: input,
      options: normalizeOptions(options),
      savedAt: typeof savedAt === 'string' ? savedAt : '',
      id: typeof id === 'string' && ID_RE.test(id) ? id : '',
      order: typeof order === 'number' && isFinite(order) ? order : 0
    };
  }

  // 讀回來的清單：不是陣列當成空的；壞掉的那幾筆丟掉、其餘留著（一筆壞掉不該賠上整份）
  function normalizeStore(s) {
    s = (s && typeof s === 'object') ? s : {};
    var items = [];
    (Array.isArray(s.items) ? s.items : []).forEach(function (r) {
      var rec = r && typeof r === 'object' ? makeRecord(r.title, r.input, r.options, r.savedAt, r.id, r.order) : null;
      if (rec) items.push(rec);
    });
    return { title: normalizeTitle(s.title), items: items };
  }

  /* 儲存區裡的清單（原始字串）與「這個畫面上次讀到／寫下的那一份」比：
   *   same    —— 沒人動過，照記憶裡的做
   *   changed —— 別的畫面（另一個分頁、另一個還開著的畫面）改過 ⇒ **以儲存區為準**，不可以拿記憶裡那份舊的蓋回去
   *   lost    —— 我們寫過、現在讀不到（儲存區不可靠）⇒ 留著記憶裡的，不可以當成「清單被清空了」
   * ⚠️〔2026-10-11 實際發生〕第一版把標題與清單存在同一格、每次整格重寫——一個比較舊的畫面只要改一下標題
   *    （或只是關掉面板），就把別處後來記的紀錄全部蓋掉。 */
  function storeDrift(lastRaw, nowRaw) {
    if (nowRaw === lastRaw) return 'same';
    if (typeof nowRaw !== 'string') return 'lost';
    return 'changed';
  }

  // 新的一筆排在現有每一筆之後：取「現在」與「目前最大的 order ＋ 1」較大的那個（兩台裝置的時鐘不必一致）
  function nextOrder(items, now) {
    var max = 0;
    (Array.isArray(items) ? items : []).forEach(function (it) { if (it && it.order > max) max = it.order; });
    return Math.max(typeof now === 'number' && isFinite(now) ? now : 0, max + 1);
  }

  /* Artifacts 版：清單住在 artifact 的資料庫裡，**一筆一份文件**（不是一整份清單一份文件——那就是 v2.181 的整格重寫）。
   * 畫面上的清單＝遠端送來的那一份 ⊕ 這個畫面已經送出、還沒被確認的寫入：
   *   put —— { id: rec }：加入／取代，遠端還沒有（或還是舊的）也先照新的顯示
   *   del —— { id: true }：刪除，遠端還有也先不顯示
   * 依 order 排，同值時依 id（兩台裝置看到的順序才會一樣）。不改傳進來的東西。 */
  function mergeRemote(remote, put, del) {
    put = put || {}; del = del || {};
    var byId = {}, ids = [];
    (Array.isArray(remote) ? remote : []).forEach(function (it) {
      if (!it || !it.id || del[it.id] || byId[it.id]) return;
      byId[it.id] = it; ids.push(it.id);
    });
    Object.keys(put).forEach(function (id) {
      if (del[id] || !put[id]) return;
      if (!byId[id]) ids.push(id);
      byId[id] = put[id];
    });
    return ids.map(function (id) { return byId[id]; }).sort(function (a, b) {
      return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  function addRecord(items, rec) {
    return rec ? items.concat([rec]) : items.slice();
  }

  // 取代第 i 筆（位置不變——分段的順序就是資料）；i 不在範圍內就原樣回一份
  function replaceRecord(items, i, rec) {
    var out = items.slice();
    if (rec && i >= 0 && i < out.length && Math.floor(i) === i) out[i] = rec;
    return out;
  }

  function removeRecord(items, i) {
    return items.filter(function (_, k) { return k !== i; });
  }

  // 以 id 找那一筆現在在第幾格（找不到回 -1）。編輯表單開著的期間清單可能被別處換過——序號不可靠，id 才是那一筆
  function indexOfId(items, id) {
    var list = Array.isArray(items) ? items : [];
    if (typeof id !== 'string' || !id) return -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return i;
    return -1;
  }

  /* 編輯某一筆〔owner 2026-10-13〕：改的是那一筆**自己的**標題／輸入／選項；身分（id）與位置（order）沿用。
   *   沒有任何更動 ⇒ 回**原來那個物件**（呼叫端據此不寫入——沒改的那一筆，savedAt 不該變成今天）
   *   輸入被清空   ⇒ null（一筆紀錄不可以沒有內容；要拿掉它是「刪除」那顆鈕的事，不是編輯的副作用）
   * 不改傳進來的東西。 */
  function editRecord(orig, title, input, options, savedAt) {
    if (!orig || typeof orig !== 'object') return null;
    var rec = makeRecord(title, input, options, savedAt, orig.id, orig.order);
    if (!rec) return null;
    var same = rec.title === orig.title && rec.input === orig.input &&
      JSON.stringify(rec.options) === JSON.stringify(normalizeOptions(orig.options));
    return same ? orig : rec;
  }

  /* convert(input, options) → { siddham, latin, ascii, codepoints }（控制器包 SiddhamConverter；lib 不 import 它）。
   * seq＝在整份清單裡第幾筆；part＝**同一個標題**裡第幾段（標題重複時靠它分段）。
   * ⚠️ 某一筆轉換丟例外：那一筆 `output: null` 並帶 `error`——不整份失敗，也不安靜地少一筆。 */
  function buildExport(items, convert, exportedAt) {
    var seen = {};
    var records = (Array.isArray(items) ? items : []).map(function (it, i) {
      var key = 't:' + it.title;
      seen[key] = (seen[key] || 0) + 1;
      var rec = {
        seq: i + 1,
        part: seen[key],
        title: it.title,
        options: it.options,
        input: it.input,
        output: null,
        savedAt: it.savedAt
      };
      try {
        var r = convert(it.input, it.options);
        rec.output = { siddham: r.siddham, latin: r.latin, ascii: r.ascii, codepoints: r.codepoints };
      } catch (e) {
        rec.error = String((e && e.message) || e);
      }
      return rec;
    });
    return { app: 'bonji-mobile', exportedAt: exportedAt, count: records.length, records: records };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // 下載檔名：家族慣例的 yyyyMMddHHmmss（本地時間）
  function exportFilename(d) {
    return 'bonji-mobile-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.json';
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
    keysFromElements: keysFromElements,
    keysFor: keysFor,
    ELEMENT_SETS: ELEMENT_SETS,
    CATALOG_CBETA_SETS: CATALOG_CBETA_SETS,
    normalizeKeyset: normalizeKeyset,
    insertAt: insertAt,
    shellBox: shellBox,
    keyboardOpen: keyboardOpen,
    normalizeOptions: normalizeOptions,
    normalizeDraft: normalizeDraft,
    normalizeTitle: normalizeTitle,
    makeRecord: makeRecord,
    normalizeStore: normalizeStore,
    storeDrift: storeDrift,
    nextOrder: nextOrder,
    mergeRemote: mergeRemote,
    addRecord: addRecord,
    replaceRecord: replaceRecord,
    removeRecord: removeRecord,
    indexOfId: indexOfId,
    editRecord: editRecord,
    buildExport: buildExport,
    exportFilename: exportFilename
  };
})(typeof window !== 'undefined' ? window : globalThis);
