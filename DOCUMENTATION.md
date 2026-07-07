# Documentation

A browser WebExtension (Manifest V3) that answers the reverse of the usual pull
request question: instead of *"which files does this PR change?"*, it tells you
**"which open pull requests change this file?"**

## Table of contents

- [Overview](#overview)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [Usage](#usage)
- [Authentication](#authentication)
- [Forges](#forges)
- [Internationalization](#internationalization)
- [Development](#development)
- [Install](#install)
- [Troubleshooting](#troubleshooting)

## Overview

See the [README overview](README.md#overview) section.

## How it works

The extension has two parts that communicate through per-tab results in
`browser.storage.session` (configuration — tokens and self-hosted instances —
lives in `browser.storage.local`).

It runs on both Firefox and Chrome from a single source tree:

- the manifest declares both `background.scripts` (Firefox event page) and
  `background.service_worker` (Chrome); each browser reads the key it supports;
- `browser.js` resolves the WebExtension API namespace — Firefox's standard
  `browser` or Chrome's `chrome` (whose MV3 APIs also return promises) — so the
  rest of the code calls `browser.*` everywhere.

### Background

Runs on every tab update:

1.   **Detect the forge** by hostname (exact match or subdomain)
2.   **Parse the URL**: extract `projectKey`, `repoSlug` and `filepath`
3.   **Load the auth headers** for the forge from the stored token (if any)
4.   **Promise chain**: list PRs, get files, keep PRs including the file —
     following the forge's API pagination, so every page of PRs and files is
     seen. The per-PR file fetches run concurrently, capped at 10 in flight
     so a repo with many open PRs doesn't trip forge abuse protections
5.   **Render**: set the toolbar badge text and store the result under the
     tab's key in `browser.storage.session` — `{ prs }`, or `{ error }` when a
     request failed. Per-tab keys keep concurrent tabs from clobbering each
     other; the key is dropped when the tab closes or loads a new page.

### Popup

On open, the popup:

1.   shows a localized **loading state**
2.   reads the active tab's result from session storage:
    -   `{ prs }`: renders the PR list (or a localized **empty** state when no
        PR touches the file)
    -   `{ error }`: shows a localized **error** state
    -   nothing stored yet: the background is still fetching — keeps the
        loading state and renders when the result lands.

## Project layout

```
.
├── manifest.json          # MV3 manifest
├── background.js          # service worker: fetch PRs, match file, set badge
├── browser.js             # cross-browser WebExtension API shim (browser/chrome)
├── i18n.js                # shared localize() for the popup and options pages
├── storage.js             # shared storage.local helpers (self-hosted instances)
├── forges.js              # per-forge API endpoint config
├── popup/
│   ├── popup.html         # popup markup
│   ├── popup.css          # popup page styles
│   └── popup.js           # popup logic (read storage, render)
├── options/
│   ├── options.html       # options page markup
│   ├── options.css        # options page styles
│   └── options.js         # options logic (per-forge token fields)
├── _locales/
│   ├── template.json      # empty key template for new locales
│   ├── en/messages.json   # English (default locale)
│   └── fr/messages.json   # French
├── static/
│   ├── icon-*.png         # toolbar / store icons
│   └── icon.svg           # source icon
├── tests/                 # test suite (node --test), one file per module
├── package.json           # npm scripts + dev dependencies (ESLint, web-ext)
├── eslint.config.js       # ESLint flat config
├── .web-ext-config.mjs    # web-ext config: files to keep out of the package
└── .github/               # CI workflows (lint, test, build) + dependabot
```

## Usage

1.   Install the extension
2.   Open a file page on a supported forge
3.   The toolbar badge shows the count of open PRs touching that file
4.   Click the toolbar icon to open the popup and follow a PR link.

A badge of `err` means a request failed (often the rate limit — see below);
check the service-worker console for details.

## Authentication

Authentication is **optional**. Without a token, the extension calls the forge
API anonymously. Configuring a token raises the API rate limit and lets the
extension see private repositories the token can access.

To set a token, open the extension's **options page** (the *Settings* /
*Preferences* / *Options* entry of the extension in the browser) and paste a
forge token into its field. Tokens are saved in `browser.storage.local`, so
they stay **on the device only** and are never synced or sent anywhere except
as an `Authorization` header to that forge's API.

The options page is forge-agnostic: it renders one token field per forge that
declares authentication support (see `authForges()` in `forges.js`), so a new
authenticated forge needs no options-page change. Self-hosted instances (see
[Forges](#forges)) get their own token field too, keyed per instance.

For GitHub, create a [personal access token][gh-token] (classic or
fine-grained) — no scope is required for public repositories; grant repository
read access for private ones. For Bitbucket Cloud, create a
[repository, project or workspace access token][bb-token] (or an API token)
with pull-request read access. For Codeberg, create an [access token][cb-token]
in your account settings with repository read scope. For GitLab, create a
[personal or project access token][gl-token] with the `read_api` scope.

[gh-token]: https://github.com/settings/tokens
[bb-token]: https://support.atlassian.com/bitbucket-cloud/docs/access-tokens/
[cb-token]: https://docs.codeberg.org/advanced/access-token/
[gl-token]: https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html

## Forges

Forge endpoints are configured in `forges.js`, which defines one **adapter**
per forge that normalizes its API and URL quirks behind a common interface,
plus a `forgeForHostname()` registry lookup. Single-host forges (GitHub,
Bitbucket) are plain adapter objects; multi-host forges (GitLab, Forgejo/Gitea)
are *families* whose instances — public and self-hosted alike — are built with
`instanceOf()` (see [Families and self-hosted forges](#families-and-self-hosted-forges)).

Here is the interface for each forge:

| Member            | Purpose                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `label`           | human-readable forge name                                                                          |
| `hostnames`       | array of hostnames matched against the page, exactly or as a subdomain (one per family instance)   |
| `base_url`        | API root URL the endpoint builders are hung off of                                                 |
| `parseUrl`        | `(URL) → { projectKey, repoSlug, filepath, origin }` or `null`                                     |
| `listPRsUrl`      | API endpoint listing the repo's open PRs                                                           |
| `pullRequests`    | `(listResponse) → array of PR objects` (unwraps paginated envelopes)                               |
| `filesUrl`        | API endpoint listing a PR's modified files                                                         |
| `filenames`       | filenames touched by a PR, from the files-endpoint response                                        |
| `prNumber`        | identifier of a PR (used in URLs and displayed)                                                    |
| `prWebUrl`        | web (non-API) URL of a PR, for the popup links                                                     |
| `nextPageUrl`     | `(response, data) → URL` of the next page of a paginated API response, or `null` on the last page  |
| `rateLimit`       | optional `{ header }`: response header carrying the remaining request quota; `null` if unsupported |
| `tokenStorageKey` | optional `storage.local` key holding the user's token; omit for no auth                            |
| `authHeader`      | optional `(token) → headers` sent with API requests; omit for no auth                              |
| `findPRsForFile`  | optional async `(info, headers) → [prNumbers]`: a single query answering "which open PRs/changes touch this file", bypassing the list + per-PR fan-out |
| `permissionHostname` | optional hostname the adapter queries when it differs from the browsed page's (a separate review server); drives the permission check |

A forge that omits `tokenStorageKey`/`authHeader` simply stays unauthenticated;
declaring both opts it into the [Authentication](#authentication) flow and the
options-page token field.

So, to add a new forge:

- in `forges.js`, create a new object implementing this interface
- in `forges.js`, add the forge to `staticForges`
- in `manifest.json`, add a `host_permissions` entry
- in `tests/forges.test.js`, add tests.

Supported forges:

- **GitHub**: https://docs.github.com/en/rest/pulls
- **Bitbucket** (Cloud): https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/
- **Codeberg** (Forgejo, Gitea-compatible API): https://forgejo.org/docs/latest/user/api-usage/
- **GitLab**: https://docs.gitlab.com/ee/api/merge_requests.html.

### Families and self-hosted forges

A forge's API and URL layout are the same across every host running the same
software, so `forges.js` factors that shared logic into a *family* and builds
concrete adapters from it with `instanceOf(family, { hostname, … })`. Both the
built-in public forges and the user's self-hosted forges are built this way, so
a self-hosted forge is just an `instanceOf` created at runtime by
`buildSelfHostedForge()` from an instance the user configured.

Users add instances (a hostname and which software family it runs) on the
options page; they are stored under `selfHostedInstances` in
`browser.storage.local`, and `forgeForHostname()` matches a page against the
built-in forges first, then those instances.

Because Manifest V3 cannot declare arbitrary hosts up front, the options page
**requests the host permission** for an instance when it is added and releases
it on removal (both need `optional_host_permissions`); the background script
skips an instance until its permission is granted.

Supported self-hosted software:

- **GitLab** (CE/EE): https://docs.gitlab.com/ee/api/merge_requests.html
- **Forgejo / Gitea**: https://forgejo.org/docs/latest/user/api-usage/
- **Bitbucket Server / Data Center**: https://developer.atlassian.com/server/bitbucket/rest/latest/
  (self-hosted only — a different API from Bitbucket Cloud)
- **Gerrit**: https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html
  (a review server paired with a code-hosting mirror — see below)

### Review-backed forges (Gerrit)

Some deployments split the two roles a forge normally holds: the code is
*browsed* on one host (a mirror) while the reviews live on a separate review
server, where the extension must send its queries. Such an instance is
configured with three pieces: the mirror hostname (matched against the page),
the software the mirror runs (which URL layout to parse — any supported
family, or the mirror-only Gitiles layout of the `*.googlesource.com` code
browsers), and the review server URL (stored as
`{ type, hostname, mirrorType, reviewUrl }`).

Two interface members carry the mechanism, and are not specific to any review
tool:

- `findPRsForFile` — a review server can answer "which open changes touch this
  file" in a single query, so the adapter skips the PR list + per-PR files
  fan-out entirely (`background.js` takes this fast path whenever the member
  exists);
- `permissionHostname` — the queried host is the review server, not the
  browsed page, so the host permission requested on add (and checked by the
  background) targets it.

For Gerrit specifically, `buildGerritForge()` implements the interface: it
queries `GET {reviewUrl}/changes/?q=status:open project:<path> file:"<path>"`
(the mirror's repo path is the review project name), strips the `)]}'` XSSI
prefix Gerrit puts before its JSON, and links each change to
`{reviewUrl}/c/<project>/+/<number>`. A truncated result page is flagged by
`_more_changes` on its last change and followed with the `S` offset parameter,
so more than a page's worth of open changes is still counted in full. With
credentials configured (`username:HTTP-password`, sent as HTTP Basic), the
query goes through the authenticated `/a/` endpoint prefix instead.

#### Configuring a pairing (example: OpenDev)

OpenDev (where OpenStack development happens) hosts its code on a Gitea
mirror, `opendev.org`, and reviews it on a separate Gerrit,
`review.opendev.org`. To register the pairing:

1. open the extension's **options page**;
2. under *Self-hosted forges*, pick the **Gerrit** type — two extra fields
   appear;
3. enter the **code-hosting hostname** you browse files on: `opendev.org`;
4. pick the software that site runs — **Forgejo / Gitea** here — so the
   extension can parse its file URLs;
5. enter the **review server URL**: `https://review.opendev.org`;
6. click *Add* and **grant the permission** the browser asks for — it targets
   the review server, the only host the extension queries.

Then browse any file on the mirror, e.g.
`https://opendev.org/openstack/nova/src/branch/master/nova/compute/api.py`:
the toolbar badge shows the number of open changes touching it, and the popup
links each one into the review UI. Public review servers like OpenDev's answer
anonymously; for one that requires sign-in, put `username:HTTP-password` (the
HTTP credentials from the Gerrit account settings) in the instance's
credentials field.

The same process covers Gitiles-fronted deployments — for the Go project, pair
`go.googlesource.com` (software: **Gitiles**) with
`https://go-review.googlesource.com`.

To support new self-hosted software, define its family and add it to
`selfHostedFamilies`.

## Internationalization

Translations live in `_locales/<lang>/messages.json`. The default locale is
`en` (see `manifest.json`), but the browser picks the locale from the user's
language if it exists.

Strings are resolved two ways:

- `__MSG_<key>__` placeholders in page markup, swapped in at load time by the
  shared `localize()` in `i18n.js` (used by both the popup and options pages)
- `browser.i18n.getMessage("<key>")` (in `popup.js` and `options.js`).

To add a locale:

- copy `_locales/template.json` to `_locales/<lang>/messages.json`
- fill every `message` field.

If you add a translatable string:

- add the string to `_locales/template.json`
- update `_locales/en/messages.json` with a description and a translation

## Development

The dev tools (ESLint, web-ext) are npm dev dependencies; install them once
with `npm ci`. Then:

- `npm test` — run the test suite (`npm run test:coverage` adds coverage)
- `npm run lint` — lint the scripts with ESLint
- `npm run lint:webext` — validate the extension with `web-ext lint`. It
  always warns that Firefox ignores the Chrome-only
  `background.service_worker` manifest key; the CI lint workflow strips that
  key first and escalates any other warning to an error
- `npm run build` — package the extension into `web-ext-artifacts/`
  (the development files listed in `.web-ext-config.mjs` stay out)

The CI workflows run the same scripts: lint and test on every push, build on
the main branch and tags.

## Install
### Firefox

Load the repository folder as a temporary add-on:
1. `about:debugging`
2. *This Firefox*
3. *Load Temporary Add-on*
4. select `manifest.json`.

See https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/.

### Chrome

Load the repository folder as an unpacked extension:

1. `chrome://extensions`
2. enable *Developer mode*
3. *Load unpacked*
4. select the repository folder.

See https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked.

## Troubleshooting

| Symptom                    | Likely cause / fix                                                             |
| -------------------------- | ------------------------------------------------------------------------------ |
| Badge shows `err`          | A request failed — often the rate limit. Check the console.                    |
| Badge/popup never updates  | The page URL doesn't match the expected file path.                             |
| Rate limit reached quickly | Low anonymous API quota — set a token (see [Authentication](#authentication)). |
| Private repo shows no PRs  | Set a token whose access covers that repository.                               |
