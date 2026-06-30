import { test } from "node:test"
import assert from "node:assert/strict"

import { getBrowser } from "../browser.js"

//
// getBrowser (cross-browser API namespace resolution)
//
test("getBrowser prefers the standard `browser` namespace (Firefox)", () => {
    const browserApi = {}
    const chromeApi = {}
    assert.equal(getBrowser({ browser: browserApi, chrome: chromeApi }), browserApi)
})

test("getBrowser falls back to `chrome` when `browser` is absent (Chrome)", () => {
    const chromeApi = {}
    assert.equal(getBrowser({ chrome: chromeApi }), chromeApi)
})

test("getBrowser returns undefined outside a WebExtension context", () => {
    assert.equal(getBrowser({}), undefined)
})
