import { test } from "node:test"
import assert from "node:assert/strict"

import {
    github, bitbucket, codeberg, gitlab,
    forgeForHostname,
    selfHostedTypes, selfHostedTokenKey, buildSelfHostedForge,
    buildGerritForge, gerritMirrorTypes, parseGerritJson,
} from "../forges.js"

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

test("forgeForHostname matches a subdomain of a forge hostname", () => {
    assert.equal(forgeForHostname("www.github.com"), github)
})

test("forgeForHostname returns null for an unknown forge", () => {
    assert.equal(forgeForHostname("example.com"), null)
})

test("forgeForHostname does not match a forge hostname as a mere substring", () => {
    // a hostile lookalike host must not be treated as the real forge (it would
    // trigger API calls carrying the user's token for attacker-chosen paths)
    assert.equal(forgeForHostname("github.com.evil.example"), null)
    // an unrelated host merely containing the name is not the public forge
    assert.equal(forgeForHostname("mygithub.company.com"), null)
    assert.equal(forgeForHostname("evil-gitlab.com"), null)
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
        "https://api.github.com/repos/Linkid/git-pr-reverse/pulls?per_page=100")
})

test("github.filesUrl builds the files endpoint for a PR", () => {
    const info = { projectKey: "Linkid", repoSlug: "git-pr-reverse" }
    assert.equal(
        github.filesUrl(info, { number: 42 }),
        "https://api.github.com/repos/Linkid/git-pr-reverse/pulls/42/files?per_page=100")
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
test("github.rateLimit exposes the remaining-quota header", () => {
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
        "https://api.bitbucket.org/2.0/repositories/acme/widget/pullrequests?pagelen=50")
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
        "https://codeberg.org/api/v1/repos/acme/widget/pulls?limit=50")
})

test("codeberg.filesUrl builds the files endpoint for a PR", () => {
    const info = { projectKey: "acme", repoSlug: "widget" }
    assert.equal(
        codeberg.filesUrl(info, { number: 42 }),
        "https://codeberg.org/api/v1/repos/acme/widget/pulls/42/files?limit=50")
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
        "https://gitlab.com/api/v4/projects/group%2Fsubgroup%2Fwidget/merge_requests?state=opened&per_page=100")
})

test("gitlab.filesUrl builds the diffs endpoint for a merge request", () => {
    const info = { projectPath: "acme/widget" }
    assert.equal(
        gitlab.filesUrl(info, { iid: 42 }),
        "https://gitlab.com/api/v4/projects/acme%2Fwidget/merge_requests/42/diffs?per_page=100")
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

//
// pagination
//
test("github.nextPageUrl follows the Link header rel=next", () => {
    const link = '<https://api.github.com/repos/a/b/pulls?page=2>; rel="next", ' +
        '<https://api.github.com/repos/a/b/pulls?page=5>; rel="last"'
    const response = { headers: { get: () => link } }
    assert.equal(github.nextPageUrl(response, []), "https://api.github.com/repos/a/b/pulls?page=2")
})

test("github.nextPageUrl returns null on the last page", () => {
    // no Link header at all
    assert.equal(github.nextPageUrl({ headers: { get: () => null } }, []), null)
    // a Link header without a rel="next" entry
    const link = '<https://api.github.com/repos/a/b/pulls?page=1>; rel="first"'
    assert.equal(github.nextPageUrl({ headers: { get: () => link } }, []), null)
})

test("gitlab and codeberg paginate through the Link header too", () => {
    const response = { headers: { get: () => '<https://example.com/api?page=2>; rel="next"' } }
    assert.equal(gitlab.nextPageUrl(response, []), "https://example.com/api?page=2")
    assert.equal(codeberg.nextPageUrl(response, []), "https://example.com/api?page=2")
})

test("bitbucket.nextPageUrl reads the next URL off the envelope", () => {
    const next = "https://api.bitbucket.org/2.0/repositories/acme/widget/pullrequests?page=2"
    assert.equal(bitbucket.nextPageUrl({}, { values: [], next }), next)
    // the last page carries no `next` field
    assert.equal(bitbucket.nextPageUrl({}, { values: [] }), null)
})

test("bitbucket-server nextPageUrl re-requests the same URL at nextPageStart", () => {
    const forge = buildSelfHostedForge({ type: "bitbucket-server", hostname: "bitbucket.example.com" })
    const response = { url: "https://bitbucket.example.com/rest/api/latest/projects/PRJ/repos/widget/pull-requests?state=OPEN&limit=100" }
    assert.equal(
        forge.nextPageUrl(response, { isLastPage: false, nextPageStart: 100 }),
        "https://bitbucket.example.com/rest/api/latest/projects/PRJ/repos/widget/pull-requests?state=OPEN&limit=100&start=100")
    assert.equal(forge.nextPageUrl(response, { isLastPage: true }), null)
})

//
// self-hosted forges
//
test("selfHostedTypes lists the supported software with labels", () => {
    assert.deepEqual(selfHostedTypes(), [
        { type: "gitlab", label: "GitLab" },
        { type: "forgejo", label: "Forgejo / Gitea" },
        { type: "bitbucket-server", label: "Bitbucket Server / Data Center" },
        { type: "gerrit", label: "Gerrit" },
    ])
})

test("selfHostedTokenKey keys the token by hostname", () => {
    assert.equal(selfHostedTokenKey("git.example.com"), "selfHostedToken:git.example.com")
})

test("buildSelfHostedForge returns null for an unknown software type", () => {
    assert.equal(buildSelfHostedForge({ type: "svn", hostname: "git.example.com" }), null)
})

test("buildSelfHostedForge builds a GitLab instance adapter reusing the gitlab logic", () => {
    const forge = buildSelfHostedForge({ type: "gitlab", hostname: "gitlab.example.com" })

    assert.equal(forge.label, "gitlab.example.com")
    assert.deepEqual(forge.hostnames, ["gitlab.example.com"])
    assert.equal(forge.base_url, "https://gitlab.example.com/api/v4")
    assert.equal(forge.tokenStorageKey, "selfHostedToken:gitlab.example.com")
    assert.equal(forge.selfHosted, true)

    // API/URL builders reuse the gitlab implementation against the instance
    const info = { projectPath: "group/widget", origin: "https://gitlab.example.com" }
    assert.equal(
        forge.listPRsUrl(info),
        "https://gitlab.example.com/api/v4/projects/group%2Fwidget/merge_requests?state=opened&per_page=100")
    assert.equal(forge.prNumber({ iid: 7 }), 7)
    assert.deepEqual(forge.authHeader("gl_secret"), { "PRIVATE-TOKEN": "gl_secret" })
})

test("buildSelfHostedForge builds a Forgejo instance adapter reusing the codeberg logic", () => {
    const forge = buildSelfHostedForge({ type: "forgejo", hostname: "git.example.com" })

    assert.equal(forge.base_url, "https://git.example.com/api/v1")
    const info = { projectKey: "acme", repoSlug: "widget" }
    assert.equal(
        forge.filesUrl(info, { number: 42 }),
        "https://git.example.com/api/v1/repos/acme/widget/pulls/42/files?limit=50")
    assert.deepEqual(forge.authHeader("cb_secret"), { Authorization: "token cb_secret" })
})

test("buildSelfHostedForge builds a Bitbucket Server instance adapter", () => {
    const forge = buildSelfHostedForge({ type: "bitbucket-server", hostname: "bitbucket.example.com" })

    assert.equal(forge.base_url, "https://bitbucket.example.com/rest/api/latest")
    assert.equal(forge.selfHosted, true)

    const info = { projectKey: "PRJ", repoSlug: "widget", origin: "https://bitbucket.example.com" }
    assert.equal(
        forge.listPRsUrl(info),
        "https://bitbucket.example.com/rest/api/latest/projects/PRJ/repos/widget/pull-requests?state=OPEN&limit=100")
    assert.equal(
        forge.filesUrl(info, { id: 7 }),
        "https://bitbucket.example.com/rest/api/latest/projects/PRJ/repos/widget/pull-requests/7/changes?limit=100")
    assert.equal(
        forge.prWebUrl(info, 7),
        "https://bitbucket.example.com/projects/PRJ/repos/widget/pull-requests/7")
    assert.equal(forge.prNumber({ id: 7 }), 7)
    assert.deepEqual(forge.authHeader("bbs_secret"), { Authorization: "Bearer bbs_secret" })
})

test("bitbucket-server parseUrl extracts project, repo and filepath from a browse URL", () => {
    const forge = buildSelfHostedForge({ type: "bitbucket-server", hostname: "bitbucket.example.com" })
    const url = new URL("https://bitbucket.example.com/projects/PRJ/repos/widget/browse/src/app.js?at=refs%2Fheads%2Fmain")
    assert.deepEqual(forge.parseUrl(url), {
        projectKey: "PRJ",
        repoSlug: "widget",
        filepath: "src/app.js",
        origin: "https://bitbucket.example.com",
    })
})

test("bitbucket-server parseUrl maps a personal repo browse URL to the ~userSlug project", () => {
    const forge = buildSelfHostedForge({ type: "bitbucket-server", hostname: "bitbucket.example.com" })
    const url = new URL("https://bitbucket.example.com/users/jdoe/repos/widget/browse/dir/app.js?at=refs%2Fheads%2Fmain")
    assert.deepEqual(forge.parseUrl(url), {
        projectKey: "~jdoe",
        repoSlug: "widget",
        filepath: "dir/app.js",
        origin: "https://bitbucket.example.com",
    })
})

test("bitbucket-server addresses a personal repo as ~userSlug in the API but /users on the web", () => {
    const forge = buildSelfHostedForge({ type: "bitbucket-server", hostname: "bitbucket.example.com" })
    const info = { projectKey: "~jdoe", repoSlug: "widget", origin: "https://bitbucket.example.com" }
    assert.equal(
        forge.listPRsUrl(info),
        "https://bitbucket.example.com/rest/api/latest/projects/~jdoe/repos/widget/pull-requests?state=OPEN&limit=100")
    assert.equal(
        forge.prWebUrl(info, 7),
        "https://bitbucket.example.com/users/jdoe/repos/widget/pull-requests/7")
})

test("bitbucket-server pullRequests and filenames unwrap the paginated envelopes", () => {
    const forge = buildSelfHostedForge({ type: "bitbucket-server", hostname: "bitbucket.example.com" })
    assert.deepEqual(forge.pullRequests({ values: [{ id: 1 }, { id: 2 }] }), [{ id: 1 }, { id: 2 }])
    const changes = { values: [
        { path: { toString: "a.js" } },
        { path: { toString: "dir/b.js" } },
    ] }
    assert.deepEqual(forge.filenames(changes), ["a.js", "dir/b.js"])
})

test("the public instance and a self-hosted instance share one family", () => {
    // the inversion: gitlab.com is itself an instanceOf the GitLab family, the
    // same family a self-hosted GitLab is built from, so they share a prototype
    const selfHosted = buildSelfHostedForge({ type: "gitlab", hostname: "gitlab.example.com" })
    assert.equal(Object.getPrototypeOf(gitlab), Object.getPrototypeOf(selfHosted))

    const selfHostedForgejo = buildSelfHostedForge({ type: "forgejo", hostname: "git.example.com" })
    assert.equal(Object.getPrototypeOf(codeberg), Object.getPrototypeOf(selfHostedForgejo))
})

test("forgeForHostname matches a configured self-hosted instance", () => {
    const instances = [{ type: "gitlab", hostname: "gitlab.example.com" }]
    const forge = forgeForHostname("gitlab.example.com", instances)
    assert.equal(forge.base_url, "https://gitlab.example.com/api/v4")
    assert.equal(forge.selfHosted, true)
})

test("forgeForHostname prefers a static forge over instances", () => {
    const instances = [{ type: "gitlab", hostname: "github.com" }]
    assert.equal(forgeForHostname("github.com", instances), github)
})

test("forgeForHostname matches a self-hosted instance by exact hostname only", () => {
    const instances = [{ type: "forgejo", hostname: "git.example.com" }]
    assert.equal(forgeForHostname("other.example.com", instances), null)
})

//
// Gerrit (review server paired with a code-hosting mirror)
//
const gerritInstance = {
    type: "gerrit",
    hostname: "git.example.com",
    reviewUrl: "https://review.example.com",
    mirrorType: "forgejo",
}

test("buildGerritForge returns null on an incomplete or invalid config", () => {
    assert.equal(buildGerritForge({ ...gerritInstance, reviewUrl: undefined }), null)
    assert.equal(buildGerritForge({ ...gerritInstance, reviewUrl: "not a url" }), null)
    assert.equal(buildGerritForge({ ...gerritInstance, mirrorType: "unknown" }), null)
})

test("gerrit parses browse URLs with the mirror family's layout", () => {
    const forge = buildGerritForge(gerritInstance)
    const info = forge.parseUrl(
        new URL("https://git.example.com/ops/deploy/src/branch/main/roles/web/tasks.yml"))
    assert.deepEqual(info, {
        projectKey: "ops",
        repoSlug: "deploy",
        filepath: "roles/web/tasks.yml",
        origin: "https://git.example.com",
    })
})

test("gerrit takes the project name from a GitLab mirror's nested path", () => {
    const forge = buildGerritForge({ ...gerritInstance, mirrorType: "gitlab" })
    const info = forge.parseUrl(
        new URL("https://git.example.com/group/sub/proj/-/blob/main/a/b.py"))
    assert.equal(forge.prWebUrl(info, 42),
        "https://review.example.com/c/group/sub/proj/+/42")
})

test("gerrit.changesUrl queries the review server for the open changes touching the file", () => {
    const forge = buildGerritForge(gerritInstance)
    const info = forge.parseUrl(
        new URL("https://git.example.com/ops/deploy/src/branch/main/roles/web/tasks.yml"))
    assert.equal(forge.changesUrl(info),
        "https://review.example.com/changes/?q=" +
        encodeURIComponent('status:open project:ops/deploy file:"roles/web/tasks.yml"') +
        "&n=100")
})

test("gerrit.changesUrl uses the authenticated /a/ endpoint with credentials", () => {
    const forge = buildGerritForge(gerritInstance)
    const info = forge.parseUrl(
        new URL("https://git.example.com/ops/deploy/src/branch/main/f.js"))
    assert.match(forge.changesUrl(info, true),
        /^https:\/\/review\.example\.com\/a\/changes\/\?q=/)
})

test("gerrit.changesUrl offsets a follow-up page with the S parameter", () => {
    const forge = buildGerritForge(gerritInstance)
    const info = forge.parseUrl(
        new URL("https://git.example.com/ops/deploy/src/branch/main/f.js"))
    assert.match(forge.changesUrl(info, false, 100), /&n=100&S=100$/)
    // the first page carries no offset
    assert.doesNotMatch(forge.changesUrl(info), /&S=/)
})

test("parseGerritJson strips the XSSI prefix", () => {
    const body = ")]}'\n" + JSON.stringify([{ _number: 4211 }, { _number: 199 }])
    assert.deepEqual(parseGerritJson(body), [{ _number: 4211 }, { _number: 199 }])
})

test("parseGerritJson handles an empty change list", () => {
    assert.deepEqual(parseGerritJson(")]}'\n[]"), [])
})

test("gerrit.findPRsForFile returns the change numbers in one query", async () => {
    const realFetch = globalThis.fetch
    const realRequest = globalThis.Request

    const requested = []
    globalThis.Request = class { constructor(url, opts) { this.url = url; this.opts = opts } }
    globalThis.fetch = async request => {
        requested.push(request)
        return {
            ok: true,
            text: async () => ")]}'\n" + JSON.stringify([{ _number: 4211 }, { _number: 199 }]),
        }
    }

    try {
        const forge = buildGerritForge(gerritInstance)
        const info = forge.parseUrl(
            new URL("https://git.example.com/ops/deploy/src/branch/main/f.js"))

        // anonymous: /changes/ endpoint
        assert.deepEqual(await forge.findPRsForFile(info), [4211, 199])
        assert.match(requested[0].url, /\/changes\/\?q=/)

        // authenticated: /a/changes/ endpoint, headers forwarded
        const headers = forge.authHeader("user:http-password")
        assert.deepEqual(await forge.findPRsForFile(info, headers), [4211, 199])
        assert.match(requested[1].url, /\/a\/changes\/\?q=/)
        assert.deepEqual(requested[1].opts.headers, headers)
    } finally {
        globalThis.fetch = realFetch
        globalThis.Request = realRequest
    }
})

test("gerrit.findPRsForFile follows the _more_changes pagination", async () => {
    const realFetch = globalThis.fetch
    const realRequest = globalThis.Request

    // two pages: the first flags a truncated result on its last change
    const pages = [
        [{ _number: 1 }, { _number: 2, _more_changes: true }],
        [{ _number: 3 }],
    ]
    const requested = []
    globalThis.Request = class { constructor(url) { this.url = url } }
    globalThis.fetch = async request => {
        requested.push(request.url)
        return {
            ok: true,
            text: async () => ")]}'\n" + JSON.stringify(pages[requested.length - 1]),
        }
    }

    try {
        const forge = buildGerritForge(gerritInstance)
        const info = forge.parseUrl(
            new URL("https://git.example.com/ops/deploy/src/branch/main/f.js"))
        assert.deepEqual(await forge.findPRsForFile(info), [1, 2, 3])
        // the second page is requested with the offset of the changes seen
        assert.equal(requested.length, 2)
        assert.doesNotMatch(requested[0], /&S=/)
        assert.match(requested[1], /&S=2$/)
    } finally {
        globalThis.fetch = realFetch
        globalThis.Request = realRequest
    }
})

test("gerrit.findPRsForFile throws on a non-ok response", async () => {
    const realFetch = globalThis.fetch
    const realRequest = globalThis.Request

    globalThis.Request = class { constructor(url) { this.url = url } }
    globalThis.fetch = async () => ({ ok: false, status: 403, statusText: "Forbidden" })

    try {
        const forge = buildGerritForge(gerritInstance)
        const info = forge.parseUrl(
            new URL("https://git.example.com/ops/deploy/src/branch/main/f.js"))
        await assert.rejects(forge.findPRsForFile(info),
            /Failed to query the review server: \[403\] Forbidden/)
    } finally {
        globalThis.fetch = realFetch
        globalThis.Request = realRequest
    }
})

test("gerrit.prWebUrl links to the change on the review server", () => {
    const forge = buildGerritForge(gerritInstance)
    const info = forge.parseUrl(
        new URL("https://git.example.com/ops/deploy/src/branch/main/f.js"))
    assert.equal(forge.prWebUrl(info, 4211), "https://review.example.com/c/ops/deploy/+/4211")
})

test("gerrit.authHeader sends the credentials as HTTP Basic", () => {
    const forge = buildGerritForge(gerritInstance)
    assert.deepEqual(forge.authHeader("user:http-password"),
        { Authorization: `Basic ${btoa("user:http-password")}` })
})

test("gerrit queries the review host, not the browsed mirror", () => {
    const forge = buildGerritForge(gerritInstance)
    assert.equal(forge.permissionHostname, "review.example.com")
})

test("selfHostedTypes offers gerrit; gerritMirrorTypes offers the mirror layouts", () => {
    assert.ok(selfHostedTypes().some(t => t.type === "gerrit"))
    // gerrit itself cannot be a mirror; gitiles is mirror-only, so it is
    // offered here but not as a standalone self-hosted type
    const mirrors = gerritMirrorTypes().map(t => t.type)
    assert.deepEqual(mirrors, ["gitlab", "forgejo", "bitbucket-server", "gitiles"])
    assert.ok(!selfHostedTypes().some(t => t.type === "gitiles"))
})

//
// Gitiles mirror layout
//
const gitilesInstance = {
    type: "gerrit",
    hostname: "go.googlesource.com",
    reviewUrl: "https://go-review.googlesource.com",
    mirrorType: "gitiles",
}

test("gitiles mirror parses a full-ref file URL", () => {
    const forge = buildGerritForge(gitilesInstance)
    const info = forge.parseUrl(
        new URL("https://go.googlesource.com/go/+/refs/heads/master/src/net/http/server.go"))
    assert.deepEqual(info, {
        projectPath: "go",
        filepath: "src/net/http/server.go",
        origin: "https://go.googlesource.com",
    })
})

test("gitiles mirror parses a single-segment ref (branch, tag or commit)", () => {
    const forge = buildGerritForge(gitilesInstance)
    const byBranch = forge.parseUrl(
        new URL("https://go.googlesource.com/go/+/master/src/net/http/server.go"))
    assert.equal(byBranch.filepath, "src/net/http/server.go")

    const byCommit = forge.parseUrl(
        new URL("https://go.googlesource.com/go/+/2c1b5130aa3c30e11146dbcf7fca4bcf6de74dd2/README.md"))
    assert.equal(byCommit.filepath, "README.md")
})

test("gitiles mirror keeps a multi-segment project path", () => {
    const forge = buildGerritForge({
        ...gitilesInstance,
        hostname: "android.googlesource.com",
        reviewUrl: "https://android-review.googlesource.com",
    })
    const info = forge.parseUrl(new URL(
        "https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/Activity.java"))
    assert.equal(info.projectPath, "platform/frameworks/base")
    assert.equal(info.filepath, "core/java/android/app/Activity.java")
    assert.equal(forge.prWebUrl(info, 321),
        "https://android-review.googlesource.com/c/platform/frameworks/base/+/321")
})

test("gitiles mirror rejects non-file pages", () => {
    const forge = buildGerritForge(gitilesInstance)
    // repo home, ref-only tree root, log view
    assert.equal(forge.parseUrl(new URL("https://go.googlesource.com/go")), null)
    assert.equal(forge.parseUrl(new URL("https://go.googlesource.com/go/+/refs/heads/master")), null)
    assert.equal(forge.parseUrl(new URL("https://go.googlesource.com/go/+log/refs/heads/master/src")), null)
})

test("gitiles mirror queries the review project by its full path", () => {
    const forge = buildGerritForge(gitilesInstance)
    const info = forge.parseUrl(
        new URL("https://go.googlesource.com/go/+/refs/heads/master/src/net/http/server.go"))
    assert.equal(forge.changesUrl(info),
        "https://go-review.googlesource.com/changes/?q=" +
        encodeURIComponent('status:open project:go file:"src/net/http/server.go"') +
        "&n=100")
    assert.equal(forge.prWebUrl(info, 628575),
        "https://go-review.googlesource.com/c/go/+/628575")
})

test("forgeForHostname matches a gerrit instance by its mirror hostname", () => {
    const forge = forgeForHostname("git.example.com", [gerritInstance])
    assert.equal(forge.selfHosted, true)
    assert.equal(forge.type, "gerrit")
    assert.equal(forge.base_url, "https://review.example.com")
})

test("forgeForHostname returns null for an incomplete gerrit instance", () => {
    const instances = [{ type: "gerrit", hostname: "git.example.com" }]
    assert.equal(forgeForHostname("git.example.com", instances), null)
})
