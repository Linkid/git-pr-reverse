import { test } from "node:test"
import assert from "node:assert/strict"

import { addIfIncluded, authHeadersFor, getFilesPRs, fetchAllPages, mapWithConcurrency } from "../background.js"
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
// fetchAllPages
//
test("fetchAllPages concatenates the pages following next links", async () => {
    const realFetch = globalThis.fetch
    const realRequest = globalThis.Request

    // two pages chained by a next link, mapped by URL
    const pages = {
        "https://api.example.com/pulls": {
            data: [{ number: 1 }, { number: 2 }],
            next: "https://api.example.com/pulls?page=2",
        },
        "https://api.example.com/pulls?page=2": {
            data: [{ number: 3 }],
            next: null,
        },
    }
    globalThis.Request = class { constructor(url) { this.url = url } }
    globalThis.fetch = async request => ({
        ok: true,
        url: request.url,
        headers: { get: () => null },
        json: async () => pages[request.url].data,
    })
    // a minimal forge whose nextPageUrl walks the chain above
    const forge = { nextPageUrl: (response) => pages[response.url].next }

    try {
        const { items, response } = await fetchAllPages(
            forge, "https://api.example.com/pulls", {}, data => data, "unused")
        assert.deepEqual(items, [{ number: 1 }, { number: 2 }, { number: 3 }])
        // the last response is returned, for rate-limit header checks
        assert.equal(response.url, "https://api.example.com/pulls?page=2")
    } finally {
        globalThis.fetch = realFetch
        globalThis.Request = realRequest
    }
})

test("fetchAllPages throws on a non-ok response", async () => {
    const realFetch = globalThis.fetch
    const realRequest = globalThis.Request

    globalThis.Request = class { constructor(url) { this.url = url } }
    globalThis.fetch = async () => ({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        headers: { get: () => null },
        json: async () => ({ message: "rate limited" }),
    })

    try {
        await assert.rejects(
            fetchAllPages(github, "https://api.example.com/pulls", {}, data => data,
                "Failed to list pull requests"),
            /Failed to list pull requests: \[403\] Forbidden: rate limited/)
    } finally {
        globalThis.fetch = realFetch
        globalThis.Request = realRequest
    }
})

//
// mapWithConcurrency
//
test("mapWithConcurrency caps the tasks in flight and keeps item order", async () => {
    // each task parks its resolver so the test controls when a slot frees
    const resolvers = []
    let started = 0
    const task = item => new Promise(resolve => {
        started++
        resolvers.push(() => resolve(item * 10))
    })

    const result = mapWithConcurrency([0, 1, 2, 3, 4], 2, task)

    // only `limit` tasks start; the rest wait for a slot
    assert.equal(started, 2)

    // finishing a task (out of order) frees its slot for the next item
    resolvers[1]()
    await Promise.resolve()
    assert.equal(started, 3)
    resolvers[0]()
    await Promise.resolve()
    assert.equal(started, 4)
    resolvers[3]()
    await Promise.resolve()
    assert.equal(started, 5)
    resolvers[2]()
    resolvers[4]()

    // results follow the item order, not the completion order
    assert.deepEqual(await result, [0, 10, 20, 30, 40])
})

test("mapWithConcurrency handles more slots than items", async () => {
    assert.deepEqual(await mapWithConcurrency([1, 2], 10, async x => x + 1), [2, 3])
})

test("mapWithConcurrency resolves to an empty array for no items", async () => {
    assert.deepEqual(await mapWithConcurrency([], 10, async x => x), [])
})

test("mapWithConcurrency rejects when a task throws", async () => {
    await assert.rejects(
        mapWithConcurrency([1, 2], 2, async x => { throw new Error(`task ${x}`) }),
        /task 1/)
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
            headers: { get: () => null },  // single page: no Link header
            json: async () => [{ filename: "a.js" }, { filename: "b.js" }],
        }))
    })

    try {
        // both calls start and reach their `await fetch` before either resolves
        const callA = getFilesPRs(github, { filepath: "a.js" }, {}, [{ number: 1 }])
        const callB = getFilesPRs(github, { filepath: "missing.js" }, {}, [{ number: 2 }])

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
