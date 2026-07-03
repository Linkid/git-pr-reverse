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

// a stub storage.local recording the last set()/remove() and returning a
// configurable backing object from get()
let backing = {}
const calls = { set: null }
globalThis.browser = {
    storage: {
        local: {
            get: async (key) => (key in backing ? { [key]: backing[key] } : {}),
            set: async (obj) => { calls.set = obj },
        },
    },
}
const { loadInstances, saveInstances } = await import("../storage.js")

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
