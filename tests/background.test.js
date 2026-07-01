import { test } from "node:test"
import assert from "node:assert/strict"

import { addIfIncluded, getFilenames, authHeadersFor, getFilesPRs } from "../background.js"
import { github } from "../forges.js"

//
// addIfIncluded
//
test("addIfIncluded returns the key when the item is in the array", () => {
    assert.equal(addIfIncluded(["a.js", "b.js"], "a.js", 42), 42)
})

test("addIfIncluded returns null when the item is absent", () => {
    assert.equal(addIfIncluded(["a.js", "b.js"], "c.js", 42), null)
})

test("addIfIncluded returns null for an empty array", () => {
    assert.equal(addIfIncluded([], "a.js", 42), null)
})

test("addIfIncluded preserves a falsy key when the item is present", () => {
    // a PR number of 0 is unrealistic, but the helper must not confuse a
    // present-but-falsy key with the absent case
    assert.equal(addIfIncluded(["a.js"], "a.js", 0), 0)
})

//
// getFilenames (delegates to the forge adapter)
//
test("getFilenames delegates to the forge adapter", () => {
    const files = [{ filename: "a.js" }, { filename: "dir/b.js" }]
    assert.deepEqual(getFilenames(github, files), ["a.js", "dir/b.js"])
})

test("getFilenames returns an empty array for no files", () => {
    assert.deepEqual(getFilenames(github, []), [])
})

//
// authHeadersFor
//
test("authHeadersFor builds the auth header from a stored token", () => {
    assert.deepEqual(authHeadersFor(github, { githubToken: "ghp_secret" }), {
        Authorization: "Bearer ghp_secret",
    })
})

test("authHeadersFor returns no headers when no token is stored", () => {
    assert.deepEqual(authHeadersFor(github, {}), {})
})

test("authHeadersFor returns no headers for a forge without authentication", () => {
    // an adapter that declares no token key / header builder
    const forge = { hostnames: ["example.com"] }
    assert.deepEqual(authHeadersFor(forge, { githubToken: "ghp_secret" }), {})
})

//
// getFilesPRs — regression guard for the per-tab state race
//
// getFilesPRs must derive its result solely from the forge/urlInfo passed to
// it, never from shared module state. This runs two calls with different
// urlInfo.filepath concurrently and releases their fetches out of order, so a
// helper that read a shared global (the pre-refactor bug) would cross-
// contaminate and fail this test.
test("getFilesPRs uses its own arguments under interleaved concurrent calls", async () => {
    const realFetch = globalThis.fetch
    const realRequest = globalThis.Request

    // every PR reports touching both "a.js" and "b.js"; each fetch parks its
    // resolver so the test controls the completion order
    const resolvers = []
    globalThis.Request = class { constructor(url) { this.url = url } }
    globalThis.fetch = () => new Promise(resolve => {
        resolvers.push(() => resolve({
            ok: true,
            json: async () => [{ filename: "a.js" }, { filename: "b.js" }],
        }))
    })

    try {
        // both calls start and reach their `await fetch` before either resolves
        const callA = Promise.all(getFilesPRs(github, { filepath: "a.js" }, {}, [{ number: 1 }]))
        const callB = Promise.all(getFilesPRs(github, { filepath: "missing.js" }, {}, [{ number: 2 }]))

        // release out of order (B before A) to force interleaving
        resolvers[1]()
        resolvers[0]()

        // each call resolves against its own filepath, regardless of order
        assert.deepEqual(await callA, [1])       // "a.js" present -> PR #1
        assert.deepEqual(await callB, [null])    // "missing.js" absent -> null
    } finally {
        globalThis.fetch = realFetch
        globalThis.Request = realRequest
    }
})
