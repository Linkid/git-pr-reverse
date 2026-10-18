// Sync the locales with the default one (the reference, read from the
// manifest's default_locale):
//   - regenerate _locales/template.json from the reference's keys, with an
//     empty message and the reference's description;
//   - in every other locale, add the missing keys with an empty message (the
//     locale test flags them until they are translated), drop the keys the
//     reference no longer has, and order the keys like the reference.
//
// Usage: npm run locales [-- <lang>...]
// Each <lang> without a _locales/<lang>/ folder is created from the template.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

// an empty entry for a key: no message, the reference's description and
// placeholders (a translation uses the same placeholders)
function emptyEntry(entry) {
    return {
        message: "",
        description: entry.description ?? "",
        ...(entry.placeholders && { placeholders: entry.placeholders }),
    }
}

// the template: every reference key with an empty entry
export function templateFrom(reference) {
    return Object.fromEntries(
        Object.entries(reference).map(([key, entry]) => [key, emptyEntry(entry)]))
}

// a locale synced with the reference; returns { messages, added, removed }
// where added/removed list the keys added (to translate) and dropped
export function syncLocale(reference, locale) {
    const messages = {}
    const added = []
    for (const [key, entry] of Object.entries(reference)) {
        if (Object.hasOwn(locale, key)) {
            messages[key] = locale[key]
        } else {
            messages[key] = emptyEntry(entry)
            added.push(key)
        }
    }
    const removed = Object.keys(locale).filter((key) => !Object.hasOwn(reference, key))
    return { messages, added, removed }
}

// "<count> <label>", listing the keys when they are few enough to read
function describe(keys, label) {
    const list = keys.length <= 5 ? ` (${keys.join(", ")})` : ""
    return keys.length && `${keys.length} ${label}${list}`
}

// the locale files use standard 2-space JSON with a final newline
function writeJson(url, data) {
    const text = JSON.stringify(data, null, 2) + "\n"
    const changed = !existsSync(url) || readFileSync(url, "utf8") !== text
    if (changed) {
        writeFileSync(url, text)
    }
    return changed
}

function main(newLangs) {
    const root = new URL("../", import.meta.url)
    const localesDir = new URL("_locales/", root)
    const readJson = (url) => JSON.parse(readFileSync(url, "utf8"))

    const { default_locale: referenceLang } = readJson(new URL("manifest.json", root))
    const reference = readJson(new URL(`${referenceLang}/messages.json`, localesDir))

    const changed = writeJson(new URL("template.json", localesDir), templateFrom(reference))
    console.log(`template: ${changed ? "updated" : "up to date"} (from ${referenceLang})`)

    // create the requested new locales (empty, filled in below)
    for (const lang of newLangs) {
        // a WebExtension locale code: a language, optionally with a region
        if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(lang)) {
            throw new Error(`invalid locale code "${lang}" (expected e.g. "de" or "pt_BR")`)
        }
        const dir = new URL(`${lang}/`, localesDir)
        if (!existsSync(dir)) {
            mkdirSync(dir)
            writeJson(new URL("messages.json", dir), {})
            console.log(`${lang}: created`)
        }
    }

    const langs = readdirSync(localesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== referenceLang)
        .map((entry) => entry.name)
        .sort()
    for (const lang of langs) {
        const url = new URL(`${lang}/messages.json`, localesDir)
        const { messages, added, removed } = syncLocale(reference, readJson(url))
        writeJson(url, messages)

        const untranslated = Object.keys(messages).filter((key) => !messages[key].message)
        const summary = [
            describe(added, "added"),
            describe(removed, "removed"),
            describe(untranslated, "to translate"),
        ].filter(Boolean)
        console.log(`${lang}: ${summary.length ? summary.join(", ") : "up to date"}`)
    }
}

// run as a script (not when imported by the tests)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main(process.argv.slice(2))
    } catch (error) {
        console.error(`sync-locales: ${error.message}`)
        process.exitCode = 1
    }
}
