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
    backup: read(path.join(REPO, 'scripts', 'backup-artifact.sh')),
    font: fs.readFileSync(path.join(APP, 'fonts', 'NotoSansSiddham-Regular.woff2')),
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

// ㉔ 記號列七組的順序：母音 → 異體字 → 接續 → 體文 → 上接續 → 下接續 → 符號〔owner 2026-10-11 逐項指定；
//    在那之前是 母音 → 異體字 → 體文 → 上接續 → 下接續 → 接續（→ 符號），接續被移到體文前面〕。
//    切換鈕依 KEYSET_IDS 的順序循環、預設是第一組 ⇒ 順序本身就是規格。
check('㉔ 記號列七組依序：母音 → 異體字 → 接續 → 體文 → 上接續 → 下接續 → 符號', (w) => {
  const ids = w.Lib.KEYSET_IDS.join(',');
  if (ids !== 'vowel,variant,ligature,bindu,ligature_u,ligature_l,symbol') return 'FAIL: KEYSET_IDS = ' + ids;
  // 符號〔owner 2026-10-11〕：catalog 的 symbol 類整組都收（全是 Unicode 悉曇）；字形對不對由 ② 逐一驗，這裡只確認它不是空的、而且句讀 `|` `||` 在裡面
  const sym = w.Lib.keysFromCatalog(w.catalog, 'symbol');
  const want = (w.catalog.categories.find((c) => c.id === 'symbol') || { entries: [] }).entries.filter((e) => e.group === 'siddham').length;
  if (!sym.length || sym.length !== want) return 'FAIL: 符號 ' + sym.length + ' 鍵（catalog 的 symbol 類有 ' + want + ' 格 Unicode 悉曇）';
  if (!sym.some((k) => k.ins === '|' && k.glyph === '𑗅') || !sym.some((k) => k.ins === '||' && k.glyph === '𑗉')) return 'FAIL: 符號組裡沒有 | 𑗅／|| 𑗉';
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
  if (keys !== 'seq,part,title,type,source,options,input,output,savedAt') bad.push('一筆的欄位變了：' + keys);
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
    eq(s.items[0], { title: '', type: '', source: '', input: 'o;m', options: d, savedAt: '', id: '', order: 0 }) &&
    eq(s.items[1], { title: 't', type: '', source: '', input: 'hrii.h', options: kh, savedAt: 'S', id: '', order: 0 }) &&
    // 類型（第 ㊵ 條）：字串才收、單行（空白收成一個、去頭尾）；不是字串當成空的
    eq(L.normalizeStore({ items: [{ input: 'a', type: '  種子 \n 字 ' }, { input: 'b', type: 5 }, { input: 'c', type: ['真言'] }] }).items.map((i) => i.type), ['種子 字', '', '']) &&
    // 來源（第 ㊴ 條）：字串才收、換行統一、去頭尾空白；不是字串當成空的
    eq(L.normalizeStore({ items: [{ input: 'a', source: '  T20\r\np.107a \n' }, { input: 'b', source: 5 }, { input: 'c', source: { x: 1 } }] }).items.map((i) => i.source), ['T20\np.107a', '', '']) &&
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
  // 面板裡會叫出鍵盤的欄位：標題欄，以及編輯表單的標題與記法（第 ㊳ 條）
  if (!/if \(!focused && !typingInSheet\(\)\) state\.baseline = box\.height;/.test(w.js)) miss.push('標題欄有焦點時仍更新鍵盤基準');
  const tis = fnBody(w.js, 'typingInSheet');
  if (!['$recTitle', '$recType', '$recSource', '$editTitle', '$editType', '$editSource', '$editInput'].every((v) => tis.indexOf('a === ' + v) > 0)) miss.push('typingInSheet 少算了會叫出鍵盤的欄位');
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
    '面板關閉': (w.js.match(/M\.Modal\.init\(\$recModal, \{[\s\S]*?\n    \}\);/) || [''])[0],
    // 來源欄（第 ㊴ 條）與標題欄同一條規矩
    clearSource: fnBody(w.js, 'clearSource'),
    saveSource: fnBody(w.js, 'saveSource'),
    '來源欄 input': (w.js.match(/\$recSource\.addEventListener\('input', function \(\) \{[\s\S]*?\n    \}\);/) || [''])[0],
    // 類型欄（第 ㊵ 條）：打字、點快選鈕、清除都走 setPanelType
    setPanelType: fnBody(w.js, 'setPanelType'),
    clearType: fnBody(w.js, 'clearType'),
    saveType: fnBody(w.js, 'saveType')
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
  if (callers !== 'addCurrent,recAction,saveEdit') miss.push('會寫清單的函式變了：' + callers);
  // 編輯存回（第 ㊳ 條）是第三條會寫清單的路：一樣先看儲存區，別處改過就停下來
  const se = fnBody(w.js, 'saveEdit');
  if (!/^\s*function saveEdit\(\) \{\s*var ed = state\.edit;\s*if \(!ed\) return;\s*(\/\/[^\n]*\n\s*)*if \(syncItems\(\) === 'changed'\) \{[\s\S]*?return;\s*\}/.test(se.replace(/^\n/, ''))) miss.push('編輯存回之前沒有先看儲存區');
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
  if (sets !== 4) miss.push('同步那一支有 ' + sets + ' 處 set（應為 4：一筆紀錄、標題欄、來源欄、類型欄）');
  // 來源（第 ㊴ 條）是那一筆自己的欄位：寫進去、讀回來都要帶著——漏了其中一邊，來源會在同步之後安靜地變成空的
  // 類型（第 ㊵ 條）同理
  if (!/\.set\(\{\s*title: rec\.title, type: rec\.type \|\| '', source: rec\.source \|\| '', input:/.test(src)) miss.push('put 沒有把類型與來源寫進那一筆的文件');
  if (!/return \{ id: doc\.id, title: x\.title, type: x\.type, source: x\.source, input:/.test(src)) miss.push('讀回來的清單沒帶類型或來源');
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

// ㊱ 備份腳本（scripts/backup-artifact.sh）——**在暫存資料夾裡真的跑**，不是看它的字面：
//    (a) 空的清單是合法的，但不寫新檔、不輪替（連續空的清單不可以把最後一份有內容的備份擠掉）
//    (b) 磁碟上的檔數 ≠ 呼叫端報的筆數 ⇒ exit 1、既有備份不動（取回不完整，或混進上一次留下的檔）
//    (c) 不合格的文件 ⇒ exit 1、隔離、既有備份不動；(d) 內容與上一份相同 ⇒ 不另存；(e) 用完把取回來的檔清掉
check('㊱ 備份腳本：空的不輪替／檔數要對得上／壞的不覆蓋好的', (w) => {
  const os = require('os');
  const { spawnSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-backup-'));
  try {
    // 腳本以它自己的位置找 lib ⇒ 在暫存區擺出同樣的相對位置（lib 用世界裡那一份，selftest 改得到）
    const sdir = path.join(tmp, 'repo', 'scripts'), ldir = path.join(tmp, 'repo', 'public', 'apps', 'bonji-mobile');
    fs.mkdirSync(sdir, { recursive: true }); fs.mkdirSync(ldir, { recursive: true });
    const script = path.join(sdir, 'backup-artifact.sh');
    fs.writeFileSync(script, w.backup, { mode: 0o755 });
    fs.writeFileSync(path.join(ldir, 'bonji-mobile-lib.js'), w.libSrc);
    const root = path.join(tmp, 'root'), pull = path.join(tmp, 'pull'), rec = path.join(pull, 'records');
    fs.mkdirSync(rec, { recursive: true });
    const env = Object.assign({}, process.env, { BM_BACKUP_ROOT: root, BM_BACKUP_CLOUD: '-', BM_BACKUP_NOTIFY: '0' });
    const put = (id, input, order) => fs.writeFileSync(path.join(rec, id + '.json'), JSON.stringify({ title: 't', input, options: {}, savedAt: 'S', order }));
    const run = (n) => spawnSync('sh', [script, pull, String(n)], { env, encoding: 'utf8' }).status;
    const backups = () => (fs.existsSync(root) ? fs.readdirSync(root).filter((f) => /^bonji-mobile-artifact-.*\.json$/.test(f)).sort() : []);
    const newest = () => JSON.parse(fs.readFileSync(path.join(root, backups().slice(-1)[0]), 'utf8'));
    const bad = [];
    if (run(0) !== 0 || backups().length !== 0) bad.push('空的清單寫出了備份檔，或沒有 exit 0');
    put('r2', 'ra tna', 20); put('r1', 'na mo', 10);
    if (run(2) !== 0 || backups().length !== 1) bad.push('兩筆的清單沒有備份成功');
    else if (newest().records.map((r) => r.id + ':' + r.input).join(' ') !== 'r1:na mo r2:ra tna') bad.push('備份檔的內容或順序不對');
    if (fs.readdirSync(rec).length !== 0) bad.push('取回來的檔沒有清掉（下一次會混進來）');
    // ⚠️ 不能只數檔案：檔名只到秒，同一秒內另存會蓋掉同名的那一份、數量不變（selftest 抓到的）⇒ 比檔案裡的 pulledAt（毫秒）
    const before = backups().length === 1 ? newest().pulledAt : '';
    put('r2', 'ra tna', 20); put('r1', 'na mo', 10);
    if (run(2) !== 0 || backups().length !== 1 || newest().pulledAt !== before) bad.push('內容相同卻另存了一份');
    put('r1', 'na mo', 10);
    if (run(2) !== 1 || backups().length !== 1) bad.push('檔數對不上卻沒有失敗');
    put('r1', 'na mo', 10); fs.writeFileSync(path.join(rec, 'bad.json'), JSON.stringify({ title: 'x', order: 5 }));
    if (run(2) !== 1 || backups().length !== 1 || newest().count !== 2) bad.push('不合格的文件沒有被擋下，或動到了既有備份');
    if (run(0) !== 0 || backups().length !== 1 || newest().count !== 2) bad.push('之後空的清單動到了既有備份');
    // 來源（第 ㊴ 條）也是內容：只改了來源要另存一份，而且備份檔裡帶著那一欄；舊備份沒有這一欄不算「改過」（上面「內容相同」那一步已經驗到）
    const stamp = backups().length ? newest().pulledAt : '';
    fs.writeFileSync(path.join(rec, 'r2.json'), JSON.stringify({ title: 't', source: '大正藏 T20', input: 'ra tna', options: {}, savedAt: 'S', order: 20 })); put('r1', 'na mo', 10);
    if (run(2) !== 0 || newest().pulledAt === stamp || (newest().records.find((r) => r.id === 'r2') || {}).source !== '大正藏 T20') bad.push('只改了來源沒有另存，或備份檔沒帶來源');
    // 類型（第 ㊵ 條）同理：這一次差的只有類型（記法與來源都與上一份逐字相同）
    const stamp2 = backups().length ? newest().pulledAt : '';
    fs.writeFileSync(path.join(rec, 'r2.json'), JSON.stringify({ title: 't', type: '真言', source: '大正藏 T20', input: 'ra tna', options: {}, savedAt: 'S', order: 20 })); put('r1', 'na mo', 10);
    if (run(2) !== 0 || newest().pulledAt === stamp2 || (newest().records.find((r) => r.id === 'r2') || {}).type !== '真言') bad.push('只改了類型沒有另存，或備份檔沒帶類型');
    return bad.length ? 'FAIL: ' + bad.join('、') : true;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ㊲ 記號列上每一顆畫 Unicode 字形的鍵，**隨附的那支 Noto Sans Siddham 都要有那個字**（直接讀 woff2 的 cmap）。
//    ⚠️ 這件事在 Mac 上用眼睛看不出來：macOS 自己帶一支悉曇字型，隨附的那支缺字時畫面上照樣有字（系統後備接走）；
//       手機上沒有那支後備，缺的那一格就是豆腐。2026-10-11 加「符號」組時量像素量不出結果（後備與隨附的字形長得一樣），才改成讀字型本身。
function woff2Covers(buf) {
  const zlib = require('zlib');
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('不是 woff2');
  const numTables = buf.readUInt16BE(12);
  let p = 48;
  const b128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const c = buf[p++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) return v >>> 0; } throw new Error('UIntBase128 讀不出來'); };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++], idx = flags & 0x3f, ver = flags >> 6;
    if (idx === 63) p += 4;                       // 不在已知清單裡的 tag：後面跟 4 個位元組
    const orig = b128();
    // glyf(10)／loca(11) 的 transform 版本 0＝有轉換；其餘的表非 0 才有 ⇒ 有轉換的多一個 transformLength
    const transformed = (idx === 10 || idx === 11) ? ver === 0 : ver !== 0;
    tables.push({ idx, len: transformed ? b128() : orig });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(p, p + buf.readUInt32BE(20)));
  let off = 0, cmap = null;
  for (const t of tables) { if (t.idx === 0) cmap = data.subarray(off, off + t.len); off += t.len; }   // 0 ＝ cmap
  if (!cmap) throw new Error('字型裡沒有 cmap');
  const groups = [];
  for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) {
    const so = cmap.readUInt32BE(4 + i * 8 + 4);
    if (cmap.readUInt16BE(so) !== 12) continue;   // 悉曇在 BMP 之外 ⇒ 只看 format 12
    for (let g = 0, ng = cmap.readUInt32BE(so + 12); g < ng; g++) groups.push([cmap.readUInt32BE(so + 16 + g * 12), cmap.readUInt32BE(so + 20 + g * 12)]);
  }
  if (!groups.length) throw new Error('cmap 沒有 format 12 的子表');
  return (cp) => groups.some(([a, b]) => cp >= a && cp <= b);
}
check('㊲ 隨附的 Noto 畫得出記號列上每一個 Unicode 字形', (w) => {
  const has = woff2Covers(w.font);
  // 對照組：讀法壞掉時（全部回 true／全部回 false）這兩行會先紅
  if (!has(0x1158E)) return 'FAIL: 對照組——字型裡應該有 U+1158E（ka）';
  if (has(0x11600) || has(0x5B57)) return 'FAIL: 對照組——字型裡不該有 U+11600（Modi）或 U+5B57（漢字）';
  const miss = [];
  let n = 0;
  for (const id of w.Lib.KEYSET_IDS) {
    for (const k of w.Lib.keysFromCatalog(w.catalog, id)) {
      if (!k.glyph) continue;
      n++;
      for (const ch of k.glyph) if (!has(ch.codePointAt(0))) miss.push(id + ':' + k.ins + ' U+' + ch.codePointAt(0).toString(16).toUpperCase());
    }
  }
  if (n < 90) return 'FAIL: 只檢查到 ' + n + ' 顆鍵（記號列的 Unicode 字形鍵應有 90 顆以上）';
  return miss.length ? 'FAIL: 字型缺 ' + miss.join('、') : true;
});

// ㊳ 編輯某一筆〔owner 2026-10-13：清單上每一筆多一顆 ✎，在面板裡改那一筆的標題／記法／選項〕。
//    (a) 改的是那一筆自己：id 與 order 沿用（身分與位置）；沒有更動 ⇒ 回原來那個物件（不寫入、savedAt 不變）；記法清空 ⇒ null（那是「刪除」的事）
//    (b) 存回時認 id 不認序號（表單開著的期間別處可能刪掉前面幾筆）；只寫那一筆——主畫面的輸入框、標題欄、畫面上的選項一個都不碰
//    (c) 編輯中唯一的出口是 儲存／取消：點面板外不關、「完成」收起來（按它會被讀成「存好了」）；有還沒存的更動時，取消要再按一次
//    (d) 表單在面板最上面、儲存／取消在表單第一列（鍵盤開著時下半截與底列被蓋住）；記法欄不自動大寫／校正、字級走 --ctl-font
//    期望值寫死在這裡，不取自 editRecord 自己的計算。
check('㊳ 編輯某一筆：只改那一筆、認 id、出口只有儲存／取消', (w) => {
  const L = w.Lib, miss = [];
  if (typeof L.editRecord !== 'function' || typeof L.indexOfId !== 'function') return 'FAIL: lib 沒有 editRecord／indexOfId';
  const kh = { inputMethod: 'KH', transliteration: 'ISO15919', ignoreSpacesAndHyphens: false };
  const dflt = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  const o = { title: '大悲咒', input: 'na mo', options: dflt, savedAt: 'OLD', id: 'r7', order: 42 };
  const snap = JSON.stringify(o);
  if (L.editRecord(o, '大悲咒', 'na mo', dflt, 'NEW') !== o) miss.push('沒有更動時沒有回原來那一筆（會白寫一次、savedAt 變成今天）');
  if (L.editRecord(o, '  大悲咒 ', 'na mo', { inputMethod: 'x' }, 'NEW') !== o) miss.push('只差在正規化會抹掉的地方也被當成更動');
  const e1 = L.editRecord(o, '心經咒', 'ga te', kh, 'NEW');
  if (!eq(e1, { title: '心經咒', type: '', source: '', input: 'ga te', options: kh, savedAt: 'NEW', id: 'r7', order: 42 })) miss.push('改過的那一筆 = ' + JSON.stringify(e1));
  const e2 = L.editRecord(o, '大悲咒', 'na mo', kh, 'NEW');
  if (!e2 || e2 === o || e2.options.inputMethod !== 'KH' || e2.id !== 'r7') miss.push('只改選項不算更動');
  const e3 = L.editRecord(o, '', 'na mo', dflt, 'NEW');
  if (!e3 || e3 === o || e3.title !== '') miss.push('把標題改成空的不算更動');
  const e4 = L.editRecord(o, '大悲咒', 'na mo ', dflt, 'NEW');
  if (!e4 || e4 === o || e4.input !== 'na mo ') miss.push('記法只差一個空格不算更動（空格是記法）');
  if (L.editRecord(o, 't', '   ', kh, 'NEW') !== null || L.editRecord(o, 't', '', kh, 'NEW') !== null) miss.push('記法清空也存得回去');
  if (L.editRecord(null, 't', 'a', kh, 'NEW') !== null) miss.push('沒有原來那一筆也編得出東西');
  if (JSON.stringify(o) !== snap) miss.push('editRecord 改了傳進來的那一筆');
  const list = [{ id: 'a' }, { id: 'b' }, null, { id: 'c' }];
  if (!(L.indexOfId(list, 'c') === 3 && L.indexOfId(list, 'a') === 0 && L.indexOfId(list, 'zz') === -1 && L.indexOfId(list, '') === -1 && L.indexOfId(null, 'a') === -1)) miss.push('indexOfId');

  const start = fnBody(w.js, 'startEdit'), save = fnBody(w.js, 'saveEdit'), end = fnBody(w.js, 'endEdit'), cancel = fnBody(w.js, 'cancelEdit');
  if (!start || !save || !end || !cancel) return 'FAIL: 找不到 startEdit／saveEdit／endEdit／cancelEdit' + (miss.length ? '；' + miss.join('、') : '');
  const MAIN = /\$input\b|\$recTitle\b|\$recSource\b|\$recType\b|\$inputMethod\b|\$translit\b|\$ignoreSpaces\b|state\.rec\.(title|source|type)|saveTitle|pushTitle|saveSource|pushSource|saveType|pushType|setPanelType|saveDraft|onInput\(/;
  if (MAIN.test(start)) miss.push('開始編輯時動了主畫面（輸入框／標題欄／選項）');
  if (MAIN.test(save)) miss.push('存回時動了主畫面（輸入框／標題欄／選項）');
  const iSync = save.indexOf("syncItems() === 'changed'"), iFind = save.indexOf('Lib.indexOfId(state.rec.items, ed.id)'), iRep = save.indexOf('Lib.replaceRecord(state.rec.items, i, rec)');
  if (!(iSync > 0 && iSync < iFind && iFind < iRep)) miss.push('存回不是「先看儲存區 → 以 id 找那一筆 → 就地取代」');
  if (!/if \(i < 0\) \{[^\n]*return; \}/.test(save)) miss.push('那一筆已經不在時仍然存回去（等於把別處刪掉的加回來）');
  if (!/if \(rec === ed\.orig\) \{[\s\S]*?return;\s*\}\s*state\.rec\.items = /.test(save)) miss.push('沒有更動也寫入');
  if ((save.match(/pushPut\(rec\)/g) || []).length !== 1 || /pushDel\(/.test(save)) miss.push('存回不是只寫那一筆');
  if (!/options\.dismissible = false;/.test(start) || !/options\.dismissible = true;/.test(end)) miss.push('編輯中點面板外面會關掉（或離開編輯後關不掉）');
  if (!/if \(editDraft\(''\) !== ed\.orig && !isArmed\('editCancel', i\)\) \{ arm\('editCancel', i, 'rec\.toast\.confirmDiscard'\); return; \}/.test(cancel)) miss.push('有還沒存的更動時，取消不必再按一次');
  if (!/recButton\('edit', i, 'edit', 'rec\.edit', false\)/.test(w.js)) miss.push('清單上沒有編輯鈕');
  if (!/if \(act === 'edit'\) \{ startEdit\(it\); return; \}/.test(w.js)) miss.push('編輯鈕沒有接到 startEdit');
  if (!/onCloseStart: function \(\) \{[^\n]*endEdit\(\);/.test(w.js)) miss.push('面板關掉時沒有離開編輯');

  if (!/\.records-sheet\.is-editing \.modal-footer > :not\(\.rec-edit-only\) \{ display: none; \}/.test(w.css)) miss.push('編輯中「完成」與輸出鈕仍看得到');
  if (!/\.records-sheet\.is-editing \.modal-content > :not\(\.rec-edit\) \{ display: none; \}/.test(w.css)) miss.push('編輯中清單沒有收起');
  if (!/textarea\.rec-edit-input\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css)) miss.push('記法欄沒用 --ctl-font');

  const sheet = (w.html.match(/<div id="records-modal"[\s\S]*?\n  <\/div>\n/) || [''])[0];
  const pe = sheet.indexOf('id="rec-edit"'), ph = sheet.indexOf('class="rec-heading rec-edit-head"'), pt = sheet.indexOf('id="rec-edit-title"'), pl = sheet.indexOf('id="rec-title"');
  if (!(pe > 0 && pe < ph && ph < pt && pt < pl)) miss.push('表單不在面板最上面');
  const head = ph > 0 && pt > ph ? sheet.slice(ph, pt) : '';
  if (!(head.indexOf('data-edit="save"') > 0 && head.indexOf('data-edit="cancel"') > 0)) miss.push('儲存／取消不在表單第一列');
  const foot = sheet.slice(sheet.indexOf('class="modal-footer"'));
  if (!(/class="btn-flat rec-edit-only"[^>]*data-edit="cancel"/.test(foot) && /class="btn-flat rec-edit-only rec-edit-ok"[^>]*data-edit="save"/.test(foot))) miss.push('底列沒有編輯用的 取消／儲存');
  const ta = (sheet.match(/<textarea id="rec-edit-input"[^>]*>/) || [''])[0];
  const lack = ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"'].filter((a) => ta.indexOf(a) < 0);
  if (lack.length) miss.push('記法欄少了 ' + lack.join(' '));
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㊴ 來源欄〔owner 2026-10-13：「增加一個 field，用 textarea 紀錄資料的來源」〕。
//    (a) 每一筆各自一份 `source`（多行的自由文字、可以是空的）；JSON 輸出帶這一欄；舊紀錄沒有這一欄＝空字串，不是壞資料
//    (b) 面板上標題欄底下有一格〔owner 選的〕：加入／取代時帶入它現在的值；載回某一筆時跟著那一筆回來
//    (c) 存法照標題欄：自己一格、只在自己被改時寫（碰不到清單——那一半在儲存區那一條）；清除來源不動標題、不動清單
//    (d) 編輯表單裡也有一格；沒給來源（undefined）＝沿用原來的，給了空字串才是清掉
//    (e) 手機：清除鈕擋 mousedown、不包在 label 裡；兩格 textarea 字級走 --ctl-font、不自動大寫／校正；面板內 標題 → 來源 → 清單
check('㊴ 來源欄：每一筆各自一份、加入時帶入、自己一格存', (w) => {
  const L = w.Lib, miss = [];
  if (typeof L.normalizeSource !== 'function') return 'FAIL: lib 沒有 normalizeSource';
  const dflt = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  if (L.normalizeSource('  大正藏 T20\r\n  p.107a\r\n') !== '大正藏 T20\n  p.107a' || L.normalizeSource(null) !== '' || L.normalizeSource(7) !== '' || L.normalizeSource(undefined) !== '') miss.push('normalizeSource');
  const r1 = L.makeRecord('t', 'na mo', dflt, 'S', 'r1', 5, ' T20 No.1060 \n');
  if (!r1 || r1.source !== 'T20 No.1060') miss.push('makeRecord 沒帶來源：' + JSON.stringify(r1 && r1.source));
  const r0 = L.makeRecord('t', 'na mo', dflt, 'S', 'r0', 4);
  if (!r0 || r0.source !== '') miss.push('沒給來源時不是空字串');
  if (L.makeRecord('t', '  ', dflt, 'S', 'rx', 1, '有來源') !== null) miss.push('只有來源、沒有記法也記成一筆');
  const exp = L.buildExport([r1, { title: 'old', input: 'a', options: dflt, savedAt: 'S' }], () => ({ siddham: 's', tibetan: 't', latin: 'l', ascii: 'a', codepoints: 'c' }), 'T');
  if (exp.records[0].source !== 'T20 No.1060') miss.push('JSON 輸出沒帶來源');
  if (exp.records[1].source !== '') miss.push('舊紀錄（沒有這一欄）輸出的來源不是空字串：' + JSON.stringify(exp.records[1].source));
  // 編輯：沒給＝沿用；給空字串＝清掉；只改來源也是更動
  const e0 = L.editRecord(r1, 't', 'na mo', dflt, 'NEW');
  if (e0 !== r1) miss.push('沒給來源時被當成更動（應沿用原來的）');
  const e1 = L.editRecord(r1, 't', 'na mo', dflt, 'NEW', 'T20 No.1060\np.107a');
  if (!e1 || e1 === r1 || e1.source !== 'T20 No.1060\np.107a' || e1.id !== 'r1' || e1.order !== 5) miss.push('只改來源不算更動，或身分變了');
  const e2 = L.editRecord(r1, 't', 'na mo', dflt, 'NEW', '');
  if (!e2 || e2 === r1 || e2.source !== '') miss.push('清掉來源不算更動');
  if (L.editRecord(r1, 't', 'na mo', dflt, 'NEW', '  T20 No.1060 ') !== r1) miss.push('只差頭尾空白也被當成更動');
  if (L.editRecord(r0, 't', 'na mo', dflt, 'NEW', '') !== r0) miss.push('空的改成空的被當成更動');

  // 控制器：加入／取代帶入面板上那一格；載回跟著那一筆；自己一格
  if (!/keep \? keep\.id : newId\(\), keep \? keep\.order : 0, \$recSource\.value, /.test(fnBody(w.js, 'currentRecord'))) miss.push('加入時沒有帶入來源欄的值');
  const act = fnBody(w.js, 'recAction');
  if (!/\$recSource\.value = it\.source;[^\n]*\n\s*state\.rec\.source = it\.source;/.test(act)) miss.push('載回某一筆時來源沒有跟著回來');
  const k = ['REC_KEY', 'REC_TITLE_KEY', 'REC_SOURCE_KEY'].map((n) => (w.js.match(new RegExp("var " + n + " = '([^']+)'")) || [])[1]);
  if (k.some((x) => !x) || new Set(k).size !== 3) miss.push('清單／標題／來源不是三格分開存（' + k.join('／') + '）');
  const cs = fnBody(w.js, 'clearSource'), ss = fnBody(w.js, 'saveSource');
  if (!cs || !ss) return 'FAIL: 找不到 clearSource／saveSource' + (miss.length ? '；' + miss.join('、') : '');
  if (/\$recTitle\b|state\.rec\.title|saveTitle|pushTitle|state\.rec\.items/.test(cs)) miss.push('清除來源動到了標題或清單');
  if (!/localStorage\.setItem\(REC_SOURCE_KEY, state\.rec\.source\)/.test(ss)) miss.push('saveSource 寫的不是來源那一格');
  if (!/Lib\.editRecord\(state\.edit\.orig, \$editTitle\.value, \$editInput\.value, readEditOptions\(\), savedAt, \$editSource\.value, /.test(w.js)) miss.push('編輯表單沒有把來源交給 editRecord');
  if (!/\$editSource\.value = it\.source;/.test(fnBody(w.js, 'startEdit'))) miss.push('開始編輯時沒有帶出那一筆的來源');
  if (!/if \(r\.source\) main\.appendChild\(node\('span', 'rec-src'/.test(w.js)) miss.push('清單上看不到來源');
  if (!/setSource\(state\.rec\.source\)/.test(fnBody(w.js, 'pushSource'))) miss.push('來源欄的值沒有同步');
  if (!/sourceClear\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js)) miss.push('來源的清除鈕沒擋 mousedown');

  // 畫面
  const sheet = (w.html.match(/<div id="records-modal"[\s\S]*?\n  <\/div>\n/) || [''])[0];
  const t = sheet.indexOf('id="rec-title"'), so = sheet.indexOf('id="rec-source"'), l = sheet.indexOf('id="rec-list"');
  if (!(t > 0 && t < so && so < l)) miss.push('面板內的順序不是 標題 → 來源 → 清單');
  const ci = sheet.indexOf('id="rec-source-clear"');
  if (ci < 0) miss.push('來源欄旁沒有清除鈕');
  else if (sheet.lastIndexOf('<label', ci) > sheet.lastIndexOf('</label>', ci)) miss.push('來源的清除鈕包在 <label> 裡');
  for (const id of ['rec-source', 'rec-edit-source']) {
    const ta = (sheet.match(new RegExp('<textarea id="' + id + '"[^>]*>')) || [''])[0];
    if (!ta) { miss.push('找不到 #' + id); continue; }
    const lack = ['class="rec-source-input"', 'autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"'].filter((a) => ta.indexOf(a) < 0);
    if (lack.length) miss.push('#' + id + ' 少了 ' + lack.join(' '));
  }
  const es = sheet.indexOf('id="rec-edit-source"'), ee = sheet.indexOf('id="rec-edit"'), tt = sheet.indexOf('id="rec-title"');
  if (!(ee > 0 && ee < es && es < tt)) miss.push('編輯表單裡沒有來源欄');
  if (!/textarea\.rec-source-input\s*\{[^}]*font-size:\s*var\(--ctl-font\)/.test(w.css)) miss.push('來源欄沒用 --ctl-font');
  if (!/textarea\.rec-source-input\s*\{[^}]*min-height:\s*46px/.test(w.css)) miss.push('來源欄沒有 min-height（面板沒開時量到 0 會塌掉）');
  return miss.length ? 'FAIL: ' + miss.join('、') : true;
});

// ㊵ 類型欄〔owner 2026-10-13：「再增加一個 field，用來紀錄資料的類型，例如：真言 / 種子字 / ...」〕。
//    (a) 每一筆各自一份 `type`：**自由文字**〔owner 選的；另一案是固定選單〕、單行、可以是空的；JSON 輸出帶這一欄；舊紀錄＝空字串
//    (b) 快選鈕上的詞＝預設的（真言、種子字）在前 ＋ 清單裡用過的（依第一次出現的順序），不重複、不含空的——期望值寫死在這裡
//    (c) 面板上標題欄底下有一格：加入／取代時帶入；載回時跟著那一筆回來；自己一格存（碰不到清單——那一半在儲存區那一條）
//    (d) 編輯表單裡也有一格＋一排快選鈕；那一排只動表單，不可以去改面板上那一格（那會在按儲存之前就把面板的值換掉）
//    (e) 手機：快選鈕與清除鈕擋 mousedown；清除鈕不包在 label 裡；面板內 標題 → 類型 → 來源 → 清單
check('㊵ 類型欄：自由文字＋快選鈕、加入時帶入、自己一格存', (w) => {
  const L = w.Lib, miss = [];
  if (typeof L.normalizeType !== 'function' || typeof L.typeChoices !== 'function') return 'FAIL: lib 沒有 normalizeType／typeChoices';
  const dflt = { inputMethod: 'ISO15919', transliteration: 'IAST', ignoreSpacesAndHyphens: true };
  if (L.normalizeType('  種子 \n 字 ') !== '種子 字' || L.normalizeType(null) !== '' || L.normalizeType(3) !== '') miss.push('normalizeType');
  const used = [{ type: '陀羅尼' }, { type: ' 真言 ' }, { type: '' }, { type: '種子字' }, null, { type: '陀羅尼' }, { type: '心咒' }, {}];
  const snap = JSON.stringify(used);
  const ch = L.typeChoices(used).join('|');
  if (ch !== '真言|種子字|陀羅尼|心咒') miss.push('快選鈕的詞 = ' + ch + '（應為 真言|種子字|陀羅尼|心咒）');
  if (L.typeChoices(null).join('|') !== '真言|種子字' || L.typeChoices([]).join('|') !== '真言|種子字') miss.push('清單是空的時候不是只有預設的兩個');
  if (JSON.stringify(used) !== snap) miss.push('typeChoices 改了傳進來的清單');
  const r1 = L.makeRecord('t', 'hrii.h', dflt, 'S', 'r1', 5, 'T18', '  種子字 ');
  if (!r1 || r1.type !== '種子字' || r1.source !== 'T18') miss.push('makeRecord 沒帶類型：' + JSON.stringify(r1 && [r1.type, r1.source]));
  const r0 = L.makeRecord('t', 'hrii.h', dflt, 'S', 'r0', 4);
  if (!r0 || r0.type !== '') miss.push('沒給類型時不是空字串');
  const exp = L.buildExport([r1, { title: 'old', input: 'a', options: dflt, savedAt: 'S' }], () => ({ siddham: 's', tibetan: 't', latin: 'l', ascii: 'a', codepoints: 'c' }), 'T');
  if (exp.records[0].type !== '種子字') miss.push('JSON 輸出沒帶類型');
  if (exp.records[1].type !== '') miss.push('舊紀錄（沒有這一欄）輸出的類型不是空字串：' + JSON.stringify(exp.records[1].type));
  if (L.editRecord(r1, 't', 'hrii.h', dflt, 'NEW') !== r1) miss.push('沒給類型時被當成更動（應沿用原來的）');
  const e1 = L.editRecord(r1, 't', 'hrii.h', dflt, 'NEW', undefined, '真言');
  if (!e1 || e1 === r1 || e1.type !== '真言' || e1.source !== 'T18' || e1.id !== 'r1' || e1.order !== 5) miss.push('只改類型不算更動，或來源／身分跟著變了');
  const e2 = L.editRecord(r1, 't', 'hrii.h', dflt, 'NEW', undefined, '');
  if (!e2 || e2 === r1 || e2.type !== '') miss.push('清掉類型不算更動');
  if (L.editRecord(r1, 't', 'hrii.h', dflt, 'NEW', 'T18', ' 種子字  ') !== r1) miss.push('只差頭尾空白也被當成更動');

  // 控制器
  if (!/keep \? keep\.order : 0, \$recSource\.value, \$recType\.value\);/.test(fnBody(w.js, 'currentRecord'))) miss.push('加入時沒有帶入類型欄的值');
  if (!/\$recType\.value = it\.type;[^\n]*\n\s*state\.rec\.type = it\.type;/.test(fnBody(w.js, 'recAction'))) miss.push('載回某一筆時類型沒有跟著回來');
  const k = ['REC_KEY', 'REC_TITLE_KEY', 'REC_SOURCE_KEY', 'REC_TYPE_KEY'].map((n) => (w.js.match(new RegExp("var " + n + " = '([^']+)'")) || [])[1]);
  if (k.some((x) => !x) || new Set(k).size !== 4) miss.push('清單／標題／來源／類型不是四格分開存（' + k.join('／') + '）');
  const sp = fnBody(w.js, 'setPanelType'), ct = fnBody(w.js, 'clearType'), st = fnBody(w.js, 'saveType'), rc = fnBody(w.js, 'renderTypeChips');
  if (!sp || !ct || !st || !rc) return 'FAIL: 找不到 setPanelType／clearType／saveType／renderTypeChips' + (miss.length ? '；' + miss.join('、') : '');
  if (/\$recTitle\b|\$recSource\b|state\.rec\.(title|source|items)|saveTitle|saveSource/.test(sp + ct)) miss.push('改類型欄動到了標題、來源或清單');
  if (!/localStorage\.setItem\(REC_TYPE_KEY, state\.rec\.type\)/.test(st)) miss.push('saveType 寫的不是類型那一格');
  if (!/Lib\.typeChoices\(state\.rec\.items\)/.test(rc)) miss.push('快選鈕的詞不是由 lib 給的');
  if (!/readEditOptions\(\), savedAt, \$editSource\.value, \$editType\.value\)/.test(w.js)) miss.push('編輯表單沒有把類型交給 editRecord');
  if (!/\$editType\.value = it\.type;/.test(fnBody(w.js, 'startEdit'))) miss.push('開始編輯時沒有帶出那一筆的類型');
  if (!/if \(r\.type\) head\.appendChild\(node\('span', 'rec-type', r\.type\)\);/.test(w.js)) miss.push('清單上看不到類型');
  if (!/setType\(state\.rec\.type\)/.test(fnBody(w.js, 'pushType'))) miss.push('類型欄的值沒有同步');
  if (!/addEventListener\('mousedown', function \(e\) \{\s*if \(e\.target\.closest\('\.rec-chip'\)\) e\.preventDefault\(\);/.test(w.js)) miss.push('快選鈕沒擋 mousedown');
  if (!/typeClear\.addEventListener\('mousedown',[^\n]*preventDefault\(\)/.test(w.js)) miss.push('類型的清除鈕沒擋 mousedown');
  if (!/=== 'rec-edit-type'\) \{ \$editType\.value = v; renderTypeChips\(\); \}\s*else \{ \$recType\.value = v; setPanelType\(v\); \}/.test(w.js)) miss.push('編輯表單的快選鈕不是只動表單那一格');

  // 畫面
  const sheet = (w.html.match(/<div id="records-modal"[\s\S]*?\n  <\/div>\n/) || [''])[0];
  const t = sheet.indexOf('id="rec-title"'), ty = sheet.indexOf('id="rec-type"'), so = sheet.indexOf('id="rec-source"'), l = sheet.indexOf('id="rec-list"');
  if (!(t > 0 && t < ty && ty < so && so < l)) miss.push('面板內的順序不是 標題 → 類型 → 來源 → 清單');
  const ci = sheet.indexOf('id="rec-type-clear"');
  if (ci < 0) miss.push('類型欄旁沒有清除鈕');
  else if (sheet.lastIndexOf('<label', ci) > sheet.lastIndexOf('</label>', ci)) miss.push('類型的清除鈕包在 <label> 裡');
  for (const id of ['rec-type', 'rec-edit-type']) {
    const tag = (sheet.match(new RegExp('<input type="text" id="' + id + '"[^>]*>')) || [''])[0];
    if (!tag) { miss.push('找不到 #' + id); continue; }
    const lack = ['class="rec-title"', 'autocorrect="off"', 'spellcheck="false"'].filter((a) => tag.indexOf(a) < 0);
    if (lack.length) miss.push('#' + id + ' 少了 ' + lack.join(' ') + '（rec-title＝字級走 --ctl-font）');
    if (sheet.indexOf('<div class="rec-chips" data-for="' + id + '"></div>') < sheet.indexOf('id="' + id + '"')) miss.push('#' + id + ' 底下沒有快選鈕那一排');
  }
  const ee = sheet.indexOf('id="rec-edit"'), et = sheet.indexOf('id="rec-edit-type"');
  if (!(ee > 0 && ee < et && et < t)) miss.push('編輯表單裡沒有類型欄');
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
  ['㉔', '母音排到體文後面', (w) => { w.Lib.KEYSET_IDS.splice(0, 4, 'variant', 'ligature', 'bindu', 'vowel'); }],
  ['㉔', '異體字組少一格', (w) => { const c = w.catalog.categories.find((x) => x.id === 'variant'); c.entries = c.entries.filter((e) => e.code !== '_ii'); }],
  ['②', '__u 不再轉出 𑗛（轉換層副作用消失）', (w) => { const c = w.catalog.categories.find((x) => x.id === 'variant'); c.entries.find((e) => e.code === '__u').code = '_u'; }],
  ['⑭', '少了 keyset.vowel 的文案', (w) => { delete w.locales['zh-Hant']['keyset.vowel']; delete w.locales.en['keyset.vowel']; delete w.locales.ja['keyset.vowel']; }],
  ['㉔', '上接續被去重（少了同記法的異體）', (w) => { const f = w.Lib.keysFor; w.Lib.keysFor = (c, e, id) => { const ks = f(c, e, id); const seen = {}; return id === 'ligature_u' ? ks.filter((k) => !seen[k.ins] && (seen[k.ins] = 1)) : ks; }; }],
  ['㉔', '接續排回體文後面（2026-10-11 之前的順序）', (w) => { w.Lib.KEYSET_IDS.splice(0, 7, 'vowel', 'variant', 'bindu', 'ligature_u', 'ligature_l', 'ligature', 'symbol'); }],
  ['㉔', '接續與體文對調之外，上下接續也排到體文前面', (w) => { w.Lib.KEYSET_IDS.splice(0, 7, 'vowel', 'variant', 'ligature', 'ligature_u', 'ligature_l', 'bindu', 'symbol'); }],
  ['㉔', '符號組被拿掉', (w) => { w.Lib.KEYSET_IDS.pop(); }],
  ['㉔', '符號組少了句讀', (w) => { const c = w.catalog.categories.find((x) => x.id === 'symbol'); c.entries = c.entries.filter((e) => e.code !== '||'); const f = w.Lib.keysFromCatalog; w.Lib.keysFromCatalog = (cat, id) => f(cat, id); }],
  ['②', '符號的字形錯一格', (w) => { w.catalog.categories.find((c) => c.id === 'symbol').entries.find((e) => e.code === '|').char = '𑗉'; }],
  ['㊲', '符號組多一格字型沒有的字', (w) => { w.catalog.categories.find((c) => c.id === 'symbol').entries.push({ code: 'zz', char: '\u{11600}', group: 'siddham' }); }],
  ['㊲', '字型換成一支沒有悉曇的', (w) => { w.font = Buffer.from(w.font); w.font.fill(0, 48, 60); }],
  ['⑭', '少了 keyset.symbol 的文案', (w) => { delete w.locales['zh-Hant']['keyset.symbol']; delete w.locales.en['keyset.symbol']; delete w.locales.ja['keyset.symbol']; }],
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
  ['㉜', '標題欄有焦點時也更新鍵盤基準', (w) => { w.js = w.js.replace(' && !typingInSheet()) state.baseline', ') state.baseline'); }],
  ['㉜', '編輯表單的記法欄有焦點時也更新鍵盤基準', (w) => { w.js = w.js.replace(' || a === $editInput;', ';'); }],
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
  ['㊱', '空的清單也寫一份（七天後把有內容的擠掉）', (w) => { w.backup = w.backup.replace('if [ "$FOUND" = "0" ]; then', 'if [ "$FOUND" = "never" ]; then'); }],
  ['㊱', '不對帳檔數', (w) => { w.backup = w.backup.replace('if [ "$FOUND" != "$EXPECT" ]; then', 'if [ "$FOUND" = "never" ]; then'); }],
  ['㊱', '驗證沒過照樣寫出', (w) => { w.backup = w.backup.replace('if (items.length !== raw.length) throw', 'if (false) throw'); }],
  ['㊱', '內容相同也另存一份', (w) => { w.backup = w.backup.replace('same = !bits.length;', 'same = false;'); }],
  ['㊱', '用完不清取回來的檔', (w) => { w.backup = w.backup.replace(/\ncleanup_pull\n\n# ─+ ④/, '\n\n# ④'); }],
  ['⑭', '紀錄的 toast 用了未定義的 key', (w) => { w.js = w.js.replace("recToast('rec.toast.replaced'", "recToast('rec.toast.replacedX'"); }],
  ['㉞', '編輯存回之前不看儲存區', (w) => { w.js = w.js.replace("    // 清單在別的畫面被改過 ⇒ 先換成最新的，這一下不執行（表單與裡面打的字都留著）\n    if (syncItems() === 'changed') {", "    if (false) {"); }],
  ['㊳', '沒有更動也回一筆新的（白寫一次）', (w) => { const mk = w.Lib.makeRecord; w.Lib.editRecord = (o, t, i, op, s) => (o ? mk(t, i, op, s, o.id, o.order) : null); }],
  ['㊳', '編輯後換了一個 id（變成另一筆）', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, ...a) => { const r = f(o, ...a); return r && r !== o ? Object.assign({}, r, { id: 'rnew' }) : r; }; }],
  ['㊳', '編輯後被排到最後（order 換新）', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, ...a) => { const r = f(o, ...a); return r && r !== o ? Object.assign({}, r, { order: 999999 }) : r; }; }],
  ['㊳', '記法清空也存回去', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s) => f(o, t, i, op, s) || (o ? Object.assign({}, o, { input: '', savedAt: s }) : null); }],
  ['㊳', '只改選項被當成沒有更動', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s) => { const r = f(o, t, i, op, s); return r && o && r.title === o.title && r.input === o.input ? o : r; }; }],
  ['㊳', 'editRecord 就地改原來那一筆', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s) => { const r = f(o, t, i, op, s); if (r && r !== o) { Object.assign(o, r); return Object.assign({}, r); } return r; }; }],
  ['㊳', '存回時認序號不認 id', (w) => { w.js = w.js.replace("    var i = Lib.indexOfId(state.rec.items, ed.id);\n    // 那一筆已經在別處被刪掉", "    var i = ed.index;\n    // 那一筆已經在別處被刪掉"); }],
  ['㊳', '那一筆在別處被刪了照樣存回去', (w) => { w.js = w.js.replace("    if (i < 0) { recToast('rec.toast.editGone', null, 'orange', 6000); return; }", "    if (i < 0) i = state.rec.items.length;"); }],
  ['㊳', '存回時順手改了標題欄', (w) => { w.js = w.js.replace("    saveItems();\n    pushPut(rec);\n    endEdit();", "    state.rec.title = rec.title;\n    saveItems();\n    saveTitle();\n    pushPut(rec);\n    endEdit();"); }],
  ['㊳', '開始編輯時把那一筆載進主輸入框', (w) => { w.js = w.js.replace("    $editInput.value = it.input;\n", "    $editInput.value = it.input;\n    $input.value = it.input;\n"); }],
  ['㊳', '沒有更動也寫入', (w) => { w.js = w.js.replace("    if (rec === ed.orig) {   // 沒有更動", "    if (false) {   // 沒有更動"); }],
  ['㊳', '編輯中點面板外面會關掉', (w) => { w.js = w.js.replace("M.Modal.getInstance($recModal).options.dismissible = false;", "M.Modal.getInstance($recModal).options.dismissible = true;"); }],
  ['㊳', '有還沒存的更動也直接取消', (w) => { w.js = w.js.replace("if (editDraft('') !== ed.orig && !isArmed('editCancel', i)) {", "if (false) {"); }],
  ['㊳', '面板關掉後仍停在編輯', (w) => { w.js = w.js.replace("$recTitle.blur(); endEdit(); disarm();", "$recTitle.blur(); disarm();"); }],
  ['㊳', '編輯中「完成」仍看得到', (w) => { w.css = w.css.replace(".records-sheet.is-editing .modal-footer > :not(.rec-edit-only) { display: none; }\n", ""); }],
  ['㊳', '表單排到 JSON 的位置（面板底部）', (w) => { w.html = w.html.replace('id="rec-edit"', 'id="__e__"').replace('id="rec-json"', 'id="rec-edit"').replace('id="__e__"', 'id="rec-json"'); }],
  ['㊳', '儲存／取消只剩底列那一對', (w) => { w.html = w.html.replace(/          <span class="rec-edit-acts">[\s\S]*?<\/span>\n/, ''); }],
  ['㊳', '記法欄開著自動校正', (w) => { w.html = w.html.replace(/(<textarea id="rec-edit-input"[^>]*?)autocorrect="off" /, '$1'); }],
  ['㊳', '記法欄字級寫死 16px', (w) => { w.css = w.css.replace(/(textarea\.rec-edit-input\s*\{[^}]*font-size:\s*)var\(--ctl-font\)/, '$116px'); }],
  ['㊳', '清單上沒有編輯鈕', (w) => { w.js = w.js.replace("      li.appendChild(recButton('edit', i, 'edit', 'rec.edit', false));\n", ''); }],
  ['⑭', '編輯的文案少一語', (w) => { delete w.locales.ja['rec.toast.confirmDiscard']; }],
  ['㊴', '來源被丟掉（makeRecord 不收）', (w) => { const f = w.Lib.makeRecord; w.Lib.makeRecord = (t, i, o, s, id, ord) => f(t, i, o, s, id, ord); }],
  ['㊴', '來源的換行被壓成一行', (w) => { const f = w.Lib.normalizeSource; w.Lib.normalizeSource = (s) => f(s).replace(/\s+/g, ' '); }],
  ['㊴', 'JSON 輸出不帶來源', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (...a) => { const e = f(...a); e.records.forEach((r) => { delete r.source; }); return e; }; }],
  ['㊴', '舊紀錄的來源輸出成 undefined', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (items, c, t) => { const e = f(items, c, t); e.records.forEach((r, i) => { r.source = items[i].source; }); return e; }; }],
  ['㊴', '編輯時沒給來源就清掉它', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s, src) => f(o, t, i, op, s, src === undefined ? '' : src); }],
  ['㊴', '只改來源被當成沒有更動', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s, src) => { const r = f(o, t, i, op, s, src); return r && o && r !== o && r.title === o.title && r.input === o.input && JSON.stringify(r.options) === JSON.stringify(o.options) ? o : r; }; }],
  ['㊴', '加入時不帶來源欄的值', (w) => { w.js = w.js.replace('keep ? keep.order : 0, $recSource.value, ', 'keep ? keep.order : 0, undefined, '); }],
  ['㊴', '載回時來源沒有跟著回來', (w) => { w.js = w.js.replace("      $recSource.value = it.source;   // 來源跟著那一筆回來（之後按取代，來源才不會被面板上別的值換掉）\n      state.rec.source = it.source;\n", ''); }],
  ['㊴', '來源與標題存在同一格', (w) => { w.js = w.js.replace("-rec-source';   // 來源欄現在的值", "-rec-title';   // 來源欄現在的值"); }],
  ['㊴', '清除來源順手清了標題', (w) => { w.js = w.js.replace("    state.rec.source = '';\n    grow($recSource);", "    state.rec.source = '';\n    state.rec.title = '';\n    grow($recSource);"); }],
  ['㊴', '編輯表單不把來源交出去', (w) => { w.js = w.js.replace('readEditOptions(), savedAt, $editSource.value, ', 'readEditOptions(), savedAt, undefined, '); }],
  ['㊴', '開始編輯時來源欄留著上一筆的', (w) => { w.js = w.js.replace("    $editSource.value = it.source;\n", ''); }],
  ['㊴', '清單上不顯示來源', (w) => { w.js = w.js.replace("      if (r.source) main.appendChild(node('span', 'rec-src'", "      if (false) main.appendChild(node('span', 'rec-src'"); }],
  ['㊴', '來源的清除鈕不擋 mousedown', (w) => { w.js = w.js.replace("sourceClear.addEventListener('mousedown'", "sourceClear.addEventListener('pointerup'"); }],
  ['㊴', '來源欄排到清單下面', (w) => { w.html = w.html.replace('id="rec-source"', 'id="__s__"').replace('id="rec-json"', 'id="rec-source"').replace('id="__s__"', 'id="rec-json"'); }],
  ['㊴', '來源的清除鈕包進 <label>', (w) => { w.html = w.html.replace('<div class="rec-title-row rec-source-row">', '<label class="rec-title-row rec-source-row">').replace(/(id="rec-source-clear"[\s\S]*?<\/a>\n\s*)<\/div>/, '$1</label>'); }],
  ['㊴', '來源欄開著自動校正', (w) => { w.html = w.html.replace(/(<textarea id="rec-source"[\s\S]*?)autocorrect="off" /, '$1'); }],
  ['㊴', '來源欄字級寫死 16px', (w) => { w.css = w.css.replace(/(textarea\.rec-source-input\s*\{[^}]*font-size:\s*)var\(--ctl-font\)/, '$116px'); }],
  ['㊴', '編輯表單沒有來源欄', (w) => { w.html = w.html.replace(/        <div class="opt-field">\n          <label class="opt-label" for="rec-edit-source"[\s\S]*?<\/div>\n/, ''); }],
  ['㉞', '打來源時整份清單重寫', (w) => { w.js = w.js.replace("      grow($recSource);\n      saveSourceSoon();", "      grow($recSource);\n      saveItems();\n      saveSourceSoon();"); }],
  ['㉞', '清除來源又去寫清單', (w) => { w.js = w.js.replace("    grow($recSource);\n    saveSource();\n    pushSource();\n    setIconDone(trigger);", "    grow($recSource);\n    saveItems();\n    saveSource();\n    pushSource();\n    setIconDone(trigger);"); }],
  ['㉟', '同步寫入時漏了來源', (w) => { w.remote = w.remote.replace("source: rec.source || '', input:", 'input:'); }],
  ['㉟', '同步讀回時漏了來源', (w) => { w.remote = w.remote.replace('source: x.source, input:', 'input:'); }],
  ['㊱', '備份不比來源（只改來源被當成沒變）', (w) => { w.backup = w.backup.replace('r.source || "", r.input, r.options, r.order])', 'r.input, r.options, r.order])'); }],
  ['㉜', '來源欄有焦點時也更新鍵盤基準', (w) => { w.js = w.js.replace(' || a === $recSource', ''); }],
  ['㉛', '讀回的來源不驗證（不是字串也收）', (w) => { const f = w.Lib.normalizeStore; w.Lib.normalizeStore = (s) => { const o = f(s); ((s && s.items) || []).forEach((r, i) => { if (o.items[i] && r && 'source' in r) o.items[i].source = r.source; }); return o; }; }],
  ['⑭', '來源的文案少一語', (w) => { delete w.locales.en['rec.sourceLine']; }],
  ['㊵', '類型被丟掉（makeRecord 不收）', (w) => { const f = w.Lib.makeRecord; w.Lib.makeRecord = (t, i, o, s, id, ord, src) => f(t, i, o, s, id, ord, src); }],
  ['㊵', '用過的類型排到預設的前面', (w) => { const f = w.Lib.typeChoices; w.Lib.typeChoices = (items) => { const a = f(items); return a.slice(2).concat(a.slice(0, 2)); }; }],
  ['㊵', '快選鈕的詞重複', (w) => { w.Lib.typeChoices = (items) => ['真言', '種子字'].concat((items || []).filter(Boolean).map((x) => w.Lib.normalizeType(x.type)).filter(Boolean)); }],
  ['㊵', '預設的詞少一個', (w) => { const f = w.Lib.typeChoices; w.Lib.typeChoices = (items) => f(items).filter((t) => t !== '種子字'); }],
  ['㊵', '類型留著換行（不是單行）', (w) => { w.Lib.normalizeType = (t) => (typeof t === 'string' ? t.trim() : ''); }],
  ['㊵', 'JSON 輸出不帶類型', (w) => { const f = w.Lib.buildExport; w.Lib.buildExport = (...a) => { const e = f(...a); e.records.forEach((r) => { delete r.type; }); return e; }; }],
  ['㊵', '編輯時沒給類型就清掉它', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s, src, ty) => f(o, t, i, op, s, src, ty === undefined ? '' : ty); }],
  ['㊵', '只改類型被當成沒有更動', (w) => { const f = w.Lib.editRecord; w.Lib.editRecord = (o, t, i, op, s, src, ty) => { const r = f(o, t, i, op, s, src, ty); return r && o && r !== o && r.title === o.title && r.input === o.input && r.source === o.source && JSON.stringify(r.options) === JSON.stringify(o.options) ? o : r; }; }],
  ['㊵', '加入時不帶類型欄的值', (w) => { w.js = w.js.replace('$recSource.value, $recType.value);', '$recSource.value);'); }],
  ['㊵', '載回時類型沒有跟著回來', (w) => { w.js = w.js.replace("      $recType.value = it.type;       // 類型同上\n      state.rec.type = it.type;\n", ''); }],
  ['㊵', '類型與來源存在同一格', (w) => { w.js = w.js.replace("-rec-type';   // 類型欄現在的值", "-rec-source';   // 類型欄現在的值"); }],
  ['㊵', '編輯表單的快選鈕改到面板上那一格', (w) => { w.js = w.js.replace("{ $editType.value = v; renderTypeChips(); }", "{ $recType.value = v; setPanelType(v); }"); }],
  ['㊵', '快選鈕不擋 mousedown', (w) => { w.js = w.js.replace("      if (e.target.closest('.rec-chip')) e.preventDefault();\n", ''); }],
  ['㊵', '編輯表單不把類型交出去', (w) => { w.js = w.js.replace('savedAt, $editSource.value, $editType.value);', 'savedAt, $editSource.value);'); }],
  ['㊵', '開始編輯時類型欄留著上一筆的', (w) => { w.js = w.js.replace("    $editType.value = it.type;\n", ''); }],
  ['㊵', '清單上不顯示類型', (w) => { w.js = w.js.replace("      if (r.type) head.appendChild(node('span', 'rec-type', r.type));\n", ''); }],
  ['㊵', '快選鈕的詞寫死在控制器', (w) => { w.js = w.js.replace('var choices = Lib.typeChoices(state.rec.items);', "var choices = ['真言', '種子字'];"); }],
  ['㊵', '類型欄排到來源下面', (w) => { w.html = w.html.replace('id="rec-type"', 'id="__t__"').replace('id="rec-source"', 'id="rec-type"').replace('id="__t__"', 'id="rec-source"'); }],
  ['㊵', '類型的清除鈕包進 <label>', (w) => { w.html = w.html.replace('<div class="rec-title-row rec-type-row">', '<label class="rec-title-row rec-type-row">').replace(/(id="rec-type-clear"[\s\S]*?<\/a>\n\s*)<\/div>/, '$1</label>'); }],
  ['㊵', '面板上沒有快選鈕那一排', (w) => { w.html = w.html.replace('        <div class="rec-chips" data-for="rec-type"></div>\n', ''); }],
  ['㊵', '編輯表單沒有類型欄', (w) => { w.html = w.html.replace(/        <div class="opt-field">\n          <label class="opt-label" for="rec-edit-type"[\s\S]*?<\/div>\n        <\/div>\n/, ''); }],
  ['㊵', '類型欄不走 --ctl-font（拿掉 rec-title）', (w) => { w.html = w.html.replace('<input type="text" id="rec-edit-type" class="rec-title"', '<input type="text" id="rec-edit-type" class="rec-type-input"'); }],
  ['㉞', '點快選鈕時整份清單重寫', (w) => { w.js = w.js.replace("    state.rec.type = Lib.normalizeType(v);\n", "    state.rec.type = Lib.normalizeType(v);\n    saveItems();\n"); }],
  ['㉟', '同步寫入時漏了類型', (w) => { w.remote = w.remote.replace("type: rec.type || '', source:", 'source:'); }],
  ['㉟', '同步讀回時漏了類型', (w) => { w.remote = w.remote.replace('type: x.type, source:', 'source:'); }],
  ['㊱', '備份不比類型（只改類型被當成沒變）', (w) => { w.backup = w.backup.replace('[r.title, r.type || "", r.source', '[r.title, r.source'); }],
  ['㉜', '類型欄有焦點時也更新鍵盤基準', (w) => { w.js = w.js.replace(' || a === $recType', ''); }],
  ['㉛', '讀回的類型不驗證（不是字串也收）', (w) => { const f = w.Lib.normalizeStore; w.Lib.normalizeStore = (s) => { const o = f(s); ((s && s.items) || []).forEach((r, i) => { if (o.items[i] && r && 'type' in r) o.items[i].type = r.type; }); return o; }; }],
  ['⑭', '類型的文案少一語', (w) => { delete w.locales.ja['rec.typeLabel']; }]
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
