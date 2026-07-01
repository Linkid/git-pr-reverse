import { test } from "node:test"
import assert from "node:assert/strict"

import { github, bitbucket, codeberg, gitlab, forgeForHostname } from "../forges.js"

//
// forgeForHostname
//
test("forgeForHostname matches github.com", () => {
    assert.equal(forgeForHostname("github.com"), github)
})

test("forgeForHostname matches bitbucket.org", () => {
    assert.equal(forgeForHostname("bitbucket.org"), bitbucket)
})

test("forgeForHostname matches codeberg.org", () => {
    assert.equal(forgeForHostname("codeberg.org"), codeberg)
})

test("forgeForHostname matches gitlab.com", () => {
    assert.equal(forgeForHostname("gitlab.com"), gitlab)
})

test("forgeForHostname matches a subdomain containing the hostname", () => {
    // hostnames are matched as substrings of the page hostname
    assert.equal(forgeForHostname("www.github.com"), github)
})

test("forgeForHostname returns null for an unknown forge", () => {
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

test("github.pullRequests returns the list response as-is", () => {
    const prs = [{ number: 1 }, { number: 2 }]
    assert.equal(github.pullRequests(prs), prs)
})

//
// bitbucket adapter
//
test("bitbucket.parseUrl extracts workspace, repo and filepath from a src URL", () => {
    const url = new URL("https://bitbucket.org/acme/widget/src/main/src/app.js")
    assert.deepEqual(bitbucket.parseUrl(url), {
        projectKey: "acme",
        repoSlug: "widget",
        filepath: "src/app.js",
        origin: "https://bitbucket.org",
    })
})

test("bitbucket.parseUrl returns null for a non-file URL", () => {
    assert.equal(bitbucket.parseUrl(new URL("https://bitbucket.org/acme/widget")), null)
})

test("bitbucket.listPRsUrl builds the pullrequests endpoint", () => {
    const info = { projectKey: "acme", repoSlug: "widget" }
    assert.equal(
        bitbucket.listPRsUrl(info),
        "https://api.bitbucket.org/2.0/repositories/acme/widget/pullrequests")
})

test("bitbucket.filesUrl builds the diffstat endpoint for a PR", () => {
    const info = { projectKey: "acme", repoSlug: "widget" }
    assert.equal(
        bitbucket.filesUrl(info, { id: 7 }),
        "https://api.bitbucket.org/2.0/repositories/acme/widget/pullrequests/7/diffstat")
})

test("bitbucket.prWebUrl builds the web URL of a PR", () => {
    const info = { projectKey: "acme", repoSlug: "widget", origin: "https://bitbucket.org" }
    assert.equal(
        bitbucket.prWebUrl(info, 7),
        "https://bitbucket.org/acme/widget/pull-requests/7")
})

test("bitbucket.prNumber reads the id off a PR object", () => {
    assert.equal(bitbucket.prNumber({ id: 7, title: "ignored" }), 7)
})

test("bitbucket.pullRequests unwraps the paginated envelope", () => {
    const data = { values: [{ id: 1 }, { id: 2 }], pagelen: 10 }
    assert.deepEqual(bitbucket.pullRequests(data), [{ id: 1 }, { id: 2 }])
})

test("bitbucket.filenames reads the new path from diffstat entries", () => {
    const diffstat = { values: [
        { new: { path: "a.js" }, old: { path: "a.js" }, status: "modified" },
        { new: { path: "dir/b.js" }, old: null, status: "added" },
    ] }
    assert.deepEqual(bitbucket.filenames(diffstat), ["a.js", "dir/b.js"])
})

test("bitbucket.filenames falls back to the old path for deletions", () => {
    const diffstat = { values: [{ new: null, old: { path: "gone.js" }, status: "removed" }] }
    assert.deepEqual(bitbucket.filenames(diffstat), ["gone.js"])
})

test("bitbucket exposes no rate-limit endpoint", () => {
    assert.equal(bitbucket.rateLimit, null)
})

test("bitbucket.authHeader builds a Bearer Authorization header", () => {
    assert.deepEqual(bitbucket.authHeader("bb_secret"), {
        Authorization: "Bearer bb_secret",
    })
})

//
// codeberg adapter (Forgejo / Gitea-compatible API)
//
test("codeberg.parseUrl extracts owner, repo and filepath from a src URL", () => {
    const url = new URL("https://codeberg.org/forgejo/forgejo/src/branch/forgejo/README.md")
    assert.deepEqual(codeberg.parseUrl(url), {
        projectKey: "forgejo",
        repoSlug: "forgejo",
        filepath: "README.md",
        origin: "https://codeberg.org",
    })
})

test("codeberg.parseUrl keeps nested file paths intact", () => {
    const url = new URL("https://codeberg.org/acme/widget/src/commit/deadbeef/dir/app.js")
    assert.equal(codeberg.parseUrl(url).filepath, "dir/app.js")
})

test("codeberg.parseUrl returns null for a non-file URL", () => {
    assert.equal(codeberg.parseUrl(new URL("https://codeberg.org/acme/widget")), null)
})

test("codeberg.listPRsUrl builds the pulls endpoint", () => {
    const info = { projectKey: "acme", repoSlug: "widget" }
    assert.equal(
        codeberg.listPRsUrl(info),
        "https://codeberg.org/api/v1/repos/acme/widget/pulls")
})

test("codeberg.filesUrl builds the files endpoint for a PR", () => {
    const info = { projectKey: "acme", repoSlug: "widget" }
    assert.equal(
        codeberg.filesUrl(info, { number: 42 }),
        "https://codeberg.org/api/v1/repos/acme/widget/pulls/42/files")
})

test("codeberg.prWebUrl builds the web URL of a PR", () => {
    const info = { projectKey: "acme", repoSlug: "widget", origin: "https://codeberg.org" }
    assert.equal(
        codeberg.prWebUrl(info, 42),
        "https://codeberg.org/acme/widget/pulls/42")
})

test("codeberg.prNumber reads the number off a PR object", () => {
    assert.equal(codeberg.prNumber({ number: 7, title: "ignored" }), 7)
})

test("codeberg.pullRequests returns the list response as-is", () => {
    const prs = [{ number: 1 }, { number: 2 }]
    assert.equal(codeberg.pullRequests(prs), prs)
})

test("codeberg.filenames maps files to their filename", () => {
    const files = [{ filename: "a.js" }, { filename: "dir/b.js" }]
    assert.deepEqual(codeberg.filenames(files), ["a.js", "dir/b.js"])
})

test("codeberg exposes no rate-limit endpoint", () => {
    assert.equal(codeberg.rateLimit, null)
})

test("codeberg.authHeader builds a token Authorization header", () => {
    assert.deepEqual(codeberg.authHeader("cb_secret"), {
        Authorization: "token cb_secret",
    })
})

//
// gitlab adapter (merge requests, nested namespaces, URL-encoded project path)
//
test("gitlab.parseUrl extracts the project path and filepath from a blob URL", () => {
    const url = new URL("https://gitlab.com/gitlab-org/gitlab/-/blob/master/README.md")
    assert.deepEqual(gitlab.parseUrl(url), {
        projectPath: "gitlab-org/gitlab",
        filepath: "README.md",
        origin: "https://gitlab.com",
    })
})

test("gitlab.parseUrl keeps nested group namespaces in the project path", () => {
    const url = new URL("https://gitlab.com/group/subgroup/widget/-/blob/main/dir/app.js")
    const info = gitlab.parseUrl(url)
    assert.equal(info.projectPath, "group/subgroup/widget")
    assert.equal(info.filepath, "dir/app.js")
})

test("gitlab.parseUrl returns null for a non-file URL", () => {
    assert.equal(gitlab.parseUrl(new URL("https://gitlab.com/acme/widget")), null)
})

test("gitlab.listPRsUrl builds the merge_requests endpoint with the encoded path", () => {
    const info = { projectPath: "group/subgroup/widget" }
    assert.equal(
        gitlab.listPRsUrl(info),
        "https://gitlab.com/api/v4/projects/group%2Fsubgroup%2Fwidget/merge_requests?state=opened")
})

test("gitlab.filesUrl builds the diffs endpoint for a merge request", () => {
    const info = { projectPath: "acme/widget" }
    assert.equal(
        gitlab.filesUrl(info, { iid: 42 }),
        "https://gitlab.com/api/v4/projects/acme%2Fwidget/merge_requests/42/diffs")
})

test("gitlab.prWebUrl builds the web URL of a merge request", () => {
    const info = { projectPath: "acme/widget", origin: "https://gitlab.com" }
    assert.equal(
        gitlab.prWebUrl(info, 42),
        "https://gitlab.com/acme/widget/-/merge_requests/42")
})

test("gitlab.prNumber reads the iid off a merge request object", () => {
    assert.equal(gitlab.prNumber({ id: 999, iid: 7, title: "ignored" }), 7)
})

test("gitlab.pullRequests returns the list response as-is", () => {
    const mrs = [{ iid: 1 }, { iid: 2 }]
    assert.equal(gitlab.pullRequests(mrs), mrs)
})

test("gitlab.filenames maps diff entries to their new_path", () => {
    const files = [{ new_path: "a.js", old_path: "a.js" }, { new_path: "dir/b.js", old_path: "dir/b.js" }]
    assert.deepEqual(gitlab.filenames(files), ["a.js", "dir/b.js"])
})

test("gitlab exposes no rate-limit endpoint", () => {
    assert.equal(gitlab.rateLimit, null)
})

test("gitlab.authHeader builds a PRIVATE-TOKEN header", () => {
    assert.deepEqual(gitlab.authHeader("gl_secret"), {
        "PRIVATE-TOKEN": "gl_secret",
    })
})
