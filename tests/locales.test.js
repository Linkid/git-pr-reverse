import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"

// Keeps _locales/template.json, the shipped locales and the code in sync:
// every locale has exactly the template's keys, and every key the code uses is
// in the template (and vice versa).

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const keysOf = (path) => Object.keys(JSON.parse(read(path))).sort()

const templateKeys = keysOf("_locales/template.json")
const locales = readdirSync(new URL("_locales/", root), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

// the extension sources that may reference message keys
const sources = [
    "manifest.json",
    ...readdirSync(root).filter((name) => name.endsWith(".js") && name !== "eslint.config.js"),
    ...["popup", "options"].flatMap((dir) =>
        readdirSync(new URL(`${dir}/`, root))
            .filter((name) => /\.(js|html)$/.test(name))
            .map((name) => `${dir}/${name}`)),
]
const code = sources.map(read).join("\n")

// keys referenced by the code: __MSG_<key>__ placeholders, plus quoted string
// literals shaped like a message key (keys are passed around as literals, e.g.
// showStatus("optionsSaved") or hintKey: "optionsTokenHint")
function usedKeys() {
    const used = new Set()
    for (const match of code.matchAll(/__MSG_(\w+)__/g)) used.add(match[1])
    for (const match of code.matchAll(/["'`]((?:extension|popup|options)[A-Z]\w*)["'`]/g)) used.add(match[1])
    return [...used].sort()
}

test("locales: the manifest's default_locale is shipped", () => {
    const { default_locale } = JSON.parse(read("manifest.json"))
    assert.ok(locales.includes(default_locale), `missing _locales/${default_locale}/`)
})

for (const locale of locales) {
    const path = `_locales/${locale}/messages.json`

    test(`locales: ${locale} has exactly the template's keys`, () => {
        assert.deepEqual(keysOf(path), templateKeys)
    })

    test(`locales: ${locale} has no empty message`, () => {
        const messages = JSON.parse(read(path))
        const empty = Object.keys(messages).filter((key) => !messages[key].message)
        assert.deepEqual(empty, [])
    })
}

test("locales: every key used by the code is in the template", () => {
    const missing = usedKeys().filter((key) => !templateKeys.includes(key))
    assert.deepEqual(missing, [])
})

test("locales: every template key is used by the code", () => {
    const unused = templateKeys.filter((key) =>
        !code.includes(`__MSG_${key}__`) && !new RegExp(`["'\`]${key}["'\`]`).test(code))
    assert.deepEqual(unused, [])
})
