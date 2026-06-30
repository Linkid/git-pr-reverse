import { test } from "node:test"
import assert from "node:assert/strict"

import { addIfIncluded, getFilenames } from "../background.js"
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
