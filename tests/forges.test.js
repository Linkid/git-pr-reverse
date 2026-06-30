import { test } from "node:test"
import assert from "node:assert/strict"

import { github, forgeForHostname } from "../forges.js"

//
// forgeForHostname
//
test("forgeForHostname matches github.com", () => {
    assert.equal(forgeForHostname("github.com"), github)
})

test("forgeForHostname matches a subdomain containing the hostname", () => {
    // hostnames are matched as substrings of the page hostname
    assert.equal(forgeForHostname("www.github.com"), github)
})

test("forgeForHostname returns null for an unknown forge", () => {
    assert.equal(forgeForHostname("gitlab.com"), null)
    assert.equal(forgeForHostname("example.com"), null)
})

//
// github.parseUrl
//
test("github.parseUrl extracts project, repo and filepath from a blob URL", () => {
    const url = new URL("https://github.com/Linkid/git-pr-reverse/blob/main/forges.js")
    assert.deepEqual(github.parseUrl(url), {
        projectKey: "Linkid",
        repoSlug: "git-pr-reverse",
        filepath: "forges.js",
        origin: "https://github.com",
    })
})

test("github.parseUrl keeps nested file paths intact", () => {
    const url = new URL("https://github.com/Linkid/git-pr-reverse/blob/main/popup/popup.js")
    assert.equal(github.parseUrl(url).filepath, "popup/popup.js")
})

test("github.parseUrl returns null for a non-file URL", () => {
    // repo root: not enough path segments to identify a file
    assert.equal(github.parseUrl(new URL("https://github.com/Linkid/git-pr-reverse")), null)
    // homepage
    assert.equal(github.parseUrl(new URL("https://github.com/")), null)
})

//
// URL builders
//
test("github.listPRsUrl builds the pulls endpoint", () => {
    const info = { projectKey: "Linkid", repoSlug: "git-pr-reverse" }
    assert.equal(
        github.listPRsUrl(info),
        "https://api.github.com/repos/Linkid/git-pr-reverse/pulls")
})

test("github.filesUrl builds the files endpoint for a PR", () => {
    const info = { projectKey: "Linkid", repoSlug: "git-pr-reverse" }
    assert.equal(
        github.filesUrl(info, { number: 42 }),
        "https://api.github.com/repos/Linkid/git-pr-reverse/pulls/42/files")
})

test("github.prWebUrl builds the web URL of a PR", () => {
    const info = { projectKey: "Linkid", repoSlug: "git-pr-reverse", origin: "https://github.com" }
    assert.equal(
        github.prWebUrl(info, 42),
        "https://github.com/Linkid/git-pr-reverse/pull/42")
})

//
// response normalizers
//
test("github.prNumber reads the number off a PR object", () => {
    assert.equal(github.prNumber({ number: 7, title: "ignored" }), 7)
})

test("github.filenames maps files to their filename", () => {
    const files = [{ filename: "a.js" }, { filename: "dir/b.js" }]
    assert.deepEqual(github.filenames(files), ["a.js", "dir/b.js"])
})

test("github.filenames returns an empty array for no files", () => {
    assert.deepEqual(github.filenames([]), [])
})

//
// rate limit
//
test("github.rateLimit.remaining reads the core remaining count", () => {
    const data = { resources: { core: { remaining: 58 } } }
    assert.equal(github.rateLimit.remaining(data), 58)
})

test("github.rateLimit exposes the endpoint and header", () => {
    assert.equal(github.rateLimit.url, "https://api.github.com/rate_limit")
    assert.equal(github.rateLimit.header, "x-ratelimit-remaining")
})

//
// authentication
//
test("github.tokenStorageKey names the storage key for the token", () => {
    assert.equal(github.tokenStorageKey, "githubToken")
})

test("github.authHeader builds a Bearer Authorization header", () => {
    assert.deepEqual(github.authHeader("ghp_secret"), {
        Authorization: "Bearer ghp_secret",
    })
})
