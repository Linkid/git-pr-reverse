// Each forge is an adapter that normalizes its API + URL quirks behind a common
// interface used by background.js and popup.js. A single-host forge is a plain
// adapter object here; a forge whose software can run on many hosts is
// expressed as a *family* holding the shared logic, from which the public
// instance and any self-hosted instances are built with instanceOf() (see
// below). Adding a forge (plus a host permission) leaves background.js /
// popup.js unchanged.
//
// Adapter interface:
//   label       human-readable forge name, shown in the options page UI
//   hostnames   array of hostnames matched against the page hostname, exactly
//               or as a subdomain (for a family instance this is its single
//               configured hostname)
//   base_url    API root URL the endpoint builders below are hung off of
//   parseUrl    (URL) -> { projectKey, repoSlug, filepath, origin } | null
//   listPRsUrl  (info) -> API endpoint listing the repo's open pull requests
//   pullRequests (listResponse) -> array of PR objects from the list response
//   filesUrl    (info, pr) -> API endpoint listing a PR's modified files
//   filenames   (filesResponse) -> array of filenames touched by a PR
//   prNumber    (pr) -> identifier of a PR (used in URLs and displayed)
//   prWebUrl    (info, prNumber) -> web (non-API) URL of a PR, for popup links
//   nextPageUrl (response, data) -> URL of the next page of a paginated API
//               response, or null on the last page
//   rateLimit   optional { header }: the response header carrying the
//               remaining request quota; null if the forge exposes none
//   tokenStorageKey  optional storage.local key holding the user's API token;
//                    omit if the forge supports no authentication
//   authHeader  optional (token) -> headers object sent with API requests when
//               a token is configured; omit if the forge supports no auth

// parse an RFC 8288 `Link` response header and return the rel="next" URL
// (null when there is no next page). Shared by the forges that paginate
// through this standard header (GitHub, GitLab, Forgejo/Gitea).
function nextFromLinkHeader(response) {
    const link = response.headers.get("link")
    if (!link) return null

    for (const part of link.split(",")) {
        const m = part.match(/<([^>]+)>\s*;.*rel="?next"?/)
        if (m) return m[1]
    }
    return null
}

// API docs: https://docs.github.com/en/rest/pulls
export const github = {
    label: "GitHub",
    hostnames: ["github.com"],
    base_url: "https://api.github.com",

    parseUrl(url) {
        const m = url.pathname.match(
            "^/(?<projectKey>[^/]+)/(?<repoSlug>[^/]+)/[^/]+/[^/]+/(?<filepath>.+)$")
        if (!m) return null
        return { ...m.groups, origin: url.origin }
    },

    listPRsUrl(info) {
        // per_page raises the page size to the API maximum (default is 30)
        return `${this.base_url}/repos/${info.projectKey}/${info.repoSlug}/pulls?per_page=100`
    },

    // the list endpoint already returns a JSON array of PRs
    pullRequests(data) {
        return data
    },

    filesUrl(info, pr) {
        return `${this.base_url}/repos/${info.projectKey}/${info.repoSlug}/pulls/${this.prNumber(pr)}/files?per_page=100`
    },

    filenames(files) {
        return files.map(file => file.filename)
    },

    prNumber(pr) {
        return pr.number
    },

    prWebUrl(info, prNumber) {
        return `${info.origin}/${info.projectKey}/${info.repoSlug}/pull/${prNumber}`
    },

    // GitHub paginates through the standard Link response header
    nextPageUrl(response) {
        return nextFromLinkHeader(response)
    },

    rateLimit: {
        header: "x-ratelimit-remaining",
    },

    // GitHub accepts classic and fine-grained personal access tokens as a
    // Bearer credential. Authenticating raises the rate limit and grants
    // access to private repositories the token can see.
    tokenStorageKey: "githubToken",

    authHeader(token) {
        return { Authorization: `Bearer ${token}` }
    },
}

// API docs: https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/
// Bitbucket Cloud returns paginated `{ values: [...] }` envelopes and exposes a
// PR's touched files through the diffstat endpoint.
export const bitbucket = {
    label: "Bitbucket",
    hostnames: ["bitbucket.org"],
    base_url: "https://api.bitbucket.org/2.0",

    parseUrl(url) {
        // file view: /{workspace}/{repo}/src/{revision}/{filepath}
        const m = url.pathname.match(
            "^/(?<projectKey>[^/]+)/(?<repoSlug>[^/]+)/src/[^/]+/(?<filepath>.+)$")
        if (!m) return null
        return { ...m.groups, origin: url.origin }
    },

    listPRsUrl(info) {
        // pagelen raises the page size to the API maximum (default is 10)
        return `${this.base_url}/repositories/${info.projectKey}/${info.repoSlug}/pullrequests?pagelen=50`
    },

    // the list endpoint wraps the PRs in a paginated envelope
    pullRequests(data) {
        return data.values
    },

    filesUrl(info, pr) {
        return `${this.base_url}/repositories/${info.projectKey}/${info.repoSlug}/pullrequests/${this.prNumber(pr)}/diffstat`
    },

    filenames(files) {
        // diffstat entries carry the new path (or the old path for deletions)
        return files.values.map(file => (file.new || file.old).path)
    },

    prNumber(pr) {
        return pr.id
    },

    prWebUrl(info, prNumber) {
        return `${info.origin}/${info.projectKey}/${info.repoSlug}/pull-requests/${prNumber}`
    },

    // Bitbucket Cloud paginates in the body: the envelope carries the full
    // URL of the next page (absent on the last one)
    nextPageUrl(response, data) {
        return data.next ?? null
    },

    // Bitbucket Cloud exposes no simple rate-limit endpoint.
    rateLimit: null,

    // Bitbucket Cloud accepts a repository/workspace access token or an API
    // token as a Bearer credential.
    tokenStorageKey: "bitbucketToken",

    authHeader(token) {
        return { Authorization: `Bearer ${token}` }
    },
}

// Forge software can run on many hosts (a public instance plus any number of
// self-hosted ones), all speaking the same API with the same URL layout. That
// shared behaviour lives in a forge *family*; a concrete adapter is an
// *instance* of a family, differing only by hostname, API base URL and token
// key. instanceOf() specialises a family into an adapter — used both for the
// built-in public instances below and for the user's self-hosted instances (see
// buildSelfHostedForge). A family therefore owns every interface member except
// `label`, `hostnames`, `base_url` and `tokenStorageKey`, which the instance
// supplies.
//
// `apiPath` is the family's API root; appended to the instance origin it forms
// base_url, so the public and self-hosted instances share one code path.
function instanceOf(family, { hostname, label, tokenStorageKey }) {
    return Object.assign(Object.create(family), {
        label: label ?? hostname,
        hostnames: [hostname],
        base_url: `https://${hostname}${family.apiPath}`,
        tokenStorageKey,
    })
}

// Forgejo / Gitea family: speaks the Gitea-compatible REST API under /api/v1.
// API docs: https://forgejo.org/docs/latest/user/api-usage/
const forgejoFamily = {
    label: "Forgejo / Gitea",
    apiPath: "/api/v1",

    parseUrl(url) {
        // file view: /{owner}/{repo}/src/{branch|commit|tag}/{ref}/{filepath}
        const m = url.pathname.match(
            "^/(?<projectKey>[^/]+)/(?<repoSlug>[^/]+)/src/[^/]+/[^/]+/(?<filepath>.+)$")
        if (!m) return null
        return { ...m.groups, origin: url.origin }
    },

    listPRsUrl(info) {
        // limit raises the page size to the default API maximum (50)
        return `${this.base_url}/repos/${info.projectKey}/${info.repoSlug}/pulls?limit=50`
    },

    // the list endpoint returns a JSON array of PRs
    pullRequests(data) {
        return data
    },

    filesUrl(info, pr) {
        return `${this.base_url}/repos/${info.projectKey}/${info.repoSlug}/pulls/${this.prNumber(pr)}/files?limit=50`
    },

    filenames(files) {
        return files.map(file => file.filename)
    },

    prNumber(pr) {
        return pr.number
    },

    prWebUrl(info, prNumber) {
        return `${info.origin}/${info.projectKey}/${info.repoSlug}/pulls/${prNumber}`
    },

    // Forgejo/Gitea paginates through the standard Link response header
    nextPageUrl(response) {
        return nextFromLinkHeader(response)
    },

    // Forgejo/Gitea exposes no simple rate-limit endpoint.
    rateLimit: null,

    // Forgejo/Gitea accepts a personal access token via the `token` scheme.
    authHeader(token) {
        return { Authorization: `token ${token}` }
    },
}

// Codeberg is the public Forgejo instance.
export const codeberg = instanceOf(forgejoFamily, {
    hostname: "codeberg.org",
    label: "Codeberg",
    tokenStorageKey: "codebergToken",
})

// GitLab family: calls PRs "merge requests" and identifies a project by its
// full, URL-encoded path (namespaces can be nested: group/subgroup/project), so
// `info` carries a single `projectPath` rather than a projectKey / repoSlug
// pair. The `/-/` separator in web URLs delimits the project path from the
// route type (blob, merge_requests, …).
// API docs: https://docs.gitlab.com/ee/api/merge_requests.html
const gitlabFamily = {
    label: "GitLab",
    apiPath: "/api/v4",

    parseUrl(url) {
        // file view: /{group}/.../{project}/-/blob/{ref}/{filepath}
        const m = url.pathname.match(
            "^/(?<projectPath>.+?)/-/blob/[^/]+/(?<filepath>.+)$")
        if (!m) return null
        return { ...m.groups, origin: url.origin }
    },

    // the project is addressed by its URL-encoded full path
    projectId(info) {
        return encodeURIComponent(info.projectPath)
    },

    listPRsUrl(info) {
        // /merge_requests defaults to every state, so filter to the open ones;
        // per_page raises the page size to the API maximum (default is 20)
        return `${this.base_url}/projects/${this.projectId(info)}/merge_requests?state=opened&per_page=100`
    },

    // the list endpoint returns a JSON array of merge requests
    pullRequests(data) {
        return data
    },

    filesUrl(info, pr) {
        return `${this.base_url}/projects/${this.projectId(info)}/merge_requests/${this.prNumber(pr)}/diffs?per_page=100`
    },

    // a diff entry keeps new_path == old_path for deletions, so new_path is safe
    filenames(files) {
        return files.map(file => file.new_path)
    },

    // iid is the project-internal number shown in URLs (id is global)
    prNumber(pr) {
        return pr.iid
    },

    prWebUrl(info, prNumber) {
        return `${info.origin}/${info.projectPath}/-/merge_requests/${prNumber}`
    },

    // GitLab paginates through the standard Link response header
    nextPageUrl(response) {
        return nextFromLinkHeader(response)
    },

    // GitLab exposes rate-limit info only through response headers, not a
    // pollable endpoint.
    rateLimit: null,

    // GitLab accepts a personal or project access token via the PRIVATE-TOKEN
    // header. Authenticating grants access to private repositories.
    authHeader(token) {
        return { "PRIVATE-TOKEN": token }
    },
}

// gitlab.com is the public GitLab instance.
export const gitlab = instanceOf(gitlabFamily, {
    hostname: "gitlab.com",
    tokenStorageKey: "gitlabToken",
})

// Bitbucket Data Center / Server family: self-hosted only — Bitbucket Cloud
// (the `bitbucket` adapter above) is a separate product with a different API.
// Serves its REST API under /rest/api/latest and paginates in a `values` array.
// API docs: https://developer.atlassian.com/server/bitbucket/rest/latest/
const bitbucketServerFamily = {
    label: "Bitbucket Server / Data Center",
    apiPath: "/rest/api/latest",

    parseUrl(url) {
        // file view, project repo:  /projects/{projectKey}/repos/{repoSlug}/browse/{filepath}
        // file view, personal repo: /users/{userSlug}/repos/{repoSlug}/browse/{filepath}
        // (the branch/tag ref lives in the ?at= query, so filepath stays clean)
        const m = url.pathname.match(
            "^/(?<section>projects|users)/(?<owner>[^/]+)/repos/(?<repoSlug>[^/]+)/browse/(?<filepath>.+)$")
        if (!m) return null
        const { section, owner, repoSlug, filepath } = m.groups
        // the API addresses a personal repo as the ~{userSlug} project
        const projectKey = section === "users" ? `~${owner}` : owner
        return { projectKey, repoSlug, filepath, origin: url.origin }
    },

    listPRsUrl(info) {
        // the pull-requests endpoint defaults to OPEN, but be explicit;
        // limit raises the page size well above the default (25)
        return `${this.base_url}/projects/${info.projectKey}/repos/${info.repoSlug}/pull-requests?state=OPEN&limit=100`
    },

    // the list endpoint wraps the PRs in a paginated envelope
    pullRequests(data) {
        return data.values
    },

    filesUrl(info, pr) {
        return `${this.base_url}/projects/${info.projectKey}/repos/${info.repoSlug}/pull-requests/${this.prNumber(pr)}/changes?limit=100`
    },

    // each change carries the file path as `path.toString`
    filenames(changes) {
        return changes.values.map(change => change.path.toString)
    },

    prNumber(pr) {
        return pr.id
    },

    prWebUrl(info, prNumber) {
        // a personal repo (project key ~{userSlug}) lives under /users/{userSlug}
        const repoPath = info.projectKey.startsWith("~")
            ? `users/${info.projectKey.slice(1)}/repos/${info.repoSlug}`
            : `projects/${info.projectKey}/repos/${info.repoSlug}`
        return `${info.origin}/${repoPath}/pull-requests/${prNumber}`
    },

    // Bitbucket Server paginates in the body: the envelope carries isLastPage
    // and the start index of the next page, re-requested on the same URL
    nextPageUrl(response, data) {
        if (data.isLastPage || data.nextPageStart == null) return null
        const url = new URL(response.url)
        url.searchParams.set("start", data.nextPageStart)
        return url.toString()
    },

    // Bitbucket Server exposes no simple rate-limit endpoint.
    rateLimit: null,

    // Bitbucket Server accepts an HTTP access token as a Bearer credential.
    authHeader(token) {
        return { Authorization: `Bearer ${token}` }
    },
}

//
// Gerrit
//
// Gerrit is a code-review tool, not a code host: the code is *browsed* on a
// separate forge (a mirror running one of the families above) while the open
// changes live on the Gerrit review server. A Gerrit adapter therefore pairs
// two hosts — it borrows the mirror family's parseUrl to read the browse page,
// and queries the review server for the changes. Gerrit answers "which open
// changes touch this file" in a single query, exposed through the
// findPRsForFile fast-path interface member (see below); background.js calls
// it instead of the listPRsUrl + per-PR filesUrl fan-out.
//
// Additional interface members introduced for review-backed forges:
//   findPRsForFile      optional async (info, requestHeaders) -> [prNumbers];
//                       a direct query bypassing the list + per-PR fan-out
//   permissionHostname  optional hostname whose permission the adapter needs
//                       when it queries a host other than the browsed page's
//
// API docs: https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html

// Gerrit prefixes its JSON responses with a )]}' line against XSSI; strip it
// before parsing
export function parseGerritJson(text) {
    return JSON.parse(text.replace(/^\)\]\}'/, ""))
}

// the Gerrit project name of a browse page: the mirror's full repo path
// (owner/repo, or the nested project path on a GitLab mirror)
function gerritProject(info) {
    return info.projectPath ?? `${info.projectKey}/${info.repoSlug}`
}

// build a Gerrit adapter from a configured instance: `hostname` is the browse
// mirror matched against the page, `reviewUrl` the Gerrit origin queried for
// changes, `mirrorType` the family the mirror runs (selects the URL parsing).
// Returns null when the config is incomplete or the mirror type is unknown.
export function buildGerritForge({ hostname, reviewUrl, mirrorType }) {
    const mirror = selfHostedFamilies[mirrorType]
    if (!mirror || !reviewUrl) return null

    let reviewHostname
    try {
        reviewHostname = new URL(reviewUrl).hostname
    } catch {
        return null
    }

    return {
        label: "Gerrit",
        hostnames: [hostname],
        base_url: reviewUrl,
        // the adapter queries the review server, not the browsed mirror
        permissionHostname: reviewHostname,
        rateLimit: null,
        tokenStorageKey: selfHostedTokenKey(hostname),

        // browse pages have the mirror family's URL layout
        parseUrl(url) {
            return mirror.parseUrl(url)
        },

        // the query for the open changes touching the file — `start` skips the
        // changes already seen (Gerrit's S offset pagination); authenticated
        // requests go through Gerrit's /a/ endpoint prefix
        changesUrl(info, authenticated = false, start = 0) {
            const q = `status:open project:${gerritProject(info)} file:"${info.filepath}"`
            const path = authenticated ? "/a/changes/" : "/changes/"
            const offset = start > 0 ? `&S=${start}` : ""
            return `${this.base_url}${path}?q=${encodeURIComponent(q)}&n=100${offset}`
        },

        // fast path replacing the PR list + per-PR files fan-out. Gerrit flags
        // a truncated result on its last change (_more_changes); the next page
        // is the same query offset by the changes already fetched
        async findPRsForFile(info, requestHeaders = {}) {
            const authenticated = "Authorization" in requestHeaders
            const prs = []
            let more = true
            while (more) {
                const response = await fetch(new Request(
                    this.changesUrl(info, authenticated, prs.length),
                    { headers: requestHeaders }))
                if (!response.ok) {
                    throw new Error(`Failed to query the review server: [${response.status}] ${response.statusText}`)
                }
                const changes = parseGerritJson(await response.text())
                prs.push(...changes.map(change => this.prNumber(change)))
                more = changes.at(-1)?._more_changes === true
            }
            return prs
        },

        // _number is the change number shown in URLs (id is a long triplet)
        prNumber(change) {
            return change._number
        },

        // change links point at the Gerrit review UI
        prWebUrl(info, prNumber) {
            return `${this.base_url}/c/${gerritProject(info)}/+/${prNumber}`
        },

        // Gerrit authenticates REST calls with HTTP Basic credentials: the
        // username and the HTTP password generated in the account settings,
        // stored together as "user:http-password"
        authHeader(token) {
            return { Authorization: `Basic ${btoa(token)}` }
        },
    }
}

// registry of forges matched by a static hostname
const staticForges = [github, bitbucket, codeberg, gitlab]

// forges that support authentication (declare both a token storage key and a
// header builder); the options page renders one token field per such forge.
export function authForges() {
    return staticForges.filter(f => f.tokenStorageKey && f.authHeader)
}

//
// Self-hosted forges
//
// A self-hosted forge runs the same software as one of the families above, so
// it is simply another instanceOf() of that family — built at runtime from the
// hostname the user configured rather than hardcoded. Only forges expressed as
// a family can be self-hosted; a single-host adapter would need converting to a
// family first.
//
// `type` (stored with the user's instance config) selects the family.
const selfHostedFamilies = {
    gitlab: gitlabFamily,
    forgejo: forgejoFamily,
    "bitbucket-server": bitbucketServerFamily,
}

// software types selectable when adding a self-hosted instance, for the options
// page dropdown: [{ type, label }, …] — the families plus the review-backed
// Gerrit type (built by buildGerritForge rather than a family)
export function selfHostedTypes() {
    return [
        ...Object.entries(selfHostedFamilies).map(([type, family]) => ({
            type,
            label: family.label,
        })),
        { type: "gerrit", label: "Gerrit" },
    ]
}

// mirror softwares a Gerrit instance can pair with (the families whose URL
// layout the browse mirror may use), for the options page dropdown
export function gerritMirrorTypes() {
    return Object.entries(selfHostedFamilies).map(([type, family]) => ({
        type,
        label: family.label,
    }))
}

// storage.local key holding the (optional) token for a self-hosted instance;
// keyed by hostname so every instance keeps its own token
export function selfHostedTokenKey(hostname) {
    return `selfHostedToken:${hostname}`
}

// build a forge adapter for a configured instance; tagged so the background
// can tell it needs an optional host permission. A family type is the same
// instanceOf() used for the public instances; the gerrit type pairs two hosts
// and has its own factory. Returns null for an unknown type (or an incomplete
// gerrit config).
export function buildSelfHostedForge(instance) {
    const { type, hostname } = instance

    const forge = type === "gerrit"
        ? buildGerritForge(instance)
        : selfHostedFamilies[type] && instanceOf(selfHostedFamilies[type], {
            hostname,
            tokenStorageKey: selfHostedTokenKey(hostname),
        })
    if (!forge) return null

    return Object.assign(forge, { selfHosted: true, type })
}

// pick a forge adapter for a page hostname, considering both the built-in
// static forges and the user's configured self-hosted instances (null if none
// matches). Static forges win; they match the exact hostname or a subdomain of
// it — never a mere substring, so a hostile lookalike host (github.com.evil.example)
// or an unrelated self-hosted forge (mygithub.company.com) stays unmatched.
// Self-hosted instances are matched by exact hostname to avoid one instance
// shadowing another.
export function forgeForHostname(hostname, instances = []) {
    const staticForge = staticForges.find(f =>
        f.hostnames.some(h => hostname === h || hostname.endsWith(`.${h}`)))
    if (staticForge) return staticForge

    const instance = instances.find(i => i.hostname === hostname)
    return instance ? buildSelfHostedForge(instance) : null
}
