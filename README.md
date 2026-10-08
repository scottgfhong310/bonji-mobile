# bonji-mobile — Siddhaṁ Converter for Phones

[English](./README.md) ｜ [繁體中文](./README.zh-Hant.md) ｜ [日本語](./README.ja.md)

A phone-first WebApp that converts **ASCII / IAST romanization** into **Siddhaṁ (悉曇梵字) script** and its **Latin transliteration** as you type.
**The input sits on the keyboard and the output sits above it**, so you see the result while typing — no scrolling.

The mobile sibling of [bonji](https://github.com/scottgfhong310/bonji): same conversion core ([mandel59/bonji-input](https://github.com/mandel59/bonji-input), MIT, used only through the `SiddhamConverter` anti-corruption layer), with layout and features re-cut for phones.
Part of the **nodeapp WebApp family**: <https://github.com/scottgfhong310/nodeapp-webapp-family>.

## Features

- **One screen, no page scroll**: Siddhaṁ and transliteration each get a pane that scrolls on its own and follows the newest characters while you type at the end.
- **Follows the keyboard**: the screen shrinks to the top of the on-screen keyboard (`visualViewport` on iOS, `interactive-widget=resizes-content` on Android); the header folds away to give the output more room.
- **Key row (bindu ⇄ ligature)**: a button right of the input switches between **bindu** (`aa` `i` `;m` `.h` `~m` …) and **ligature** (`k` `kh` `.t` `;s` …) keys, each with its Siddhaṁ glyph; tapping a key keeps the keyboard open. Groups and glyphs come from bonji's `BonjiInput.xlsx`.
- **Options** (`tune`, top right): input method (ISO 15919 / Kyoto-Harvard), transliteration (ISO 15919 / IAST), ignore spaces & hyphens.
- Copy buttons on both outputs; example chips; input and options are kept as a draft in your browser only.
- Bundled **Noto Sans Siddham** (SIL OFL); three UI languages (`zh-Hant` / `en` / `ja`); light / dark themes.
- **No backend**: the server only serves static files. A [Claude Artifacts build](https://claude.ai/artifact/WcKaiazaQr5C21Ktnc34TG) (private) also exists.

What bonji has that this app leaves out, and why, is in [`DESIGN.md`](./DESIGN.md) §5.

## Run

```bash
npm install
npm start                 # → http://localhost:3000/apps/bonji-mobile/
npm run verify            # contract checks
```

## License

[MIT](LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310). Includes the **bonji-input** Siddhaṁ engine (MIT, © 2021 Ryusei Yamaguchi) and **Noto Sans Siddham** (SIL OFL 1.1, see `fonts/OFL.txt`).
