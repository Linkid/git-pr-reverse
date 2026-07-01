// Each forge is an adapter that normalizes its API + URL quirks behind a common
// interface used by background.js and popup.js. Adding a new forge is a new
// adapter object here (plus a host permission); background.js / popup.js stay
// unchanged.
//
// Adapter interface:
//   label       human-readable forge name, shown in the options page UI
//   hostnames   array of substrings matched against the page hostname (static
//               forges only; self-hosted forges are matched against the user's
//               configured instance list instead)
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

// Codeberg is a public instance of Forgejo (a Gitea fork), so it speaks the
// Gitea-compatible REST API served at https://codeberg.org/api/v1.
// API docs: https://forgejo.org/docs/latest/user/api-usage/
export const codeberg = {
    label: "Codeberg",
    hostnames: ["codeberg.org"],
    base_url: "https://codeberg.org/api/v1",

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

    // Codeberg exposes no simple rate-limit endpoint.
    rateLimit: null,

    // Codeberg accepts a personal access token via the Gitea `token` scheme.
    tokenStorageKey: "codebergToken",

    authHeader(token) {
        return { Authorization: `token ${token}` }
    },
}

// API docs: https://docs.gitlab.com/ee/api/merge_requests.html
// GitLab calls PRs "merge requests" and identifies a project by its full,
// URL-encoded path (namespaces can be nested: group/subgroup/project), so the
// adapter carries a single `projectPath` in `info` rather than a projectKey /
// repoSlug pair. The `/-/` separator in web URLs delimits the project path from
// the route type (blob, merge_requests, …).
export const gitlab = {
    label: "GitLab",
    hostnames: ["gitlab.com"],
    base_url: "https://gitlab.com/api/v4",

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
    tokenStorageKey: "gitlabToken",

    authHeader(token) {
        return { "PRIVATE-TOKEN": token }
    },
}

// registry of forges matched by a static hostname
const staticForges = [github, bitbucket, codeberg, gitlab]

// pick a forge adapter for a page hostname (null if none matches).
export function forgeForHostname(hostname) {
    return staticForges.find(f => f.hostnames.some(h => hostname.includes(h))) || null
}

// forges that support authentication (declare both a token storage key and a
// header builder); the options page renders one token field per such forge.
export function authForges() {
    return staticForges.filter(f => f.tokenStorageKey && f.authHeader)
}
