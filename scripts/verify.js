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
//    體文是附在子音上的符號 ⇒ 探針用 `k`＋記法、比結尾；接續直接比。
//    ⚠️ 已知例外寫成清單、不是放寬比對：體文 `a` 在 xlsx 裡的字形是 U+115C0（nukta），而 `a` 是固有母音、
//       引擎不畫任何符號——**那是來源資料的寫法，本 app 照原樣顯示**。清單以外的對不上一律紅。
const GLYPH_EXCEPTIONS = { bindu: ['a'] };
check('② 記號列字形與引擎一致', (w) => {
  const c = new w.SiddhamConverter();
  const bad = [];
  for (const id of w.Lib.KEYSET_IDS) {
    const keys = w.Lib.keysFromCatalog(w.catalog, id);
    if (!keys.length) { bad.push(id + ' 0 個鍵'); continue; }
    for (const k of keys) {
      if ((GLYPH_EXCEPTIONS[id] || []).includes(k.ins)) continue;
      const out = c.convert(id === 'bindu' ? 'k' + k.ins : k.ins).siddham;
      if (!k.glyph || !out.endsWith(k.glyph)) bad.push(id + ':' + k.ins);
    }
  }
  return bad.length ? 'FAIL: ' + bad.join(' ') : true;
});

// ③ 插入的記法在兩種輸入法下結果相同（catalog 的 `S` 在 KH 下會變成 ṣ ⇒ 插入一律小寫）
check('③ 記號列在 ISO／KH 下同字', (w) => {
  const iso = new w.SiddhamConverter({ inputMethod: 'ISO15919' });
  const kh = new w.SiddhamConverter({ inputMethod: 'KH' });
  const bad = [];
  for (const id of w.Lib.KEYSET_IDS) {
    for (const k of w.Lib.keysFromCatalog(w.catalog, id)) {
      const probe = id === 'bindu' ? 'k' + k.ins : k.ins;
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
      'data/catalog.json']
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
  ['③', '插入不轉小寫（S 在 KH 下變 ṣ）', (w) => { const f = w.Lib.keysFromCatalog; w.Lib.keysFromCatalog = (cat, id) => f(cat, id).map((k) => k.ins === 's' ? { ins: 'S', glyph: k.glyph } : k); }],
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
  ['⑲', '控制器直接 import 引擎', (w) => { w.js = 'import { ascii2siddham } from "./vendor/bonji-input/siddham.js";\n' + w.js; }]
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
