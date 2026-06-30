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
- [Install](#install)
- [Troubleshooting](#troubleshooting)

## Overview

See the [README overview](README.md#overview) section.

## How it works

The extension has two parts that communicate through `browser.storage.local`.

It runs on both Firefox and Chrome from a single source tree:
- the manifest declares both `background.scripts` (Firefox event page) and
  `background.service_worker` (Chrome); each browser reads the key it supports;
- `browser.js` resolves the WebExtension API namespace — Firefox's standard
  `browser` or Chrome's `chrome` (whose MV3 APIs also return promises) — so the
  rest of the code calls `browser.*` everywhere.

### Background

Runs on every tab update:

1.   **Parse the URL**: extract `projectKey`, `repoSlug` and `filepath`
2.   **Detect the forge** by hostname
3.   **Load the auth headers** for the forge from the stored token (if any)
4.   **Promise chain**: list PRs, get files, keep PRs including the file
5.   **Render**: set the toolbar badge text and stores `{ tabId, prs }` in
     `browser.storage.local`.

### Popup

On open, the popup:

1.   shows a localized **loading state**
2.   reads `{ tabId, prs }` from storage:
    -   if it matches the active tab, renders the PR list
    -   otherwise shows a localized **error** state
    -   if the list is empty, shows a localized **empty** state.

## Project layout

```
.
├── manifest.json          # MV3 manifest
├── background.js          # service worker: fetch PRs, match file, set badge
├── browser.js             # cross-browser WebExtension API shim (browser/chrome)
├── forges.js              # per-forge API endpoint config
├── popup/
│   ├── popup.html         # popup markup
│   ├── options.css        # popup page styles
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
authenticated forge needs no options-page change.

For GitHub, create a [personal access token][gh-token] (classic or
fine-grained) — no scope is required for public repositories; grant repository
read access for private ones.

[gh-token]: https://github.com/settings/tokens

## Forges

Forge endpoints are configured in `forges.js`, which defines one **adapter**
per forge that normalizes its API and URL quirks behind a common interface,
plus a `forgeForHostname()` registry lookup.

Here is the interface for each forge:

| Member       | Purpose                                                            |
| ------------ | ------------------------------------------------------------------ |
| `label`      | human-readable forge name                                          |
| `hostnames`  | array of hostnames (static forges only)                            |
| `base_url`   | API URL (static forges only)                                       |
| `parseUrl`   | `(URL) → { projectKey, repoSlug, filepath, origin }` or `null`     |
| `listPRsUrl` | API endpoint listing the repo's open PRs                           |
| `filesUrl`   | API endpoint listing a PR's modified files                         |
| `filenames`  | filenames touched by a PR, from the files-endpoint response        |
| `prNumber`   | identifier of a PR (used in URLs and displayed)                    |
| `prWebUrl`   | web (non-API) URL of a PR, for the popup links                     |
| `rateLimit`  | optional `{ url, header, remaining(data) }`; `null` if unsupported |
| `tokenStorageKey` | optional `storage.local` key holding the user's token; omit for no auth |
| `authHeader` | optional `(token) → headers` sent with API requests; omit for no auth |

A forge that omits `tokenStorageKey`/`authHeader` simply stays unauthenticated;
declaring both opts it into the [Authentication](#authentication) flow and the
options-page token field.

So, to add a new forge:
- in `forges.js`, create a new object implementing this interface
- in `forges.js`, add the forge to `staticForges`
- in `manifest.json`, add a `host_permissions` entry
- in `tests/forges.test.js`, add tests.

Supported forges:
- **GitHub**: https://docs.github.com/en/rest/pulls.

## Internationalization

Translations live in `_locales/<lang>/messages.json`. The default locale is
`en` (see `manifest.json`), but the browser picks the locale from the user's
language if it exists.

Strings are resolved two ways:
- `__MSG_<key>__` placeholders
- `browser.i18n.getMessage("<key>")` (in `popup.js` and `options.js`).

To add a locale:
- copy `_locales/template.json` to `_locales/<lang>/messages.json`
- fill every `message` field.

If you add a translatable string:
- add the string to `_locales/template.json`
- update `_locales/en/messages.json` with a description and a translation

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

| Symptom                     | Likely cause / fix                                           |
| --------------------------- | ------------------------------------------------------------ |
| Badge shows `err`           | A request failed — often the rate limit. Check the console.  |
| Badge/popup never updates   | The page URL doesn't match the expected file path.           |
| Rate limit reached quickly  | Low anonymous API quota — set a token (see [Authentication](#authentication)). |
| Private repo shows no PRs   | Set a token whose access covers that repository.             |
