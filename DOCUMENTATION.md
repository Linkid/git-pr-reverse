# Documentation

A browser WebExtension (Manifest V3) that answers the reverse of the usual pull
request question: instead of *"which files does this PR change?"*, it tells you
**"which open pull requests change this file?"**

## Table of contents

- [Overview](#overview)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [Usage](#usage)
- [Forges](#forges)
- [Internationalization](#internationalization)
- [Install](#install)
- [Troubleshooting](#troubleshooting)

## Overview

See the [README overview](README.md#overview) section.

## How it works

The extension has two parts that communicate through `browser.storage.local`.

### Background

Runs on every tab update:

1.   **Parse the URL**: extract `projectKey`, `repoSlug` and `filepath`
2.   **Detect the forge** by hostname
3.   **Promise chain**: list PRs, get files, keep PRs including the file
4.   **Render**: set the toolbar badge text and stores `{ tabId, prs }` in
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
├── forges.js              # per-forge API endpoint config
├── popup/
│   ├── popup.html         # popup markup
│   └── popup.js           # popup logic (read storage, render)
├── _locales/
│   ├── template.json      # empty key template for new locales
│   ├── en/messages.json   # English (default locale)
│   └── fr/messages.json   # French
├── static/
│   ├── icon-*.png         # toolbar / store icons
│   └── icon.svg           # source icon
└── .github/               # CI workflows (lint, build) + dependabot
```

## Usage

1.   Install the extension
2.   Open a file page on a supported forge
3.   The toolbar badge shows the count of open PRs touching that file
4.   Click the toolbar icon to open the popup and follow a PR link.

A badge of `err` means a request failed (often the rate limit — see below);
check the service-worker console for details.

## Forges

Forge endpoints are configured in `forges.js`.

To add a forge, you need to update the following file:
- `forges.js`: add a config object
- `background.js`: add the hostname to the switch / case
- `manifest.json`: add the URL to the `host_permissions` key.


## Internationalization

Translations live in `_locales/<lang>/messages.json`. The default locale is
`en` (see `manifest.json`), but the browser picks the locale from the user's
language if it exists.

Strings are resolved two ways:
- `__MSG_<key>__` placeholders
- `browser.i18n.getMessage("<key>")` (in `popup.js`).

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

## Troubleshooting

| Symptom                     | Likely cause / fix                                           |
| --------------------------- | ------------------------------------------------------------ |
| Badge shows `err`           | A request failed — often the rate limit. Check the console.  |
| Badge/popup never updates   | The page URL doesn't match the expected file path.           |
| Rate limit reached quickly  | Unauthenticated API quota; the repo has many open PRs.       |
