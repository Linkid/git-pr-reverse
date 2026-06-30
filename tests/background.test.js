import { test } from "node:test"
import assert from "node:assert/strict"

import { addIfIncluded, getFilenames, authHeadersFor } from "../background.js"
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
