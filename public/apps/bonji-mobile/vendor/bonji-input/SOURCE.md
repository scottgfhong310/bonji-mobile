# Vendored: bonji-input Siddham engine

- Source:        https://github.com/mandel59/bonji-input
- Pinned commit: 0a7eadd75ee475902879245ace39379bca820d36
- Vendored on:   2026-06-12
- License:       MIT (see ./LICENSE)
- Files taken:
  - siddham.js            (from public/siddham.js, unmodified)

> Devanāgarī support is **not** vendored (INCLUDE_DEVANAGARI=false): this app
> only takes ASCII/IAST input, so `devanagari.js` / `devanagari-data.js` are
> intentionally absent and the engine performs **no runtime `fetch`**.

更新方式見本 app 倉庫的 MIGRATION-PLAN「附錄：日後更新引擎」（軟同步）。
本 app 其餘程式**只 import `../siddham-converter.js`**，不得直接 import 本目錄下的 `siddham.js`。
