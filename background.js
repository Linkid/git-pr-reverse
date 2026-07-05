import { browser } from './browser.js'
import { forgeForHostname } from './forges.js'
import { loadInstances } from './storage.js'

//
// Main
//
// Per-tab state (forge, urlInfo, requestHeaders) is created in main() and
// passed to each helper, so concurrent tab updates never clobber each other.
// requestHeaders holds the forge API auth headers built from the stored token
// (empty when the forge supports no auth or the user configured no token).

// register the extension against the browser (skipped when this module is
// imported outside a WebExtension context, e.g. by the test runner, where the
// browser shim resolves to undefined)
if (browser) {
    // disable the action
    browser.action.disable()

    browser.tabs.onCreated.addListener(handleCreated)
    browser.tabs.onUpdated.addListener(handleUpdated)
    browser.tabs.onRemoved.addListener(handleRemoved)
}

//
// Functions
//
// build the auth headers for a forge from an already-fetched storage object
// returns the headers object — empty when there is no token or the forge
// supports no authentication
export function authHeadersFor(forge, stored) {
    // forges without authentication need no token
    if (!forge.authHeader || !forge.tokenStorageKey) {
        return {}
    }

    const token = stored[forge.tokenStorageKey]
    return token ? forge.authHeader(token) : {}
}

// load the auth headers for a forge from its stored token
// returns a promise resolving to the headers object
async function loadAuthHeaders(forge) {
    // forges without authentication need no token (and no storage read)
    if (!forge.authHeader || !forge.tokenStorageKey) {
        return {}
    }

    const stored = await browser.storage.local.get(forge.tokenStorageKey)
    return authHeadersFor(forge, stored)
}

// fetch all pull requests
// returns a promise with the list of pull requests
async function listAllPRs(forge, urlInfo, requestHeaders) {
    console.log("List all pull requests")

    const request = new Request(forge.listPRsUrl(urlInfo), { headers: requestHeaders })

    const response = await fetch(request)
    //if (!response.ok) {
    //    throw new Error(`Failed to list pull requests: [${response.status}] ${response.statusText}: ${data.message}`)
    //}
    return response
}

// fetch modified files of a pull request
// returns a promise with the list of modified files for a pull request
async function getModifiedFiles(forge, urlInfo, requestHeaders, pr) {
    // fetch the API
    const request = new Request(forge.filesUrl(urlInfo, pr), { headers: requestHeaders })

    const response = await fetch(request)
    const data = await response.json()

    if (!response.ok) {
        throw new Error(`Failed to list pull request modified files: [${response.status}] ${response.statusText}: ${data}`)
    }
    return data
}

// get filenames from a list of modified files
// returns a list of filenames
export function getFilenames(forge, files) {
    return forge.filenames(files)
}

// returns the key if the item is in the array
export function addIfIncluded(array, item, key) {
    if (array.includes(item)) {
        return key
    }
    return null
}

// get all pull requests containing a file
// returns a list of promises, each resolving to a PR number (or null); the
// per-PR file fetches run concurrently and the caller awaits them together
export function getFilesPRs(forge, urlInfo, requestHeaders, prs) {
    return prs.map(async pr => {
        const files = await getModifiedFiles(forge, urlInfo, requestHeaders, pr)
        const filenames = getFilenames(forge, files)
        return addIfIncluded(filenames, urlInfo.filepath, forge.prNumber(pr))
    })
}

// check the rate limit
async function checkRateLimit(forge, requestHeaders) {
    // forges without a rate-limit endpoint skip this check
    if (!forge.rateLimit) {
        return
    }

    console.log("Check the rate limit")

    // fetch the rate limit endpoint
    const response = await fetch(forge.rateLimit.url, { headers: requestHeaders })
    const data = await response.json()

    if (!response.ok) {
        throw new Error(`Failed to get rate limits: [${response.status}] ${response.statusText}: ${data.message}`)
    }

    const remaining = forge.rateLimit.remaining(data)
    console.log("Rate limit remaining:", remaining)
    if (remaining == 0) {
        throw new Error("Rate limit reached!")
    }
}

// check the rate limit comparing to PRs length
async function checkRateLimitFromPRs(forge, response) {
    // get the rate limit header (forges without one skip the comparison)
    const remaining = forge.rateLimit ? response.headers.get(forge.rateLimit.header) : null
    console.log("Rate limit remaining (from header):", remaining)

    const data = await response.json()

    // check the "list" response
    if (!response.ok) {
        throw new Error(`Failed to list pull requests: [${response.status}] ${response.statusText}: ${data.message}`)
    }

    // normalize the list response to an array of PRs (forge-specific)
    const list = forge.pullRequests(data)

    // compare number of pull requests with rate limit
    console.log("Number of pull requests:", list.length)
    if (remaining !== null && Number(remaining) <= list.length) {
        throw new Error("Rate limit reached!")
    }
    return list
}

function render(prs, tabId) {
    // set the popup badge
    browser.action.setBadgeText({
        text: (prs.length).toString(),
        tabId: tabId
    })

    // save results
    // keys: "tabId", "prs"
    browser.storage.local.set({ tabId, prs })
}

async function main(tab) {
    // split the url
    const url = new URL(tab.url)

    // get the forge adapter by hostname, considering configured self-hosted
    // instances alongside the built-in forges
    const instances = await loadInstances()
    const forge = forgeForHostname(url.hostname, instances)
    if (forge == null) {
        return
    }

    // self-hosted instances need an optional host permission before the
    // extension may call their API; skip quietly until the user grants it
    if (forge.selfHosted &&
        !(await browser.permissions.contains({ origins: [`*://${url.hostname}/*`] }))) {
        return
    }

    browser.action.enable(tab.id)

    // get project info from the URL (forge-specific parsing)
    const urlInfo = forge.parseUrl(url)
    if (urlInfo == null) {
        browser.action.disable(tab.id)
        return
    }

    try {
        // load the stored API token, then check the forge rate limit
        const requestHeaders = await loadAuthHeaders(forge)
        await checkRateLimit(forge, requestHeaders)

        // list pull requests, then keep those that touch the file
        const response = await listAllPRs(forge, urlInfo, requestHeaders)
        const prs = await checkRateLimitFromPRs(forge, response)
        const values = await Promise.all(getFilesPRs(forge, urlInfo, requestHeaders, prs))

        // render (dropping the PRs that don't touch the file)
        render(values.filter(x => x), tab.id)
    } catch (error) {
        // set the popup badge
        browser.action.setBadgeText({
            text: "err",
            tabId: tab.id
        })
        // display the error
        console.error(`${error}`)
    }
}

//
// Events
//
//
function handleCreated(tab) {
    // disable the action
    browser.action.disable(tab.id)
}

function handleUpdated(tabId, changeInfo, tabInfo) {
    // when a tab is fully loaded
    if (changeInfo.status == "complete") {
        // do the thing
        main(tabInfo)
    }
}

async function handleRemoved(tabId, removeInfo) {
    // remove info from storage
    const results = await browser.storage.local.get()
    if (Object.keys(results).length != 0 && results.tabId == tabId) {
        try {
            await browser.storage.local.remove(["tabId", "prs"])
        } catch (error) {
            console.error(`Error: ${error}`)
        }
    }
}
