#!/usr/bin/env node
/**
 * verify.js — bonji-mobile 的契約檢查。
 *
 *   node scripts/verify.js             跑全部檢查（任何一條 FAIL ⇒ exit 1）
 *   node scripts/verify.js --selftest  反向驗證：在記憶體裡把世界改壞，每一種改壞都必須被抓到
 *
 * 檢查的是「這支 app 為什麼存在」的那幾個性質（輸出在上、輸入貼底、鍵盤不收、不放大），
 * 以及複製件與上游逐位元組相同。
 * ⚠️ 上游 repo 不在旁邊時，複製件那條回 SKIP——**SKIP 不是 PASS**，結尾會分開數。
 */
'use strict';

// siddham-converter.js 是 ESM 而 package.json 沒有 type:module（app.js 是 CommonJS）
// ⇒ Node 會印一次 MODULE_TYPELESS_PACKAGE_JSON 警告。那是預期的，不讓它淹掉報表。
process.removeAllListeners('warning');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const APP = path.join(REPO, 'public', 'apps', 'bonji-mobile');
const FAMILY = path.resolve(REPO, '..', 'nodeapp-webapp-family');
const BONJI = path.resolve(REPO, '..', 'bonji', 'public', 'apps', 'bonji');

const read = (p) => fs.readFileSync(p, 'utf8');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

/* ---------- 世界：所有檢查只讀這個物件，selftest 改的也是它 ---------- */
async function loadWorld() {
  const w = {
    html: read(path.join(APP, 'index.html')),
    css: read(path.join(APP, 'bonji-mobile.css')),
    js: read(path.join(APP, 'bonji-mobile.js')),
    libSrc: read(path.join(APP, 'bonji-mobile-lib.js')),
    catalog: JSON.parse(read(path.join(APP, 'data', 'catalog.json'))),
    elements: JSON.parse(read(path.join(APP, 'data', 'element-catalog.json'))),
    // CBETA 字形 sprite：刻意不進 GitHub ⇒ clone 下來的那一份沒有它，㉖ 回 SKIP（不是 PASS）
    sprite: fs.existsSync(path.join(APP, 'cbeta', 'cbeta-ligatures.svg')) ? read(path.join(APP, 'cbeta', 'cbeta-ligatures.svg')) : null,
    // Artifacts 版才有的兩個檔：紀錄清單的同步（㉟）
    remote: read(path.join(REPO, 'artifact', 'src', 'remote-db.js')),
    build: read(path.join(REPO, 'artifact', 'build.py')),
    locales: {}
  };
  for (const code of ['zh-Hant', 'en', 'ja']) w.locales[code] = loadLocale(path.join(APP, 'locales', code + '.js'));
  w.Lib = loadLib(w.libSrc);
  const conv = await import(path.join(APP, 'siddham-converter.js'));
  w.SiddhamConverter = conv.SiddhamConverter;
  return w;
}

function loadLocale(file) {
  let dict = null;
  vm.runInNewContext(read(file), { I18n: { register: (c, d) => { dict = d; } } });
  return dict;
}

function loadLib(src) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.BonjiMobileLib;
}

const FALLBACK_VECTORS = [
  ['siddha;m', '𑖭𑖰𑖟𑖿𑖠𑖽', 'siddhaṃ'],
  ['hrii.h', '𑖮𑖿𑖨𑖱𑖾', 'hrīḥ'],
  ['stva;m', '𑖭𑖿𑖝𑖿𑖪𑖽', 'stvaṃ'],
  ['va~m', '𑖪𑖼', 'vam̐'],
  ['huu~m', '𑖮𑖳𑖼', 'hūm̐'],
];

/* ---------- 檢查 ---------- */
const CHECKS = [];
const check = (name, fn) => CHECKS.push({ name, fn });
const SKIP = Symbol('skip');

// ① 轉換結果：期望值**直接讀 bonji 的 test/verify-siddham.mjs**（不手抄碼位——第一版手抄就抄錯了一個）。
//    bonji 不在旁邊時退回內建的同一組（逐字抄自該檔的悉曇字串）。
check('① 轉換向量（同 bonji 的 npm test）', (w) => {
  const c = new w.SiddhamConverter();
  const cases = bonjiVectors() || FALLBACK_VECTORS;
  const bad = cases.filter(([i, s, l]) => { const r = c.convert(i); return r.siddham !== s || r.latin !== l; });
  return bad.length ? 'FAIL: ' + bad.map((b) => b[0]).join(', ') : true;
});

function bonjiVectors() {
  const f = path.resolve(REPO, '..', 'bonji', 'test', 'verify-siddham.mjs');
  if (!fs.existsSync(f)) return null;
  const rows = [...read(f).matchAll(/\[\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\s*\]/g)].map((m) => [m[1], m[2], m[3]]);
  return rows.length ? rows : null;
}

// ② 記號列的字形：catalog 的 char（owner 在 xlsx 定的）必須等於引擎轉出來的那個字（兩條路取期望值）。
//    體文是附在子音上的符號 ⇒ 探針用 `k`＋記法、比結尾；母音、異體字與接續直接比。
//    ⭐ 異體字的 `__u` 能轉出 𑗛 靠的是轉換層的副作用（`_u` 被定義成替代母音符號）——哪天 bonji 改轉換層而它壞了，這一條會紅。
//    ⚠️ 已知例外寫成清單、不是放寬比對：體文 `a` 在 xlsx 裡的字形是 U+115C0（nukta），而 `a` 是固有母音、
//       引擎不畫任何符號——**那是來源資料的寫法，本 app 照原樣顯示**。清單以外的對不上一律紅。
const GLYPH_EXCEPTIONS = { bindu: ['a'] };
check('② 記號列字形與引擎一致', (w) => {
  const c = new w.SiddhamConverter();
  const bad = [];
  for (const id of w.Lib.KEYSET_IDS) {
    if (w.Lib.ELEMENT_SETS[id]) continue;   // 上／下接續的字形是 CBETA 造字（CJK 碼位），引擎轉不出來，由 ㉖ 另外驗
    const keys = w.Lib.keysFromCatalog(w.catalog, id);
    if (!keys.length) { bad.push(id + ' 0 個鍵'); continue; }
    for (const k of keys) {
      if (k.cbeta) continue;   // CBETA 字形（catalog 的 uniSiddham 群）不是 Unicode，引擎轉不出來；由 ㉖／㉗ 另外驗
      if ((GLYPH_EXCEPTIONS[id] || []).includes(k.ins)) continue;
      const out = c.convert(id === 'bindu' ? 'k' + k.ins : k.ins).siddham;
      if (!k.glyph || !out.endsWith(k.glyph)) bad.push(id + ':' + k.ins);
    }
  }
  return bad.length ? 'FAIL: ' + bad.join(' ') : true;
});

// ③ 插入的記法在兩種輸入法下結果相同（catalog 的 `S` 在 KH 下會變成 ṣ ⇒ 插入一律小寫）；上／下接續以「記法＋a」當探針
check('③ 記號列在 ISO／KH 下同字', (w) => {
  const iso = new w.SiddhamConverter({ inputMethod: 'ISO15919' });
  const kh = new w.SiddhamConverter({ inputMethod: 'KH' });
  const bad = [];
  for (const id of w.Lib.KEYSET_IDS) {
    for (const k of w.Lib.keysFor(w.catalog, w.elements, id)) {
      const probe = id === 'bindu' ? 'k' + k.ins : w.Lib.ELEMENT_SETS[id] ? k.ins + 'a' : k.ins;
      if (iso.convert(probe).siddham !== kh.convert(probe).siddham) bad.push(id + ':' + k.ins);
    }
  }
  return bad.length ? 'FAIL: ' + bad.join(' ') : true;
});

// ④ insertAt：取代選取範圍、游標落在插入文字之後、索引夾回範圍
check('④ insertAt', (w) => {
  const t = [
    [['abc', 1, 1, 'X'], 'aXbc', 2],
    [['abc', 0, 3, 'Z'], 'Z', 1],
    [['abc', 3, 3, ';m'], 'abc;m', 5],
    [['abc', 2, 1, '-'], 'a-c', 2],
    [['abc', 99, 99, '.h'], 'abc.h', 5],
    [['', undefined, undefined, 'aa'], 'aa', 2]
  ];
  const bad = t.filter(([a, v, c]) => { const r = w.Lib.insertAt(...a); return r.value !== v || r.caret !== c; });
  return bad.length ? 'FAIL: ' + JSON.stringify(bad.map((b) => b[0])) : true;
});

// ⑤ shellBox：有 visualViewport 時貼齊它（含 iOS 的 offsetTop）；沒有時退回 innerHeight；量不到回 null
check('⑤ shellBox', (w) => {
  const L = w.Lib;
  const ok =
    eq(L.shellBox({ vvHeight: 430.4, vvTop: 312.6, innerHeight: 812 }), { top: 313, height: 430 }) &&
    eq(L.shellBox({ vvHeight: NaN, vvTop: NaN, innerHeight: 700 }), { top: 0, height: 700 }) &&
    eq(L.shellBox({ vvHeight: 0, vvTop: 50, innerHeight: 640 }), { top: 0, height: 640 }) &&
    L.shellBox({}) === null;
  return ok || 'FAIL';
});

// ⑥ keyboardOpen：網址列收合（約 50–80px）不算鍵盤；少 120px 以上才算
check('⑥ keyboardOpen 門檻', (w) => {
  const k = w.Lib.keyboardOpen;
  const ok = !k(812, 732) && !k(812, 693) && k(812, 692) && k(812, 430) && !k(0, 430) && !k(812, NaN);
  return ok || 'FAIL';
});

// ⑦ 從 localStorage 讀回來的選項／草稿不可信：白名單以外一律退回預設
check('⑦ normalizeOptions／normalizeDraft', (w) => {
  const L = w.Lib;
  const d = L.DEFAULT_OPTIONS;
  const ok =
    eq(L.normalizeOptions({ inputMethod: 'KH', transliteration: 'ISO15919', ignoreSpacesAndHyphens: false }),
      { inputMethod: 'KH', transliteration: 'ISO15919', ignoreSpacesAndHyphens: false }) &&
    eq(L.normalizeOptions({ inputMethod: 'x', transliteration: 3, ignoreSpacesAndHyphens: 'yes' }), d) &&
    eq(L.normalizeOptions(null), d) &&
    eq(L.normalizeDraft({ input: 5, options: 'bad' }), { input: '', options: d }) &&
    eq(L.normalizeDraft({ input: 'o;m' }), { input: 'o;m', options: d });
  return ok || 'FAIL';
});

// ⑧ 版型：輸出在上、記號列、輸入貼底（DOM 順序）——這支 app 存在的理由
check('⑧ DOM 順序：輸出 → 記號列 → 輸入', (w) => {
  const a = w.html.indexOf('id="out-pane"'), b = w.html.indexOf('id="keybar"'), c = w.html.indexOf('id="bm-input"');
  return (a > 0 && a < b && b < c) || 'FAIL: out-pane / keybar / bm-input 的順序不對';
});

// ⑨ 整頁不捲、外殼跟著可見範圍：body overflow hidden、.shell 讀 --shell-top／--shell-h、控制器寫它們
check('⑨ 外殼貼齊可見範圍', (w) => {
  const miss = [];
  if (!/html,\s*body\s*\{[^}]*overflow:\s*hidden/.test(w.css)) miss.push('html,body overflow:hidden');
  if (!/\.shell\s*\{[^}]*top:\s*var\(--shell-top/.test(w.css)) miss.push('.shell top');
  if (!/\.shell\s*\{[^}]*height:\s*var\(--shell-h/.test(w.css)) miss.push('.shell height');
  if (!/setProperty\('--shell-top'/.test(w.js) || !/setProperty\('--shell-h'/.test(w.js)) miss.push('controller setProperty');
  if (!/visualViewport\.addEventListener\('resize'/.test(w.js)) miss.push('visualViewport resize');
  if (!/interactive-widget=resizes-content/.test(w.html)) miss.push('viewport interactive-widget');
  return miss.length ? 'FAIL: ' + miss.join(', ') : true;
});

// ⑩ 不放大：會聚焦的控制項字級 ≥ 16px（iOS 小於 16 會放大整頁；本 app 取 20 給 Artifacts 版）
check('⑩ 控制項字級 ≥ 16px', (w) => {
  const m = w.css.match(/--ctl-font:\s*(\d+)px/);
  if (!m) return 'FAIL: 找不到 --ctl-font';
  if (+m[1] < 16) return 'FAIL: --ctl-font ' + m[1] + 'px';
  const inputUses = /\.bm-input\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css);
  const selectUses = /select\.browser-default\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css);
  return (inputUses && selectUses) || 'FAIL: 輸入框或 select 沒用 --ctl-font';
});

// ⑪ 按記號鍵／清除鈕不可以讓輸入框失焦（mousedown 的預設動作就是搬焦點）
check('⑪ 記號列／清除鈕／切換鈕擋掉 mousedown', (w) => {
  const kb = /\$keybar\.addEventListener\('mousedown',[\s\S]{0,120}preventDefault\(\)/.test(w.js);
  const cl = /clearBtn\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js);
  const ks = /keysetBtn\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js);
  return (kb && cl && ks) || 'FAIL: ' + (!kb ? '記號列 ' : '') + (!cl ? '清除鈕 ' : '') + (!ks ? '切換鈕' : '');
});

// ⑫ 觸控裝置用原生 select、不用 .materialize-textarea（兩者在手機上各有一個安靜的壞法）
check('⑫ 原生 select／不用 materialize-textarea', (w) => {
  const selects = w.html.match(/<select[^>]*>/g) || [];
  const allNative = selects.length > 0 && selects.every((s) => /browser-default/.test(s));
  const noFormSelect = !/FormSelect/.test(w.js);
  const noMzTextarea = !/materialize-textarea/.test(w.html);
  return (allNative && noFormSelect && noMzTextarea) || 'FAIL';
});

// ⑬ 手機輸入框不要自動大寫／自動校正（會把記法改壞；KH 的大小寫有意義）
check('⑬ 輸入框關掉自動大寫／校正', (w) => {
  const tag = (w.html.match(/<textarea[^>]*id="bm-input"[^>]*>/) || [''])[0];
  const need = ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"'];
  const miss = need.filter((a) => tag.indexOf(a) < 0);
  return miss.length ? 'FAIL: ' + miss.join(' ') : true;
});

// ⑭ i18n：三語 key 集合相同；HTML 與控制器用到的 key 都有定義
check('⑭ i18n key 齊全', (w) => {
  const sets = Object.values(w.locales).map((d) => Object.keys(d).sort().join('|'));
  if (new Set(sets).size !== 1) return 'FAIL: 三語 key 集合不同';
  const dict = w.locales['zh-Hant'];
  const used = new Set();
  for (const m of w.html.matchAll(/data-i18n(?:-html|-title|-placeholder|-doctitle)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of w.js.matchAll(/I18n\.t\('([^']+)'\s*[,)]/g)) used.add(m[1]);   // 只收完整字面值；'keyset.' + x 這種前綴另列於下
  // 紀錄清單那一段的 key 是經 recToast／arm／recButton 的參數傳進 I18n.t 的 ⇒ 上面那條只認 I18n.t('…') 的規則看不到它們
  for (const m of w.js.matchAll(/'((?:rec|toast)\.[A-Za-z.]+)'/g)) used.add(m[1]);
  used.add('tool.more');   // side-tool.js 動態產生 #setting-more 時掛的（DESIGN_GUIDELINES §6）
  for (const id of w.Lib.KEYSET_IDS) used.add('keyset.' + id);   // I18n.t('keyset.' + state.keyset)
  const miss = [...used].filter((k) => !(k in dict));
  return miss.length ? 'FAIL: 未定義 ' + miss.join(', ') : true;
});

// ⑮ 共用文案逐字照 DESIGN_GUIDELINES §6 的正典表
check('⑮ 共用文案照 §6 正典', (w) => {
  const canon = {
    'tool.lang': ['語言', 'Language', '言語'],
    'tool.mode': ['切換 light / dark', 'Toggle light / dark', 'ライト / ダーク切替'],
    'tool.more': ['更多工具', 'More tools', 'その他のツール'],
    'toast.lang': ['已切換為 {name}', 'Switched to {name}', '{name} に切り替えました'],
    'toast.copied': ['已複製', 'Copied', 'コピーしました']
  };
  const codes = ['zh-Hant', 'en', 'ja'];
  const bad = [];
  for (const [k, v] of Object.entries(canon)) codes.forEach((c, i) => { if (w.locales[c][k] !== v[i]) bad.push(c + ':' + k); });
  return bad.length ? 'FAIL: ' + bad.join(' ') : true;
});

// ⑯ 字型：repo 裡只有 Noto Sans Siddham（OFL）；沒有任何 local() 讀 Mojikyo／Siddam
check('⑯ 字型只有 Noto Sans Siddham', (w) => {
  const exts = new Set(['.ttf', '.otf', '.ttc', '.dfont', '.woff', '.woff2', '.eot']);
  const fonts = walk(REPO).filter((p) => exts.has(path.extname(p).toLowerCase()))
    .map((p) => path.relative(REPO, p)).filter((p) => !p.startsWith('node_modules') && !p.startsWith('artifact/dist'));
  const ok = fonts.length === 1 && fonts[0] === 'public/apps/bonji-mobile/fonts/NotoSansSiddham-Regular.woff2';
  const noLocal = !/local\(/.test(w.css);
  return (ok && noLocal) || 'FAIL: ' + fonts.join(', ') + (noLocal ? '' : '（CSS 有 local()）');
});

// ⑰ 原始碼沒有 NUL 位元組（會讓 grep 靜默跳過、git 當 binary）
check('⑰ 原始碼無 NUL', () => {
  const bad = walk(path.join(REPO, 'public')).concat(walk(path.join(REPO, 'scripts')), walk(path.join(REPO, 'artifact')))
    .filter((p) => /\.(js|html|css|py)$/.test(p) && !p.includes('artifact/dist'))
    .filter((p) => fs.readFileSync(p).includes(0));
  return bad.length ? 'FAIL: ' + bad.map((p) => path.relative(REPO, p)).join(', ') : true;
});

// ⑱ 複製件與權威版逐位元組相同（上游不在旁邊 ⇒ SKIP）
check('⑱ 複製件 md5', () => {
  const pairs = [
    ...['side-tool.css', 'side-tool.js', 'i18n.js', 'materialize-dark.css'].map((f) => [path.join(FAMILY, f), f]),
    ...['siddham-converter.js', 'vendor/bonji-input/siddham.js', 'vendor/bonji-input/LICENSE',
      'vendor/bonji-input/SOURCE.md', 'fonts/NotoSansSiddham-Regular.woff2', 'fonts/OFL.txt',
      'data/catalog.json', 'data/element-catalog.json']
      .map((f) => [path.join(BONJI, f), f])
  ];
  if (!fs.existsSync(FAMILY) || !fs.existsSync(BONJI)) return SKIP;
  const bad = pairs.filter(([src, f]) => md5(src) !== md5(path.join(APP, f))).map((p) => p[1]);
  return bad.length ? 'FAIL: ' + bad.join(', ') : true;
});

// ⑲ 防腐層紀律：控制器與 lib 都不直接 import vendored 引擎
check('⑲ 不直接 import 引擎', (w) => {
  const bad = /vendor\/bonji-input/.test(w.js.replace(/^\s*(\*|\/\/).*$/gm, '')) || /vendor\/bonji-input/.test(w.libSrc.replace(/^\s*(\*|\/\/).*$/gm, ''));
  return !bad || 'FAIL';
});

// ⑳ 上緣安全區由外殼墊、不由頁首墊〔owner 2026-10-08，Claude App 裡標題被遮約 75%〕：
//    頁首是 height:48px ＋ border-box，墊在它身上會被吃進那 48px（標題只往下移一半）。
check('⑳ 安全區墊在外殼上', (w) => {
  const shell = /\.shell\s*\{[^}]*padding-top:\s*env\(safe-area-inset-top/.test(w.css);
  // ⚠️ 錨在行首：檔案裡第一個 `.topbar {` 是 `body.kb-open .topbar { display:none }`，不錨的話這條會去看那一條而永遠綠（selftest 抓到的）
  const topbar = (w.css.match(/^\.topbar\s*\{[^}]*\}/m) || [''])[0];
  if (!topbar) return 'FAIL: 找不到 .topbar 規則';
  const toast = /#toast-container\s*\{[^}]*top:[^;]*safe-area-inset-top/.test(w.css);
  return (shell && !/safe-area-inset-top/.test(topbar) && toast) || 'FAIL: ' + (!shell ? '外殼沒墊 ' : '') + (/safe-area-inset-top/.test(topbar) ? '頁首又墊了 ' : '') + (!toast ? 'toast 沒讓開' : '');
});

// ㉑ 體文／接續切換鈕在清除鈕的右邊（owner 指定的位置），且兩者都在輸入列裡
check('㉑ 切換鈕在清除鈕右邊', (w) => {
  const bar = (w.html.match(/<div class="in-bar">[\s\S]*?<\/div>/) || [''])[0];
  const a = bar.indexOf('id="bm-input"'), b = bar.indexOf('id="clear-input"'), c = bar.indexOf('id="keyset-toggle"');
  return (a >= 0 && a < b && b < c) || 'FAIL: in-bar 內的順序不是 輸入 → 清除 → 切換';
});

// ㉒ Claude App 裡鍵盤彈出時頁面被往上推、iframe 不縮〔owner 2026-10-08 截圖〕：
//    (a) 悉曇與拉丁轉寫左右並排、2:1 寫進 flex-basis；(b) 文字靠底（margin-top:auto，不是 justify-content:flex-end）；
//    (c) 輸入框有焦點時外殼不墊底部安全區（高度判斷在那裡看不到鍵盤）。
check('㉒ 並排 2:1／文字靠底／聚焦不墊底', (w) => {
  const miss = [];
  if (!/\.out-pane\s*\{[^}]*flex-direction:\s*row/.test(w.css)) miss.push('out-pane 不是 row');
  if (!/\.out-block-siddham\s*\{[^}]*flex:\s*0 0 calc\(\(100% - 8px\) \* 2 \/ 3\)/.test(w.css)) miss.push('悉曇不是 2/3 basis');
  if (!/^\.out-text\s*\{[^}]*margin-top:\s*auto/m.test(w.css)) miss.push('文字沒靠底');
  if (/justify-content:\s*flex-end/.test((w.css.match(/^\.out-value\s*\{[^}]*\}/m) || [''])[0])) miss.push('用了 flex-end（溢出的上半截會捲不上去）');
  if (!/\.shell:has\(#bm-input:focus\)\s*\{[^}]*padding-bottom:\s*0/.test(w.css)) miss.push('聚焦時仍墊底部安全區');
  const so = w.html.match(/class="out-value"><div id="out-siddham" class="out-text/);
  const lo = w.html.match(/class="out-value"><div id="out-latin" class="out-text/);
  if (!so || !lo) miss.push('輸出文字不在 .out-value 裡的 .out-text');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉓ 複製鈕在欄位底部〔owner 2026-10-08〕：Claude App 裡鍵盤開著時欄位頂端被 App 標題列蓋住（㉒ 同一個成因），
//    放頂端就按不到。每一欄都要「捲動框在前、含複製鈕的 .out-foot 在後」。
check('㉓ 複製鈕在欄位底部', (w) => {
  const bad = [];
  for (const k of ['siddham', 'latin']) {
    const blk = (w.html.match(new RegExp('<div class="out-block out-block-' + k + '">[\\s\\S]*?\\n      </div>')) || [''])[0];
    const v = blk.indexOf('id="out-' + k + '"'), f = blk.indexOf('class="out-foot"'), c = blk.indexOf('data-copy="' + k + '"');
    if (!(v >= 0 && v < f && f < c)) bad.push(k);
  }
  return bad.length ? 'FAIL: ' + bad.join('、') + ' 的複製鈕不在捲動框之後的 .out-foot 裡' : true;
});

// ㉔ 記號列六組的順序：母音 → 異體字 → 體文 → 上接續 → 下接續 → 接續〔owner 2026-10-08／09：母音在體文前、異體字在母音後、上下接續在體文後〕。
//    切換鈕依 KEYSET_IDS 的順序循環、預設是第一組 ⇒ 順序本身就是規格。
check('㉔ 記號列六組依序：母音 → 異體字 → 體文 → 上接續 → 下接續 → 接續', (w) => {
  const ids = w.Lib.KEYSET_IDS.join(',');
  if (ids !== 'vowel,variant,bindu,ligature_u,ligature_l,ligature') return 'FAIL: KEYSET_IDS = ' + ids;
  const nu = w.Lib.keysFor(w.catalog, w.elements, 'ligature_u').length, nl = w.Lib.keysFor(w.catalog, w.elements, 'ligature_l').length;
  if (nu !== 39 || nl !== 44) return 'FAIL: 上接續 ' + nu + '／下接續 ' + nl + ' 鍵（element-catalog 的 Cbeta 群應為 39／44——不去重）';
  const v = w.Lib.keysFromCatalog(w.catalog, 'variant').map((k) => k.ins).join(' ');
  if (v !== '__i _i _ii __u') return 'FAIL: 異體字組 = ' + v + '（owner 指定 __i _i _ii __u）';
  if (w.Lib.normalizeKeyset('nope') !== 'vowel') return 'FAIL: 認不得的值沒有退回母音';
  return true;
});

// ㉕ CBETA 字形 SVG 不進 GitHub〔owner 2026-10-09〕：cbeta/ 被 .gitignore 擋著、而且沒有任何檔案被追蹤。
//    SVG 路徑就是字型外框的複製，而這支字型沒有再散布的授權；本 repo 是 public。
check('㉕ cbeta/ 不在版控裡', () => {
  const { execFileSync } = require('child_process');
  const git = (args) => { try { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; } };
  if (git(['rev-parse', '--show-toplevel']) === null) return SKIP;   // 不是 git 工作目錄（例如 Artifacts 的建置產物）
  const tracked = git(['ls-files', 'public/apps/bonji-mobile/cbeta']);
  if (tracked === null) return 'FAIL: git ls-files 跑不起來';
  if (tracked.trim()) return 'FAIL: 這些檔案被追蹤了：' + tracked.trim().split('\n').join(', ');
  const ign = git(['check-ignore', '-q', 'public/apps/bonji-mobile/cbeta/cbeta-ligatures.svg']);
  return ign !== null || 'FAIL: .gitignore 沒有擋 cbeta/';
});

// ㉖ 有 sprite 時：上／下接續的每一個字形都在 sprite 裡、viewBox 是整個 em 方框、外框不是空的。
//    沒有 sprite（clone 下來的那一份）⇒ SKIP：那是設計好的狀態（鍵只印記法），不是通過。
check('㉖ CBETA sprite 涵蓋上／下接續', (w) => {
  if (!w.sprite) return SKIP;
  const bad = [];
  for (const id of ['ligature_u', 'ligature_l', 'ligature']) {
    for (const k of w.Lib.keysFor(w.catalog, w.elements, id)) {
      if (!k.cbeta) continue;
      const sid = 'cb-' + k.cbeta.codePointAt(0).toString(16);
      const m = w.sprite.match(new RegExp('<symbol id="' + sid + '" viewBox="0 0 (\\d+) (\\d+)"><path d="([^"]+)"'));
      if (!m) bad.push(id + ':' + k.ins + '(' + sid + ')');
      else if (m[3].length < 20) bad.push(sid + ' 外框太短');
    }
  }
  return bad.length ? 'FAIL: ' + bad.slice(0, 8).join(' ') : true;
});

// ㉗ 接續的 6 格 CBETA 字形，各自緊接在 owner 指定的那一鍵之後〔owner 2026-10-09 的表；盷 依 owner 裁定為 th〕。
//    期望值寫死在這裡（取自 owner 的清單，不是取自 catalog.json）——xlsx 哪天被改動、位置或記法漂了，這一條會紅。
const CBETA_LIGATURE_SPEC = [
  ['盄', '.t', '𑖘𑖿'], ['眈', '.th', '𑖙𑖿'], ['眄', '.dh', '𑖛𑖿'],
  ['盷', 'th', '𑖞𑖿'], ['矧', 'n', '𑖡𑖿'], ['祋', 'lla;m', '𑖮𑖿']
];
check('㉗ 接續的 CBETA 字形接在指定的鍵之後', (w) => {
  const keys = w.Lib.keysFor(w.catalog, w.elements, 'ligature');
  const bad = [];
  for (const [ch, ins, after] of CBETA_LIGATURE_SPEC) {
    const i = keys.findIndex((k) => k.cbeta === ch);
    if (i < 0) { bad.push(ch + ' 不在接續裡'); continue; }
    if (keys[i].ins !== ins) bad.push(ch + ' 插入 ' + keys[i].ins + '（應為 ' + ins + '）');
    const prev = keys[i - 1];
    if (!prev || prev.glyph !== after) bad.push(ch + ' 前一鍵是 ' + (prev ? (prev.glyph || prev.cbeta) : '（無）') + '（應為 ' + after + '）');
  }
  const extra = keys.filter((k) => k.cbeta && !CBETA_LIGATURE_SPEC.some((x) => x[0] === k.cbeta));
  if (extra.length) bad.push('多出 ' + extra.map((k) => k.cbeta).join(''));
  if (keys.length !== 40) bad.push('接續 ' + keys.length + ' 鍵（應為 34 ＋ 6）');
  return bad.length ? 'FAIL: ' + bad.join('；') : true;
});

// ㉘ Noto 字形與 CBETA 完整字母在鍵上同大〔owner 2026-10-09 截圖：CBETA 太大、Noto 太小〕：
//    兩者的墨水高都約是各自尺寸的 0.95，所以 `.key-glyph` 的字號與 `.key-cbeta-whole .key-svg` 的高度要是**同一個 px 數**，
//    而且都用 px（Materialize 依螢幕寬度改根字級，rem 會讓兩邊在不同寬度下錯開）。實測接續組墨水高 18.1／18.5px。
check('㉘ Noto 與 CBETA 完整字母同大', (w) => {
  const g = (w.css.match(/^\.key-glyph\s*\{[^}]*?font-size:\s*([\d.]+)(px|rem|em)/m) || []);
  const c = (w.css.match(/\.key-cbeta-whole \.key-svg\s*\{\s*height:\s*([\d.]+)(px|rem|em)/) || []);
  if (!g[1] || !c[1]) return 'FAIL: 找不到 .key-glyph 的字號或 .key-cbeta-whole .key-svg 的高度';
  if (g[2] !== 'px' || c[2] !== 'px') return 'FAIL: 要用 px（' + g[2] + '／' + c[2] + '）';
  return g[1] === c[1] || 'FAIL: 字號 ' + g[1] + 'px ≠ SVG 高 ' + c[1] + 'px';
});

// ㉙ 紀錄清單：**標題可以重複、可以留空**〔owner 2026-10-11：一部咒語分好幾段記，每一段掛同一個標題〕。
//    標題不是鍵 ⇒ 加入不查重、不覆寫；同名各段靠順序分開（輸出的 part＝同一個標題裡第幾段，seq＝整份清單第幾筆）。
check('㉙ 紀錄：標題可以重複、可以留空，part 依標題分段', (w) => {
  const L = w.Lib, o = L.DEFAULT_OPTIONS;
  const mk = (t, i) => L.makeRecord(t, i, o, 'S');
  const bad = [];
  const recs = [mk('大悲咒', 'na mo'), mk('  大悲咒 ', 'ra tna'), mk('', 'huu~m'), mk('心經咒', 'ga te'), mk('大悲咒', 'tra yaa ya'), mk('__proto__', 'a'), mk('__proto__', 'aa')];
  if (recs.some((r) => !r)) return 'FAIL: 有標題／空標題的紀錄建不出來';
  let items = [];
  for (const r of recs) {
    const before = items;
    items = L.addRecord(items, r);
    if (items === before || before.length !== items.length - 1) bad.push('addRecord 改了傳進來的陣列，或沒有多一筆');
  }
  if (items.length !== 7) bad.push('同名的被併掉了：' + items.length + ' 筆（應為 7）');
  if (recs[1].title !== '大悲咒') bad.push('標題前後的空白沒去掉');
  if (mk('x', '   ') !== null || mk('x', 5) !== null) bad.push('空的輸入也記成一筆');
  const exp = L.buildExport(items, () => ({ siddham: 's', latin: 'l', ascii: 'a', codepoints: 'c' }), 'T');
  const got = exp.records.map((r) => r.seq + ':' + r.title + ':' + r.part).join(' ');
  const want = '1:大悲咒:1 2:大悲咒:2 3::1 4:心經咒:1 5:大悲咒:3 6:__proto__:1 7:__proto__:2';
  if (got !== want) bad.push('seq／part = ' + got);
  if (exp.count !== 7 || exp.app !== 'bonji-mobile' || exp.exportedAt !== 'T') bad.push('信封欄位不對');
  // 取代：位置不變（分段的順序就是資料）、其他筆不動；刪除：只少那一筆。兩者都不改傳進來的陣列。
  const rep = L.replaceRecord(items, 1, mk('大悲咒', 'NEW'));
  if (rep.length !== 7 || rep[1].input !== 'NEW' || rep[0] !== items[0] || rep[2] !== items[2] || items[1].input !== 'ra tna') bad.push('replaceRecord 沒有就地取代');
  if (!eq(L.replaceRecord(items, 9, mk('x', 'y')), items)) bad.push('replaceRecord 超出範圍時動了清單');
  const rem = L.removeRecord(items, 1);
  if (rem.length !== 6 || rem[1] !== items[2] || items.length !== 7) bad.push('removeRecord');
  return bad.length ? 'FAIL: ' + bad.join('；') : true;
});

// ㉚ JSON 輸出：悉曇／拉丁／碼位不落地，輸出當下**每一筆用它自己的選項**現算。
//    期望值寫死在這裡（同一段 `siddha;m`：IAST 是 ṃ、ISO 15919 是 ṁ）——不取自 buildExport 自己的計算。
//    轉不出來的那一筆 `output: null` ＋ `error`：不整份失敗，也不安靜地少一筆。
check('㉚ JSON 輸出：每筆用自己的選項現算；轉不出來的那一筆不消失', (w) => {
  const L = w.Lib;
  const conv = (input, options) => new w.SiddhamConverter(options).convert(input);
  const iast = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  const iso = { inputMethod: 'ISO15919', transliteration: 'ISO15919', ignoreSpacesAndHyphens: true };
  const items = [L.makeRecord('t', 'siddha;m', iast, 'A'), L.makeRecord('t', 'siddha;m', iso, 'B')];
  const bad = [];
  const [r1, r2] = L.buildExport(items, conv, 'T').records;
  const lat = (r) => (r && r.output ? r.output.latin : '（無）');
  if (lat(r1) !== 'siddhaṃ') bad.push('第 1 筆（IAST）latin = ' + lat(r1));
  if (lat(r2) !== 'siddhaṁ') bad.push('第 2 筆（ISO 15919）latin = ' + lat(r2));
  if (r1 && r1.output && (r1.output.siddham !== '𑖭𑖰𑖟𑖿𑖠𑖽' || r1.output.ascii !== 'siddha;m' || !/^U\+115AD U\+115B0 /.test(r1.output.codepoints))) bad.push('siddham／ascii／codepoints');
  if (!r1 || r1.input !== 'siddha;m' || r1.savedAt !== 'A') bad.push('input／savedAt 沒有原樣帶出');
  const keys = r1 ? Object.keys(r1).join(',') : '';
  if (keys !== 'seq,part,title,options,input,output,savedAt') bad.push('一筆的欄位變了：' + keys);
  const exp2 = L.buildExport(items, (i, o) => { if (o.transliteration === 'ISO15919') throw new Error('boom'); return conv(i, o); }, 'T');
  if (exp2.count !== 2 || exp2.records.length !== 2 || !exp2.records[0].output || exp2.records[1].output !== null || exp2.records[1].error !== 'boom') bad.push('轉不出來的那一筆沒有留下 output:null ＋ error');
  // 控制器餵給 buildExport 的那支：每一筆各自一個轉換器（不是畫面上那一個——它帶的是「現在」的選項）
  if (!/function convertWith\(input, options\) \{\s*return new SiddhamConverter\(options\)\.convert\(input\);/.test(w.js)) bad.push('控制器的 convertWith 沒有用那一筆自己的選項');
  return bad.length ? 'FAIL: ' + bad.join('；') : true;
});

// ㉛ 從 localStorage 讀回來的紀錄清單不可信：不是陣列當成空的、壞掉的那幾筆丟掉、選項走白名單、多出來的鍵不留
check('㉛ normalizeStore', (w) => {
  const L = w.Lib, d = L.DEFAULT_OPTIONS;
  const kh = { inputMethod: 'KH', transliteration: 'ISO15919', ignoreSpacesAndHyphens: false };
  const s = L.normalizeStore({ title: '  a  b ', items: [
    { title: 5, input: 'o;m', options: { inputMethod: 'x' }, savedAt: 7 }, { title: 't', input: '  ' }, 'junk', null,
    { title: 't', input: 'hrii.h', options: kh, savedAt: 'S', extra: 1 }] });
  const ok = s.title === 'a b' && s.items.length === 2 &&
    eq(s.items[0], { title: '', input: 'o;m', options: d, savedAt: '', id: '', order: 0 }) &&
    eq(s.items[1], { title: 't', input: 'hrii.h', options: kh, savedAt: 'S', id: '', order: 0 }) &&
    // id／order：合格的留著（它們是那一筆的身分與位置），不合格的清掉（id 會被拿去當文件路徑）
    eq(L.normalizeStore({ items: [{ input: 'a', id: 'r1_x-9', order: 7 }, { input: 'b', id: 'a/b', order: 'x' }] }).items.map((i) => i.id + ':' + i.order), ['r1_x-9:7', ':0']) &&
    eq(L.normalizeStore(null), { title: '', items: [] }) && eq(L.normalizeStore({ items: 'x' }), { title: '', items: [] });
  return ok || 'FAIL';
});

// ㉜ 紀錄功能在手機上的四個坑：
//    (a) 悉曇欄底下的加入鈕擋 mousedown——打一段、加一筆、接著打，鍵盤不該收（同 ⑪）；它要在悉曇欄的 .out-foot 裡（鍵盤開著時頁首按不到）
//    (b) 標題欄字級走 --ctl-font（同 ⑩）；(c) 不用 confirm／alert／prompt——Artifacts 的 iframe 裡直接回 false，「先問再做」會變成永遠不做
//    (d) 面板內 標題 → 清單 → JSON：iOS 鍵盤彈出時 bottom-sheet 的下半截被蓋住，上緣不會；底列固定（modal-fixed-footer）
//    (e) 標題欄有焦點時鍵盤也開著，那時的高度不可以當成「沒有鍵盤」的基準
check('㉜ 紀錄面板在手機上：加入不收鍵盤／不放大／不用 confirm／標題欄在最上面', (w) => {
  const miss = [];
  if (!/quick\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js)) miss.push('加入鈕沒擋 mousedown');
  const sblk = (w.html.match(/<div class="out-block out-block-siddham">[\s\S]*?\n      <\/div>/) || [''])[0];
  const f = sblk.indexOf('class="out-foot"'), q = sblk.indexOf('id="rec-add-quick"');
  if (!(f >= 0 && f < q)) miss.push('加入鈕不在悉曇欄的 .out-foot 裡');
  if (!/input\[type="text"\]\.rec-title\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css)) miss.push('標題欄沒用 --ctl-font');
  // 標題欄旁的清除鈕〔owner 2026-10-11〕：同樣擋 mousedown（焦點維持原狀）；它不可以包在 <label> 裡——label 的預設動作會把焦點送進標題欄、鍵盤跳出來
  if (!/titleClear\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js)) miss.push('標題的清除鈕沒擋 mousedown');
  const ci = w.html.indexOf('id="rec-title-clear"');
  if (ci < 0) miss.push('標題欄旁沒有清除鈕');
  else if (w.html.lastIndexOf('<label', ci) > w.html.lastIndexOf('</label>', ci)) miss.push('清除鈕包在 <label> 裡');
  const code = w.js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (/(^|[^.\w$])(confirm|alert|prompt)\s*\(|window\.(confirm|alert|prompt)\s*\(/m.test(code)) miss.push('用了 confirm／alert／prompt');
  const sheet = (w.html.match(/<div id="records-modal"[\s\S]*?\n  <\/div>\n/) || [''])[0];
  const t = sheet.indexOf('id="rec-title"'), l = sheet.indexOf('id="rec-list"'), j = sheet.indexOf('id="rec-json"');
  if (!(t > 0 && t < l && l < j)) miss.push('面板內的順序不是 標題 → 清單 → JSON');
  if (!/modal-fixed-footer/.test((sheet.match(/<div id="records-modal"[^>]*>/) || [''])[0])) miss.push('不是 modal-fixed-footer');
  if (!/if \(!focused && document\.activeElement !== \$recTitle\) state\.baseline = box\.height;/.test(w.js)) miss.push('標題欄有焦點時仍更新鍵盤基準');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉝ 清單存在 localStorage——那是方便不是備份，而且可能存不住（iOS 上的 Artifacts 版寫得進讀不回）：
//    每次存完讀回來比對，對不上就在面板上講出來。下載檔名照家族慣例 yyyyMMddHHmmss、圖示照 §5.6（file_download）。
check('㉝ 清單存不住要講出來；下載檔名與圖示', (w) => {
  const miss = [];
  if (!/localStorage\.setItem\(REC_KEY, text\); ok = localStorage\.getItem\(REC_KEY\) === text;/.test(w.js)) miss.push('存完沒有讀回來比對');
  if (!/getElementById\('rec-storage-note'\)\.hidden = ok && !state\.storageLost;/.test(w.js)) miss.push('存不住時面板上不講');
  if (!/id="rec-storage-note"[^>]*data-i18n="rec\.storageFail"/.test(w.html)) miss.push('面板上沒有那一行');
  const name = w.Lib.exportFilename(new Date(2026, 9, 11, 9, 5, 7));
  if (name !== 'bonji-mobile-20261011090507.json') miss.push('檔名 ' + name);
  if (!/id="rec-download"[^>]*>\s*<i class="material-icons left">file_download<\/i>/.test(w.html)) miss.push('下載鈕的圖不是 file_download');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉞ **改標題不可以碰清單；動清單之前先看儲存區**〔2026-10-11，owner 回報「清除標題把原來的紀錄也清掉了」〕。
//    第一版把標題與清單存在同一格、每次整格重寫：一個記憶裡的清單比儲存區舊的畫面（另一個分頁、另一個還開著的畫面後來記了幾筆），
//    只要改標題、按清除、甚至關掉面板，就把那幾筆蓋掉。⇒ (a) 兩格分開存；(b) 改標題的三條路上沒有任何一行寫清單；
//    (c) 寫清單的每一條路都先 syncItems()；(d) 「讀不到」不可以當成「被清空了」（storeDrift 的 lost）。
const fnBody = (src, name) => (src.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}')) || [''])[0];
check('㉞ 改標題不碰清單；動清單前先看儲存區', (w) => {
  const miss = [];
  const d = w.Lib.storeDrift;
  if (!(d(null, null) === 'same' && d('a', 'a') === 'same' && d('a', 'b') === 'changed' && d(null, 'b') === 'changed' && d('a', null) === 'lost' && d('a', undefined) === 'lost')) miss.push('storeDrift 的判定不對');
  const k1 = (w.js.match(/var REC_KEY = '([^']+)'/) || [])[1], k2 = (w.js.match(/var REC_TITLE_KEY = '([^']+)'/) || [])[1];
  if (!k1 || !k2 || k1 === k2) miss.push('標題與清單不是分兩格存（' + k1 + '／' + k2 + '）');
  // 改標題的路：clearTitle、saveTitle、標題欄的 input、面板關閉——都不可以出現 saveItems 或 REC_KEY
  const titlePaths = {
    clearTitle: fnBody(w.js, 'clearTitle'),
    saveTitle: fnBody(w.js, 'saveTitle'),
    '標題欄 input': (w.js.match(/\$recTitle\.addEventListener\('input', function \(\) \{[\s\S]*?\n    \}\);/) || [''])[0],
    '面板關閉': (w.js.match(/M\.Modal\.init\(\$recModal, \{[\s\S]*?\n    \}\);/) || [''])[0]
  };
  for (const [name, body] of Object.entries(titlePaths)) {
    if (!body) miss.push('找不到 ' + name);
    else if (/saveItems\(|REC_KEY\b/.test(body)) miss.push(name + ' 寫到清單了');
  }
  if (!/JSON\.stringify\(\{ items: state\.rec\.items \}\)/.test(fnBody(w.js, 'saveItems'))) miss.push('saveItems 寫的不是只有 items');
  // 寫清單的路：加入（先同步再接上去）、recAction（別處改過就停下來）
  const add = fnBody(w.js, 'addCurrent');
  if (!(add.indexOf('syncItems()') > 0 && add.indexOf('syncItems()') < add.indexOf('Lib.addRecord('))) miss.push('加入之前沒有先看儲存區');
  const act = fnBody(w.js, 'recAction');
  if (!/^\s*function recAction\(act, i\) \{\s*(\/\/[^\n]*\n\s*)*if \(syncItems\(\) === 'changed'\) \{[\s\S]*?return;\s*\}/.test(act.replace(/^\n/, ''))) miss.push('取代／刪除／清除之前沒有先看儲存區');
  const callers = [...w.js.matchAll(/\n  function (\w+)\([^)]*\) \{[\s\S]*?\n  \}/g)].filter((m) => /saveItems\(\)/.test(m[0]) && m[1] !== 'saveItems').map((m) => m[1]).sort().join(',');
  if (callers !== 'addCurrent,recAction') miss.push('會寫清單的函式變了：' + callers);
  if (!/addEventListener\('storage'/.test(w.js)) miss.push('沒有聽 storage 事件');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㉟ Artifacts 版的清單住在 artifact 的資料庫裡〔owner 2026-10-11 實測：iPhone 的 Claude App 把 artifact 關掉重開，localStorage 就讀不回來〕。
//    (a) **一筆一份文件**——加入／取代只 set 自己那一份、刪除只 delete 自己那一份；沒有「整份清單」那種文件（整份寫回去就是 ㉞ 那個坑）
//    (b) 畫面上的清單＝資料庫送來的 ⊕ 這個畫面還沒被確認的寫入（mergeRemote），依 order 排、同值依 id
//    (c) 資料庫作主之後不再寫這支瀏覽器的清單那一格（留著的話，別台刪掉的紀錄日後會從這裡被送回去）
//    (d) id／order 不進 JSON 輸出；build.py 真的把那支同步帶進去，而且宣告的規則是 owner 才讀寫
check('㉟ Artifacts 版：清單存資料庫、一筆一份文件', (w) => {
  const L = w.Lib, miss = [];
  const r = (id, order, input) => ({ id, order, input: input || id, title: '', options: L.DEFAULT_OPTIONS, savedAt: '' });
  const remote = [r('b', 20), r('a', 10), r('c', 30)];
  const ids = (xs) => xs.map((x) => x.id + (x.input !== x.id ? '=' + x.input : '')).join(' ');
  if (ids(L.mergeRemote(remote, {}, {})) !== 'a b c') miss.push('沒依 order 排');
  if (ids(L.mergeRemote(remote, { d: r('d', 15), b: r('b', 20, 'NEW') }, { c: true })) !== 'a d b=NEW') miss.push('待確認的寫入沒併進去：' + ids(L.mergeRemote(remote, { d: r('d', 15), b: r('b', 20, 'NEW') }, { c: true })));
  if (ids(L.mergeRemote([r('y', 5), r('x', 5)], {}, {})) !== 'x y') miss.push('order 相同時沒依 id 排（兩台裝置會看到不同順序）');
  if (ids(L.mergeRemote(remote, { c: r('c', 30, 'Z') }, { c: true })) !== 'a b') miss.push('已刪除的又被待確認的寫入帶回來');
  if (remote.map((x) => x.id).join('') !== 'bac') miss.push('mergeRemote 改了傳進來的陣列');
  if (L.nextOrder([r('a', 10), r('b', 99)], 50) !== 100 || L.nextOrder([], 50) !== 50 || L.nextOrder([r('a', 10)], 50) !== 50) miss.push('nextOrder');
  const rec = L.makeRecord('t', 'o;m', null, 'S', 'rabc', 42);
  if (!rec || rec.id !== 'rabc' || rec.order !== 42) miss.push('makeRecord 沒帶 id／order');
  const out = L.buildExport([rec], () => ({ siddham: 's', latin: 'l', ascii: 'a', codepoints: 'c' }), 'T').records[0];
  if ('id' in out || 'order' in out) miss.push('id／order 漏進 JSON 輸出');
  // 同步那一支：只對 records/<id> 與 state/title 做 set／delete
  const src = w.remote.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s\/\/.*$/gm, '');
  if (!/db\.collection\(COL\)\.doc\(rec\.id\)\.set\(\{/.test(src)) miss.push('put 不是寫 records/<id> 那一份');
  if (!/db\.collection\(COL\)\.doc\(id\)\.delete\(\)/.test(src)) miss.push('remove 不是刪 records/<id> 那一份');
  const sets = [...src.matchAll(/\.set\(/g)].length;
  if (sets !== 2) miss.push('同步那一支有 ' + sets + ' 處 set（應為 2：一筆紀錄、標題）');
  if (/items\s*:/.test(src)) miss.push('同步那一支出現整份清單的寫法（items:）');
  if (!/fromCache/.test(src)) miss.push('沒有分辨「還不是完整版本」的清單');
  // 控制器：資料庫作主時不碰這支瀏覽器的清單那一格
  if (!/function saveItems\(\) \{\s*if \(remoteOn\(\)\) return;/.test(w.js)) miss.push('資料庫作主時仍寫 localStorage 的清單');
  if (!/function syncItems\(\) \{\s*if \(remoteOn\(\)\) return 'same';/.test(w.js)) miss.push('資料庫作主時仍拿 localStorage 蓋掉清單');
  if (!/Lib\.normalizeStore\(\{ items: list \}\)/.test(w.js)) miss.push('資料庫來的清單沒走白名單');
  // 建置：帶進 dist、在控制器之前載入、宣告 owner 才讀寫
  if (!/shutil\.copy2\(HERE \/ 'src' \/ 'remote-db\.js'/.test(w.build)) miss.push('build.py 沒帶 remote-db.js');
  if (!/\('index\.html', CONTROLLER_TAG, REMOTE_TAG \+ CONTROLLER_TAG\)/.test(w.build)) miss.push('build.py 沒在控制器之前載入它');
  if (!/"db": \{"rules": \[\{"path": "", "read": "owner", "write": "owner"\}\]\}/.test(w.build)) miss.push('宣告的規則不是 owner 才讀寫');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

/* ---------- 工具 ---------- */
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '.git' ? [] : walk(p);
    return [p];
  });
}

async function run(world, quiet) {
  const res = [];
  for (const c of CHECKS) {
    let r;
    try { r = await c.fn(world); } catch (e) { r = 'FAIL: ' + e.message; }
    res.push({ name: c.name, r });
    if (!quiet) console.log((r === true ? 'PASS' : r === SKIP ? 'SKIP' : 'FAIL') + '  ' + c.name + (typeof r === 'string' ? '  — ' + r : ''));
  }
  return res;
}

/* ---------- 反向驗證：每一種改壞都必須讓指定的那一條 FAIL ---------- */
const MUTANTS = [
  ['①', '轉換結果被改', (w) => { const C = w.SiddhamConverter; w.SiddhamConverter = class extends C { convert(i) { const r = super.convert(i); return Object.assign({}, r, { latin: r.latin.toUpperCase() }); } }; }],
  ['②', 'catalog 的接續字形錯一格', (w) => { const e = w.catalog.categories.find((c) => c.id === 'ligature').entries.find((x) => x.group === 'siddham'); e.char = '𑖏𑖿'; }],
  ['②', '例外清單以外的體文對不上', (w) => { const e = w.catalog.categories.find((c) => c.id === 'bindu').entries.find((x) => x.code === 'aa'); e.char = '𑖰'; }],
  // ⚠️ 換的是 keysFor（③ 走它）——換 keysFromCatalog 的話 keysFor 內部用的是閉包裡那一支，注入會安靜地沒作用（2026-10-09 selftest 抓到）
  ['③', '插入不轉小寫（S 在 KH 下變 ṣ）', (w) => { const f = w.Lib.keysFor; w.Lib.keysFor = (c, e, id) => f(c, e, id).map((k) => k.ins === 's' ? Object.assign({}, k, { ins: 'S' }) : k); }],
  ['④', 'insertAt 游標算錯', (w) => { const f = w.Lib.insertAt; w.Lib.insertAt = (...a) => { const r = f(...a); return { value: r.value, caret: r.caret - 1 }; }; }],
  ['⑤', 'shellBox 忽略 offsetTop', (w) => { const f = w.Lib.shellBox; w.Lib.shellBox = (m) => { const r = f(m); return r && { top: 0, height: r.height }; }; }],
  ['⑥', '網址列收合被當成鍵盤', (w) => { w.Lib.keyboardOpen = (b, h) => b - h >= 60; }],
  ['⑦', '讀回的選項不驗證', (w) => { w.Lib.normalizeOptions = (o) => Object.assign({}, w.Lib.DEFAULT_OPTIONS, o || {}); }],
  ['⑧', '輸入搬到輸出上面', (w) => { w.html = w.html.replace('id="out-pane"', 'id="__tmp__"').replace('id="bm-input"', 'id="out-pane"').replace('id="__tmp__"', 'id="bm-input"'); }],
  ['⑨', '整頁又可以捲', (w) => { w.css = w.css.replace(/(html,\s*body\s*\{[^}]*)overflow:\s*hidden/, '$1overflow: auto'); }],
  ['⑩', '字級降到 14px', (w) => { w.css = w.css.replace(/--ctl-font:\s*\d+px/, '--ctl-font: 14px'); }],
  ['⑪', '記號列不擋 mousedown', (w) => { w.js = w.js.replace("$keybar.addEventListener('mousedown'", "$keybar.addEventListener('pointerup'"); }],
  ['⑫', '改回 Materialize 自製下拉', (w) => { w.js += '\nM.FormSelect.init(document.querySelectorAll("select"));'; }],
  ['⑬', '輸入框允許自動大寫', (w) => { w.html = w.html.replace('autocapitalize="off"', 'autocapitalize="sentences"'); }],
  ['⑭', '少一語的 key', (w) => { delete w.locales.ja['toast.inputCleared']; }],
  ['⑭', 'HTML 用了未定義的 key', (w) => { w.html = w.html.replace('data-i18n="opt.done"', 'data-i18n="opt.finish"'); }],
  ['⑮', '共用文案漂掉', (w) => { w.locales.en['tool.lang'] = 'Switch language'; }],
  ['⑪', '切換鈕不擋 mousedown', (w) => { w.js = w.js.replace("keysetBtn.addEventListener('mousedown'", "keysetBtn.addEventListener('pointerup'"); }],
  ['⑳', '安全區改回墊在頁首', (w) => { w.css = w.css.replace(/(\.topbar\s*\{[^}]*?)padding: 0 4px 0 16px;/, '$1padding: env(safe-area-inset-top, 0px) 4px 0 16px;'); }],
  ['㉑', '切換鈕跑到清除鈕左邊', (w) => { w.html = w.html.replace('id="clear-input"', 'id="__c__"').replace('id="keyset-toggle"', 'id="clear-input"').replace('id="__c__"', 'id="keyset-toggle"'); }],
  ['㉒', '改回上下排', (w) => { w.css = w.css.replace(/(\.out-pane\s*\{[^}]*flex-direction:\s*)row/, '$1column'); }],
  ['㉒', '比例寫成 grow 2:1', (w) => { w.css = w.css.replace('flex: 0 0 calc((100% - 8px) * 2 / 3)', 'flex: 2 1 0'); }],
  ['㉒', '文字不靠底', (w) => { w.css = w.css.replace(/(^\.out-text\s*\{[^}]*?)margin-top:\s*auto;/m, '$1'); }],
  ['㉒', '聚焦時仍墊底部安全區', (w) => { w.css = w.css.replace('.shell:has(#bm-input:focus) { padding-bottom: 0; }', ''); }],
  ['㉓', '拉丁欄的複製列搬回頂端', (w) => { w.html = w.html.replace(/(<div class="out-block out-block-latin">\n)(        <div class="out-value">.*\n)((?:.*\n){6})/, '$1$3$2'); }],
  ['㉔', '母音排到體文後面', (w) => { w.Lib.KEYSET_IDS.splice(0, 4, 'variant', 'bindu', 'vowel', 'ligature'); }],
  ['㉔', '異體字組少一格', (w) => { const c = w.catalog.categories.find((x) => x.id === 'variant'); c.entries = c.entries.filter((e) => e.code !== '_ii'); }],
  ['②', '__u 不再轉出 𑗛（轉換層副作用消失）', (w) => { const c = w.catalog.categories.find((x) => x.id === 'variant'); c.entries.find((e) => e.code === '__u').code = '_u'; }],
  ['⑭', '少了 keyset.vowel 的文案', (w) => { delete w.locales['zh-Hant']['keyset.vowel']; delete w.locales.en['keyset.vowel']; delete w.locales.ja['keyset.vowel']; }],
  ['㉔', '上接續被去重（少了同記法的異體）', (w) => { const f = w.Lib.keysFor; w.Lib.keysFor = (c, e, id) => { const ks = f(c, e, id); const seen = {}; return id === 'ligature_u' ? ks.filter((k) => !seen[k.ins] && (seen[k.ins] = 1)) : ks; }; }],
  ['㉔', '上下接續排到接續後面', (w) => { w.Lib.KEYSET_IDS.splice(0, 6, 'vowel', 'variant', 'bindu', 'ligature', 'ligature_u', 'ligature_l'); }],
  ['㉖', 'sprite 少一個字形', (w) => { if (w.sprite) w.sprite = w.sprite.replace(/<symbol id="cb-65d0"[^]*?<\/symbol>/, ''); else w.sprite = '<svg></svg>'; }],
  ['㉗', '盷 寫回清單上的 .th', (w) => { w.catalog.categories.find((c) => c.id === 'ligature').entries.find((e) => e.char === '盷').code = '.th'; }],
  ['㉗', '祋 排到 k.s 之後', (w) => { const es = w.catalog.categories.find((c) => c.id === 'ligature').entries; const i = es.findIndex((e) => e.char === '祋'); const [x] = es.splice(i, 1); es.push(x); }],
  ['㉗', '母音的 焐 也被收進記號列（白名單失效）', (w) => { w.Lib.CATALOG_CBETA_SETS.vowel = true; const v = w.catalog.categories.find((c) => c.id === 'vowel').entries.find((e) => e.group === 'uniSiddham'); const l = w.catalog.categories.find((c) => c.id === 'ligature'); l.entries.push(Object.assign({}, v)); }],
  ['㉘', 'Noto 字號改回 1.05rem', (w) => { w.css = w.css.replace(/(^\.key-glyph\s*\{[^}]*?font-size:\s*)19px/m, '$11.05rem'); }],
  ['㉘', 'CBETA 完整字母改回 22px', (w) => { w.css = w.css.replace('.key-cbeta-whole .key-svg { height: 19px; }', '.key-cbeta-whole .key-svg { height: 22px; }'); }],
  ['⑲', '控制器直接 import 引擎', (w) => { w.js = 'import { ascii2siddham } from "./vendor/bonji-input/siddham.js";\n' + w.js; }],
  ['㉙', '標題被當成鍵（同名的覆寫前一筆）', (w) => { w.Lib.addRecord = (items, rec) => { const i = items.findIndex((x) => x.title === rec.title); return i >= 0 ? items.map((x, k) => (k === i ? rec : x)) : items.concat([rec]); }; }],
  ['㉙', '空標題不給加', (w) => { const f = w.Lib.makeRecord; w.Lib.makeRecord = (t, i, o, s) => (String(t || '').trim() ? f(t, i, o, s) : null); }],
  ['㉙', 'part 不分標題（等於 seq）', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (...a) => { const e = f(...a); e.records.forEach((r) => { r.part = r.seq; }); return e; }; }],
  ['㉙', '取代把那一筆搬到最後', (w) => { w.Lib.replaceRecord = (items, i, rec) => items.filter((_, k) => k !== i).concat([rec]); }],
  ['㉚', '每一筆都用第一筆的選項', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (items, c, t) => f(items, (i) => c(i, items[0].options), t); }],
  ['㉚', '轉不出來的那一筆被安靜地丟掉', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (...a) => { const e = f(...a); e.records = e.records.filter((r) => r.output); e.count = e.records.length; return e; }; }],
  ['㉚', '控制器共用畫面上那個轉換器', (w) => { w.js = w.js.replace('return new SiddhamConverter(options).convert(input);', 'return converter.convert(input);'); }],
  ['㉛', '讀回的清單不驗證', (w) => { w.Lib.normalizeStore = (s) => s || { title: '', items: [] }; }],
  ['㉜', '加入鈕不擋 mousedown', (w) => { w.js = w.js.replace("quick.addEventListener('mousedown'", "quick.addEventListener('pointerup'"); }],
  ['㉜', '加入鈕搬到頁首', (w) => { const m = w.html.match(/          <a href="#!" id="rec-add-quick"[\s\S]*?<\/a>\n/); w.html = w.html.replace(m[0], '').replace('<a href="#!" id="open-options"', m[0] + '<a href="#!" id="open-options"'); }],
  ['㉜', '標題的清除鈕不擋 mousedown', (w) => { w.js = w.js.replace("titleClear.addEventListener('mousedown'", "titleClear.addEventListener('pointerup'"); }],
  ['㉜', '清除鈕包回 <label> 裡', (w) => { w.html = w.html.replace('<div class="rec-title-row">', '<label class="rec-title-row">').replace(/(id="rec-title-clear"[\s\S]*?<\/a>\n\s*)<\/div>/, '$1</label>'); }],
  ['㉜', '標題欄字級寫死 16px', (w) => { w.css = w.css.replace(/(input\[type="text"\]\.rec-title\s*\{[^}]*font-size:\s*)var\(--ctl-font\)/, '$116px'); }],
  ['㉜', '刪除改用 confirm()', (w) => { w.js = w.js.replace("if (!isArmed(act, i)) { arm(act, i, 'rec.toast.confirmRemove', { n: n }); return; }", "if (!confirm('delete?')) return;"); }],
  ['㉜', 'JSON 排到標題欄上面', (w) => { w.html = w.html.replace('id="rec-title"', 'id="__t__"').replace('id="rec-json"', 'id="rec-title"').replace('id="__t__"', 'id="rec-json"'); }],
  ['㉜', '標題欄有焦點時也更新鍵盤基準', (w) => { w.js = w.js.replace(' && document.activeElement !== $recTitle) state.baseline', ') state.baseline'); }],
  ['㉝', '存完不讀回比對', (w) => { w.js = w.js.replace('ok = localStorage.getItem(REC_KEY) === text;', 'ok = true;'); }],
  ['㉝', '下載檔名不補零', (w) => { w.Lib.exportFilename = (d) => 'bonji-mobile-' + d.getFullYear() + (d.getMonth() + 1) + d.getDate() + d.getHours() + d.getMinutes() + d.getSeconds() + '.json'; }],
  ['㉞', '清除標題又去寫清單', (w) => { w.js = w.js.replace("    state.rec.title = '';\n    saveTitle();", "    state.rec.title = '';\n    saveItems();\n    saveTitle();"); }],
  ['㉞', '關掉面板時整份重寫', (w) => { w.js = w.js.replace('disarm(); saveTitle(); }   //', 'disarm(); saveItems(); saveTitle(); }   //'); }],
  ['㉞', '標題與清單又存回同一格', (w) => { w.js = w.js.replace("var REC_TITLE_KEY = 'bonji-mobile-rec-title'", "var REC_TITLE_KEY = 'bonji-mobile-records'"); }],
  ['㉞', '清單裡又帶著標題整格寫', (w) => { w.js = w.js.replace('JSON.stringify({ items: state.rec.items })', 'JSON.stringify(state.rec)'); }],
  ['㉞', '加入之前不看儲存區', (w) => { w.js = w.js.replace('    syncItems();   // 別的畫面記過新的', '    // 別的畫面記過新的'); }],
  ['㉞', '刪除／取代不管別處改過', (w) => { w.js = w.js.replace("if (syncItems() === 'changed') {\n      disarm();\n      renderRecords();\n      recToast", "if (false) {\n      disarm();\n      renderRecords();\n      recToast"); }],
  ['㉞', '讀不到被當成清單被清空', (w) => { w.Lib.storeDrift = (a, b) => (a === b ? 'same' : 'changed'); }],
  ['㉟', '刪除被待確認的寫入帶回來', (w) => { const f = w.Lib.mergeRemote; w.Lib.mergeRemote = (re, put, del) => f(re, put, {}).filter((x) => !(del || {})[x.id] || (put || {})[x.id]); }],
  ['㉟', '清單不排序（照資料庫給的順序）', (w) => { w.Lib.mergeRemote = (re, put, del) => re.filter((x) => !del[x.id]).map((x) => put[x.id] || x).concat(Object.keys(put).filter((id) => !re.some((x) => x.id === id) && !del[id]).map((id) => put[id])); }],
  ['㉟', 'id 漏進 JSON 輸出', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (items, c, t) => { const e = f(items, c, t); e.records.forEach((r, i) => { r.id = items[i].id; }); return e; }; }],
  ['㉟', '同步改成整份清單寫一份文件', (w) => { w.remote = w.remote.replace("return db.collection(COL).doc(rec.id).set({", "return db.doc('state/list').set({ items: [rec] }); db.collection(COL).doc(rec.id).set({"); }],
  ['㉟', '資料庫作主時又寫回 localStorage', (w) => { w.js = w.js.replace("    if (remoteOn()) return;   // 同上", "    // 同上"); }],
  ['㉛', '讀回的 id 不驗證（會被拿去當文件路徑）', (w) => { const f = w.Lib.normalizeStore; w.Lib.normalizeStore = (s) => { const o = f(s); ((s && s.items) || []).forEach((r, i) => { if (o.items[i] && r && r.id) o.items[i].id = r.id; }); return o; }; }],
  ['㉟', '規則放寬成任何看得到的人都能讀', (w) => { w.build = w.build.replace('"read": "owner"', '"read": "view"'); }],
  ['⑭', '紀錄的 toast 用了未定義的 key', (w) => { w.js = w.js.replace("recToast('rec.toast.replaced'", "recToast('rec.toast.replacedX'"); }]
];

async function selftest() {
  let missed = 0;
  for (const [id, desc, mutate] of MUTANTS) {
    const w = await loadWorld();
    mutate(w);
    const res = await run(w, true);
    const hit = res.find((r) => r.name.startsWith(id));
    const caught = hit && typeof hit.r === 'string' && hit.r.startsWith('FAIL');
    if (!caught) missed++;
    console.log((caught ? 'CAUGHT ' : 'MISSED ') + id + '  ' + desc);
  }
  // 對照組：沒改壞的世界必須全綠（否則上面的 CAUGHT 可能只是它本來就紅）
  const base = await run(await loadWorld(), true);
  const baseRed = base.filter((r) => typeof r.r === 'string');
  console.log(baseRed.length ? 'BASELINE RED: ' + baseRed.map((r) => r.name).join(', ') : 'baseline 全綠');
  console.log(`\n${MUTANTS.length - missed}/${MUTANTS.length} 個注入被抓到`);
  process.exit(missed || baseRed.length ? 1 : 0);
}

(async () => {
  if (process.argv.includes('--selftest')) return selftest();
  const res = await run(await loadWorld(), false);
  const fail = res.filter((r) => typeof r.r === 'string').length;
  const skip = res.filter((r) => r.r === SKIP).length;
  console.log(`\n${res.length - fail - skip} PASS ／ ${fail} FAIL ／ ${skip} SKIP（共 ${res.length} 條）`);
  process.exit(fail ? 1 : 0);
})();
