import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"

//
// browser + fetch mocks
//
// background.js registers its tab/message listeners on import when the browser
// shim resolves, so a mock is installed on globalThis first and the listeners
// are captured to drive the page-load and on-demand lookup paths.
//
// Contract: the mocks MUST be installed before the dynamic import() below —
// keep it dynamic, do not turn it into a static import (those are hoisted and
// would run before the mocks are set). The mocks are left on globalThis without
// teardown; that is safe because `node --test` runs each test file in its own
// process, so they cannot leak into other test files. Both assumptions break
// under an in-process runner (e.g. --test-isolation=none).

const FILE_URL = "https://github.com/owner/repo/blob/main/README.md"

const listeners = {}
let state

function reset() {
    state = {
        tabUrls: [FILE_URL],  // successive tabs.get() URLs (the last one repeats)
        fetches: [],
        badges: [],
        session: {},
        enabled: [],
    }
}
reset()

globalThis.browser = {
    action: {
        disable: () => {},
        enable: (tabId) => state.enabled.push(tabId),
        setBadgeText: ({ text, tabId }) => state.badges.push({ text, tabId }),
    },
    tabs: {
        onCreated: { addListener: (fn) => { listeners.created = fn } },
        onUpdated: { addListener: (fn) => { listeners.updated = fn } },
        onRemoved: { addListener: (fn) => { listeners.removed = fn } },
        get: async (id) => ({ id, url: state.tabUrls.length > 1 ? state.tabUrls.shift() : state.tabUrls[0] }),
    },
    runtime: { onMessage: { addListener: (fn) => { listeners.message = fn } } },
    permissions: { contains: async () => true },
    storage: {
        local: { get: async () => ({}) },
        session: {
            set: async (items) => Object.assign(state.session, items),
            get: async (key) => ({ [key]: state.session[key] }),
            remove: async (key) => { delete state.session[key] },
        },
    },
}

// the PR list endpoint answers no open PR; the per-PR files are never fetched
globalThis.fetch = async (request) => {
    state.fetches.push(request.url)
    return {
        ok: true,
        url: request.url,
        headers: { get: (name) => (name === "x-ratelimit-remaining" ? "5000" : null) },
        json: async () => [],
    }
}

await import("../background.js")

// let the pending lookups settle
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

// send the popup's lookup request; resolves once the background replied
function askForPRs(tabId, url = FILE_URL) {
    let replied = false
    listeners.message({ type: "getPRs", tabId, url }, {}, () => { replied = true })
    return replied
}

beforeEach(reset)

test("page load enables the action without any network request", async () => {
    state.session["prs:1"] = { prs: [7] }

    listeners.updated(1, { status: "complete" }, { id: 1, url: FILE_URL })
    await settle()

    assert.deepEqual(state.fetches, [])
    assert.deepEqual(state.enabled, [1])
    // the previous page's badge and result are dropped
    assert.deepEqual(state.badges, [{ text: "", tabId: 1 }])
    assert.equal(state.session["prs:1"], undefined)
})

test("a getPRs message looks the file up and stores the result", async () => {
    assert.equal(askForPRs(2), true)
    await settle()

    assert.equal(state.fetches.length, 1)
    assert.deepEqual(state.session["prs:2"], { prs: [] })
    assert.deepEqual(state.badges, [{ text: "0", tabId: 2 }])
})

test("a second getPRs during a lookup doesn't start another one", async () => {
    askForPRs(3)
    askForPRs(3)
    await settle()

    assert.equal(state.fetches.length, 1)
})

test("a lookup whose tab loaded another page meanwhile is dropped", async () => {
    // the tab shows the file when the lookup starts, another page when it ends
    state.tabUrls = [FILE_URL, "https://github.com/owner/repo"]

    askForPRs(4)
    await settle()

    assert.equal(state.fetches.length, 1)
    assert.equal(state.session["prs:4"], undefined)
    assert.deepEqual(state.badges, [])
})
