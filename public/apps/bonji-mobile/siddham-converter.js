// SPDX-License-Identifier: MIT
// Wraps the vendored bonji-input engine (Copyright (c) 2021 Ryusei Yamaguchi, MIT).
// 這是本 App 的唯一悉曇轉換介面（anti-corruption layer）。
// App 其餘程式只 import 本檔，不得直接 import vendor/bonji-input/siddham.js。

import { ascii2latin, ascii2siddham, ascii2symbol, latin2ascii } from "./vendor/bonji-input/siddham.js"

// ── 補充符號（引擎未涵蓋；於本 ACL 補上，不改 vendored 引擎）────────────────────
// 來源：BonjiInput.xlsx 的章節/裝飾符號、virama、替代母音符號。引擎會把這些 code 拆散
// （如 "*1"→𑗄+"1"），故先把每個 code 換成一個私用區 sentinel 餵給引擎（引擎原樣 echo），
// 轉出後再把 sentinel 換回對應字形 / 拉丁。詳見 DESIGN §4「補充符號」。
const DOTTED = "◌" // ◌ 點圈載體（顯示用，與對照表 §7.1 一致）

// 章節 / 裝飾符號 + virama（皆獨立、不接字）。latin 照 bonji 慣例＝悉曇字本身；
// virama 例外：悉曇用 ◌ 載體、latin 放 ◌。
const EXTRA_MARK = {
    "*1": "\u{115CA}", "*2": "\u{115CB}", "*3": "\u{115CC}", "*4": "\u{115CD}",
    "*5": "\u{115CE}", "*6": "\u{115D5}", "*7": "\u{115D6}", "*0": "\u{115D7}",
    "o2": "\u{115CF}", "o2x": "\u{115D0}", "ox2": "\u{115D1}", "ox3": "\u{115D2}",
    "ox4": "\u{115D3}", "oxx": "\u{115D4}",
    ":-": DOTTED + "\u{115BF}", // virama 𑖿 on ◌
}
const EXTRA_MARK_LATIN = { ":-": DOTTED } // 未列者：latin = 悉曇字本身（同 EXTRA_MARK）

// 替代母音符號（依附於前一子音）。注入「base 母音 + sentinel」讓引擎正確接字，轉出後把
// 產生的常規母音符號換成替代字形；latin 用乾淨的 u/ū（替代形的識別交給悉曇/記法/碼位）。
const EXTRA_VSIGN = {
    "_u":  { base: "u",  dep: "\u{115B2}", indep: "\u{11584}", alt: "\u{115DC}" },
    "_uu": { base: "uu", dep: "\u{115B3}", indep: "\u{11585}", alt: "\u{115DD}" },
}

const EXTRA_CODES = [...Object.keys(EXTRA_MARK), ...Object.keys(EXTRA_VSIGN)]
    .sort((a, b) => b.length - a.length) // 長到短：*1 先於 *、_uu 先於 _u、o2x 先於 o2
const EXTRA_RE = new RegExp(
    EXTRA_CODES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g")

/** input 內的補充 code → 私用區 sentinel；回傳 { text, map:(sentinel→code) }。 */
function encodeExtras(input) {
    const map = new Map()
    let n = 0
    const text = input.replace(EXTRA_RE, (code) => {
        const s = String.fromCodePoint(0xE000 + (n++)) // BMP 私用區，引擎原樣 echo
        map.set(s, code)
        return code in EXTRA_MARK ? s : EXTRA_VSIGN[code].base + s
    })
    return { text, map }
}
function decodeExtrasSiddham(siddham, map) {
    for (const [s, code] of map) {
        if (code in EXTRA_MARK) { siddham = siddham.split(s).join(EXTRA_MARK[code]); continue }
        const v = EXTRA_VSIGN[code]
        siddham = siddham.split(v.dep + s).join(v.alt)        // 接子音：常規母音符號 → 替代
            .split(v.indep + s).join(DOTTED + v.alt)          // 單獨：◌ + 替代
            .split(s).join("")                                // 殘留 sentinel 保險清除
    }
    return siddham
}
function decodeExtrasLatin(latin, map) {
    for (const [s, code] of map) {
        const lat = code in EXTRA_MARK ? (EXTRA_MARK_LATIN[code] ?? EXTRA_MARK[code]) : ""
        latin = latin.split(s).join(lat) // 母音符號：去掉 sentinel（引擎已給乾淨的 u/ū）
    }
    return latin
}
function decodeExtrasAscii(ascii, map) {
    for (const [s, code] of map) {
        ascii = code in EXTRA_MARK
            ? ascii.split(s).join(code)
            : ascii.split(EXTRA_VSIGN[code].base + s).join(code).split(s).join("")
    }
    return ascii
}

/**
 * @typedef {Object} SiddhamOptions
 * @property {"ISO15919" | "KH"}   inputMethod
 * @property {"ISO15919" | "IAST"} transliteration
 * @property {boolean}             ignoreSpacesAndHyphens
 */

/**
 * @typedef {Object} SiddhamResult
 * @property {string} input      輸入文字（原樣回傳）
 * @property {string} ascii      共用 ascii 輸入記法（latin2ascii 正規化後；如 ṁ/ṃ → ;m，保留換行）
 * @property {string} siddham    悉曇文字
 * @property {string} latin      拼音字元（拉丁轉寫）
 * @property {string} codepoints 悉曇文字對應的 Unicode 碼位
 */

export class SiddhamConverter {
    /** @type {SiddhamOptions} */
    static defaultOptions = {
        inputMethod: "ISO15919",
        transliteration: "IAST",
        ignoreSpacesAndHyphens: true,
    }

    /** @param {Partial<SiddhamOptions>} [options] */
    constructor(options = {}) {
        /** @type {SiddhamOptions} */
        this.options = { ...SiddhamConverter.defaultOptions, ...options }
    }

    /** @param {Partial<SiddhamOptions>} patch @returns {this} */
    setOptions(patch) {
        this.options = { ...this.options, ...patch }
        return this
    }

    /** @param {string} input @returns {SiddhamResult} */
    convert(input) {
        const { inputMethod, transliteration, ignoreSpacesAndHyphens } = this.options
        const { text, map } = encodeExtras(input) // 補充符號：先換成 sentinel（見檔首）
        const asciiRaw = latin2ascii(ascii2symbol(text), { inputMethod })
        let siddham = SiddhamConverter.toSiddham(asciiRaw, ignoreSpacesAndHyphens)
        let latin = ascii2latin(asciiRaw, { transliteration })
        let ascii = asciiRaw
        if (map.size) {
            siddham = decodeExtrasSiddham(siddham, map)
            latin = decodeExtrasLatin(latin, map)
            ascii = decodeExtrasAscii(asciiRaw, map)
        }
        const codepoints = SiddhamConverter.toCodepoints(siddham)
        return { input, ascii, siddham, latin, codepoints }
    }

    /**
     * ascii → 悉曇字串（引擎本身不修改，邊界語意在此層處理）。
     *
     * - 連字號「-」＝「詞組分隔」：在悉曇輸出中一律算一個空格（兩組子音字以空格分開），
     *   不論 ignore 與否。拉丁轉寫則保留「-」（由 ascii2latin 處理，本函式不碰）。
     * - 空格：ignore=true 時移除「可見空格」但仍視為 token 邊界（故「n a」→𑖡𑖿𑖀＝
     *   子音+獨立母音，而非併成音節 𑖡）；ignore=false 時交給引擎保留為字面空格。
     *
     * @param {string} ascii
     * @param {boolean} ignore
     * @returns {string}
     */
    static toSiddham(ascii, ignore) {
        return ascii.split(/-+/)
            .map((group) => {
                group = group.trim()
                if (!group) return ""
                return ignore
                    ? group.split(/ +/).filter(Boolean).map((seg) => ascii2siddham(seg)).join("")
                    : ascii2siddham(group, { ignoreSpacesAndHyphens: false })
            })
            .filter((s) => s !== "")
            .join(" ")
    }

    /**
     * 原始 ascii → 拉丁轉寫（不經輸入前處理，直接轉；給字元對照表等需以「輸入記法」
     * 直接取讀音的場合用。和 toSiddham 對稱）。
     * @param {string} ascii
     * @param {"ISO15919" | "IAST"} [transliteration]
     * @returns {string}
     */
    static toLatin(ascii, transliteration = "IAST") {
        return ascii2latin(ascii, { transliteration })
    }

    /** @param {string} text @returns {string} */
    static toCodepoints(text) {
        return text.split("\n")
            .map(line =>
                Array.from(line)
                    .map(ch =>
                        `U+${/** @type {number} */ (ch.codePointAt(0))
                            .toString(16)
                            .toUpperCase()
                            .padStart(4, "0")}`
                    )
                    .join(" ")
            )
            .join("\n")
    }
}
