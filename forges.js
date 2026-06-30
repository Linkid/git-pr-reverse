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

// registry of forges matched by a static hostname
const staticForges = [github]

// pick a forge adapter for a page hostname (null if none matches).
export function forgeForHostname(hostname) {
    return staticForges.find(f => f.hostnames.some(h => hostname.includes(h))) || null
}

// forges that support authentication (declare both a token storage key and a
// header builder); the options page renders one token field per such forge.
export function authForges() {
    return staticForges.filter(f => f.tokenStorageKey && f.authHeader)
}
