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
//   rateLimit   optional { url, header, remaining(data) }; null if the forge
//               exposes no rate-limit endpoint
//   tokenStorageKey  optional storage.local key holding the user's API token;
//                    omit if the forge supports no authentication
//   authHeader  optional (token) -> headers object sent with API requests when
//               a token is configured; omit if the forge supports no auth

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
        return `${this.base_url}/repos/${info.projectKey}/${info.repoSlug}/pulls`
    },

    // the list endpoint already returns a JSON array of PRs
    pullRequests(data) {
        return data
    },

    filesUrl(info, pr) {
        return `${this.base_url}/repos/${info.projectKey}/${info.repoSlug}/pulls/${this.prNumber(pr)}/files`
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

    rateLimit: {
        url: "https://api.github.com/rate_limit",
        header: "x-ratelimit-remaining",
        remaining: (data) => data.resources.core.remaining,
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
        return `${this.base_url}/repositories/${info.projectKey}/${info.repoSlug}/pullrequests`
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
        return `${this.base_url}/repos/${info.projectKey}/${info.repoSlug}/pulls`
    },

    // the list endpoint returns a JSON array of PRs
    pullRequests(data) {
        return data
    },

    filesUrl(info, pr) {
        return `${this.base_url}/repos/${info.projectKey}/${info.repoSlug}/pulls/${this.prNumber(pr)}/files`
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
        // /merge_requests defaults to every state, so filter to the open ones
        return `${this.base_url}/projects/${this.projectId(info)}/merge_requests?state=opened`
    },

    // the list endpoint returns a JSON array of merge requests
    pullRequests(data) {
        return data
    },

    filesUrl(info, pr) {
        return `${this.base_url}/projects/${this.projectId(info)}/merge_requests/${this.prNumber(pr)}/diffs`
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
        // the pull-requests endpoint defaults to OPEN, but be explicit
        return `${this.base_url}/projects/${info.projectKey}/repos/${info.repoSlug}/pull-requests?state=OPEN`
    },

    // the list endpoint wraps the PRs in a paginated envelope
    pullRequests(data) {
        return data.values
    },

    filesUrl(info, pr) {
        return `${this.base_url}/projects/${info.projectKey}/repos/${info.repoSlug}/pull-requests/${this.prNumber(pr)}/changes`
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

    // Bitbucket Server exposes no simple rate-limit endpoint.
    rateLimit: null,

    // Bitbucket Server accepts an HTTP access token as a Bearer credential.
    authHeader(token) {
        return { Authorization: `Bearer ${token}` }
    },
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
// page dropdown: [{ type, label }, …]
export function selfHostedTypes() {
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

// build a forge adapter for a configured instance ({ type, hostname }); the
// same instanceOf() used for the public instances, tagged so the background can
// tell it needs an optional host permission. Returns null for an unknown type.
export function buildSelfHostedForge({ type, hostname }) {
    const family = selfHostedFamilies[type]
    if (!family) return null

    const forge = instanceOf(family, {
        hostname,
        tokenStorageKey: selfHostedTokenKey(hostname),
    })
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
