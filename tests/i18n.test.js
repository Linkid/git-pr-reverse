import { test } from "node:test"
import assert from "node:assert/strict"

// localize() reads the browser.i18n namespace through the browser shim, which
// resolves from globalThis at import time; install a mock before importing.
//
// Contract: the mock MUST be installed before the dynamic import() below —
// keep it dynamic, do not turn it into a static import (those are hoisted and
// would run before the mock is set). The mock is left on globalThis without
// teardown; that is safe because `node --test` runs each test file in its own
// process, so it cannot leak into other test files. Both assumptions break
// under an in-process runner (e.g. --test-isolation=none).
globalThis.browser = {
    i18n: { getMessage: (key) => (key === "greeting" ? "Hello" : `<${key}>`) },
}
const { localize } = await import("../i18n.js")

// a minimal element stand-in exposing just textContent
function element(textContent) {
    return { textContent }
}

// a fake root whose querySelectorAll("[i18n]") returns the given elements
function root(elements) {
    return { querySelectorAll: () => elements }
}

test("localize replaces a __MSG_<key>__ placeholder with its translation", () => {
    const el = element("__MSG_greeting__")
    localize(root([el]))
    assert.equal(el.textContent, "Hello")
})

test("localize replaces every placeholder across the tagged elements", () => {
    const a = element("__MSG_greeting__")
    const b = element("prefix __MSG_missing__ suffix")
    localize(root([a, b]))
    assert.equal(a.textContent, "Hello")
    assert.equal(b.textContent, "prefix <missing> suffix")
})

test("localize leaves text without a placeholder untouched", () => {
    const el = element("plain text")
    localize(root([el]))
    // unchanged (and reference identity of the string is irrelevant, value is)
    assert.equal(el.textContent, "plain text")
})
