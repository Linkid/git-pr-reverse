import { test } from "node:test"
import assert from "node:assert/strict"

// storage.js reads browser.storage.local through the browser shim, which
// resolves from globalThis at import time; install a mock before importing.
//
// Contract: the mock MUST be installed before the dynamic import() below —
// keep it dynamic, do not turn it into a static import (those are hoisted and
// would run before the mock is set). The mock is left on globalThis without
// teardown; that is safe because `node --test` runs each test file in its own
// process, so it cannot leak into other test files. Both assumptions break
// under an in-process runner (e.g. --test-isolation=none).

// stub storage areas recording the last set()/remove() and returning a
// configurable backing object from get(); session also records its onChanged
// listeners so tests can fire changes by hand
let backing = {}
let sessionBacking = {}
const sessionListeners = []
const calls = { set: null, sessionSet: null, sessionRemoved: null }
globalThis.browser = {
    storage: {
        local: {
            get: async (key) => (key in backing ? { [key]: backing[key] } : {}),
            set: async (obj) => { calls.set = obj },
        },
        session: {
            get: async (key) => (key in sessionBacking ? { [key]: sessionBacking[key] } : {}),
            set: async (obj) => { calls.sessionSet = obj },
            remove: async (key) => { calls.sessionRemoved = key },
            onChanged: { addListener: (fn) => sessionListeners.push(fn) },
        },
    },
}
const {
    loadInstances, saveInstances,
    saveTabResult, loadTabResult, clearTabResult, onTabResult,
} = await import("../storage.js")

test("loadInstances returns the stored instances", async () => {
    backing = { selfHostedInstances: [{ type: "gitlab", hostname: "git.example.com" }] }
    assert.deepEqual(await loadInstances(), [
        { type: "gitlab", hostname: "git.example.com" },
    ])
})

test("loadInstances defaults to an empty array when none are stored", async () => {
    backing = {}
    assert.deepEqual(await loadInstances(), [])
})

test("saveInstances writes under the selfHostedInstances key", async () => {
    const instances = [{ type: "forgejo", hostname: "code.example.com" }]
    await saveInstances(instances)
    assert.deepEqual(calls.set, { selfHostedInstances: instances })
})

//
// per-tab popup results (session storage)
//
test("saveTabResult writes under the tab's key in session storage", async () => {
    await saveTabResult(7, { prs: [1, 2] })
    assert.deepEqual(calls.sessionSet, { "prs:7": { prs: [1, 2] } })
})

test("loadTabResult returns the result stored for the tab", async () => {
    sessionBacking = { "prs:7": { prs: [42] } }
    assert.deepEqual(await loadTabResult(7), { prs: [42] })
})

test("loadTabResult returns undefined while no result is stored", async () => {
    sessionBacking = {}
    assert.equal(await loadTabResult(7), undefined)
})

test("clearTabResult removes the tab's key", async () => {
    await clearTabResult(7)
    assert.equal(calls.sessionRemoved, "prs:7")
})

test("onTabResult fires only for its own tab's stored results", () => {
    const seen = []
    onTabResult(7, result => seen.push(result))
    const listener = sessionListeners.at(-1)

    // another tab's result is ignored
    listener({ "prs:8": { newValue: { prs: [1] } } })
    // a removal (no newValue) is ignored
    listener({ "prs:7": { oldValue: { prs: [1] } } })
    // this tab's stored result fires the callback
    listener({ "prs:7": { newValue: { error: "boom" } } })

    assert.deepEqual(seen, [{ error: "boom" }])
})
