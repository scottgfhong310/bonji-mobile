# bonji-mobile — Siddhaṁ Converter for Phones

[English](./README.md) ｜ [繁體中文](./README.zh-Hant.md) ｜ [日本語](./README.ja.md)

A phone-first WebApp that converts **ASCII / IAST romanization** into **Siddhaṁ (悉曇梵字) script** and its **Latin transliteration** as you type.
**The input sits on the keyboard and the output sits above it**, so you see the result while typing — no scrolling.

The mobile sibling of [bonji](https://github.com/scottgfhong310/bonji): same conversion core ([mandel59/bonji-input](https://github.com/mandel59/bonji-input), MIT, used only through the `SiddhamConverter` anti-corruption layer), with layout and features re-cut for phones.
Part of the **nodeapp WebApp family**: <https://github.com/scottgfhong310/nodeapp-webapp-family>.

## Features

- **One screen, no page scroll**: Siddhaṁ and transliteration sit **side by side (2:1 width)**, each scrolling on its own with text anchored at the bottom next to the input, following the newest characters while you type at the end.
- **Follows the keyboard**: the screen shrinks to the top of the on-screen keyboard (`visualViewport` on iOS, `interactive-widget=resizes-content` on Android); the header folds away to give the output more room.
- **Key row (vowel → variant → ligature → bindu → upper → lower → symbol)**: a button right of the input cycles through seven groups (upper/lower ligature keys draw CBETA glyphs, see *CBETA glyphs* below): **vowel** (`a` `aa` `i` … `a;m`), **variant** (`__i` 𑗘 `_i` 𑗙 `_ii` 𑗚 `__u` 𑗛), **bindu** (`aa` `i` `;m` `.h` `~m` …), **ligature** (`k` `kh` `.t` `;s` …) and **symbol** (`|` 𑗅 `||` 𑗉 `--` `*1` `o2` … punctuation, section and ornamental marks) keys, each with its Siddhaṁ glyph; tapping a key keeps the keyboard open. Groups and glyphs come from bonji's `BonjiInput.xlsx`.
- **Options** (`tune`, top right): input method (ISO 15919 / Kyoto-Harvard), transliteration (ISO 15919 / IAST), ignore spaces & hyphens.
- **Two spaces = one space** (with *ignore spaces* on): the Siddhaṁ output gets one ordinary space between those two characters; the Latin output keeps the two spaces as typed.
- **Three spaces = one full-width space**: type three consecutive spaces and the Siddhaṁ output gets one ideographic space (U+3000), whether or not "ignore spaces" is on. The Latin output keeps the three spaces as typed.
- **Records · JSON output** (`{}`, top right): save the current input as a record with a **title**, then output the whole list as JSON (copy or download). **Titles may be empty and may repeat** — record one mantra in several parts under the same title, and `part` in the output tells them apart. While typing, the add button under the Siddhaṁ column saves a record without closing the keyboard. Each record has three buttons — edit (✎), read in large type (👁, the full text at twice the size) and delete. Edit lets you change its title, type, notation, source / reference and options in place. Below the title there are a **type** field (one or more, like tags — separate with 、 or a comma; types you have used show up as chips: tap to add, tap again to remove) and a **source / reference** field (text number, page, URL…; may span lines): both are carried into every record you add, so one mantra recorded in several parts needs them only once. The list lives in your browser (not a backup); the Claude Artifacts build keeps it in the artifact’s database instead, so it survives closing and switching devices.
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

## JSON output

```jsonc
{
  "app": "bonji-mobile",
  "exportedAt": "2026-10-11T01:30:09.171Z",   // the moment you copy / download
  "count": 2,
  "records": [
    {
      "seq": 1,                // position in the whole list
      "part": 1,               // position among records with the same title
      "title": "大悲咒",        // may be empty, may repeat
      "type": ["真言", "種子字"],   // types: array of strings, one or more (free text: 真言 mantra / 種子字 seed syllable / …); [] when none
      "source": "Taishō T20 No. 1060",  // where this record comes from (free text, may span lines; empty string when not given)
      "options": { "inputMethod": "ISO15919", "transliteration": "IAST", "ignoreSpacesAndHyphens": true },
      "input": "na mo ra tna tra yaa ya",      // verbatim, exactly as typed
      "output": {              // computed at export time; null plus an "error" key if conversion throws
        "siddham": "𑖡𑖦𑖺𑖨𑖝𑖿𑖡𑖝𑖿𑖨𑖧𑖯𑖧",
        "latin": "na mo ra tna tra yā ya",
        "ascii": "na mo ra tna tra yaa ya",    // normalised ASCII notation
        "codepoints": "U+115A1 U+115A6 …"
      },
      "savedAt": "2026-10-11T01:00:00.000Z"    // when this record was saved (or last edited)
    },
    { "seq": 2, "part": 2, "title": "大悲咒", "…": "…" }
  ]
}
```

Unlike bonji's export file: one file is **the whole list**, not a single record; `input` is verbatim and the normalised form is in `output.ascii`; there is no `sourceFile` / `composition`.

## CBETA glyphs

The upper/lower ligature keys draw glyphs from the CBETA Siddham font (`Siddam`), extracted to SVG by `scripts/build-cbeta-glyphs.py` from a locally installed copy. **That font carries no redistribution licence, so the SVG is not in this repo** — in a fresh clone those keys show the notation only (they still insert).

## License

[MIT](LICENSE) © 2026 [Scott G.F. Hong](https://github.com/scottgfhong310). Includes the **bonji-input** Siddhaṁ engine (MIT, © 2021 Ryusei Yamaguchi) and **Noto Sans Siddham** (SIL OFL 1.1, see `fonts/OFL.txt`).
