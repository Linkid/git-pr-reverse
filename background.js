import { browser } from './browser.js'
import { forgeForHostname } from './forges.js'
import { loadInstances, saveTabResult, clearTabResult } from './storage.js'

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

// fetch every page of a paginated endpoint, following the forge's next-page
// links; returns { items, response } where items concatenates normalize(data)
// across the pages and response is the last HTTP response (for header checks)
export async function fetchAllPages(forge, url, requestHeaders, normalize, errorLabel) {
    const items = []
    let response
    while (url) {
        response = await fetch(new Request(url, { headers: requestHeaders }))
        const data = await response.json()

        if (!response.ok) {
            throw new Error(`${errorLabel}: [${response.status}] ${response.statusText}: ${data.message ?? data}`)
        }

        items.push(...normalize(data))
        url = forge.nextPageUrl(response, data)
    }
    return { items, response }
}

// fetch all pull requests (across all pages)
// returns a promise resolving to { items, response }
function listAllPRs(forge, urlInfo, requestHeaders) {
    console.log("List all pull requests")

    return fetchAllPages(
        forge, forge.listPRsUrl(urlInfo), requestHeaders,
        data => forge.pullRequests(data),
        "Failed to list pull requests")
}

// fetch the filenames modified by a pull request (across all pages)
// returns a promise resolving to the list of filenames
async function getModifiedFilenames(forge, urlInfo, requestHeaders, pr) {
    const { items } = await fetchAllPages(
        forge, forge.filesUrl(urlInfo, pr), requestHeaders,
        data => forge.filenames(data),
        "Failed to list pull request modified files")
    return items
}

// returns the key if the item is in the array
export function addIfIncluded(array, item, key) {
    if (array.includes(item)) {
        return key
    }
    return null
}

// cap on the number of per-PR file fetches in flight at once: firing one
// request per PR on a repo with 100+ open PRs trips forge abuse protections
// (e.g. GitHub's secondary rate limits, which watch concurrency, not quota)
const MAX_CONCURRENT_FETCHES = 10

// run task(item) over the items with at most `limit` tasks in flight; resolves
// to the results in item order. A worker pool: each worker pulls the next
// unclaimed index until the items run out, so a slot frees as soon as its task
// settles. Rejects on the first task error, like Promise.all.
export async function mapWithConcurrency(items, limit, task) {
    const results = new Array(items.length)
    let next = 0
    const workers = Array.from({ length: Math.min(limit, items.length) },
        async () => {
            while (next < items.length) {
                const index = next++
                results[index] = await task(items[index])
            }
        })
    await Promise.all(workers)
    return results
}

// get all pull requests containing a file
// returns a promise resolving to a list of PR numbers (null for the PRs that
// don't touch the file); the per-PR file fetches run concurrently, capped at
// MAX_CONCURRENT_FETCHES in flight
export function getFilesPRs(forge, urlInfo, requestHeaders, prs) {
    return mapWithConcurrency(prs, MAX_CONCURRENT_FETCHES, async pr => {
        const filenames = await getModifiedFilenames(forge, urlInfo, requestHeaders, pr)
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

// check the rate limit comparing to PRs length (one files request each)
function checkRateLimitFromPRs(forge, prs, response) {
    // get the rate limit header (forges without one skip the comparison)
    const remaining = forge.rateLimit ? response.headers.get(forge.rateLimit.header) : null
    console.log("Rate limit remaining (from header):", remaining)

    // compare number of pull requests with rate limit
    console.log("Number of pull requests:", prs.length)
    if (remaining !== null && Number(remaining) <= prs.length) {
        throw new Error("Rate limit reached!")
    }
}

function render(prs, tabId) {
    // set the popup badge
    browser.action.setBadgeText({
        text: (prs.length).toString(),
        tabId: tabId
    })

    // save the results for the popup, keyed by tab
    saveTabResult(tabId, { prs })
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

    // get project info from the URL (forge-specific parsing); enable the
    // action only once the URL is known good, so the badge never flickers
    // on non-file pages (disable covers a file -> non-file navigation)
    const urlInfo = forge.parseUrl(url)
    if (urlInfo == null) {
        browser.action.disable(tab.id)
        return
    }
    browser.action.enable(tab.id)

    // drop the result of the tab's previous page: the popup shows its loading
    // state until this page's result lands
    await clearTabResult(tab.id)

    try {
        // load the stored API token, then check the forge rate limit
        const requestHeaders = await loadAuthHeaders(forge)
        await checkRateLimit(forge, requestHeaders)

        // list pull requests (all pages), then keep those that touch the file
        const { items: prs, response } = await listAllPRs(forge, urlInfo, requestHeaders)
        checkRateLimitFromPRs(forge, prs, response)
        const values = await getFilesPRs(forge, urlInfo, requestHeaders, prs)

        // render (dropping the PRs that don't touch the file)
        render(values.filter(x => x), tab.id)
    } catch (error) {
        // set the popup badge
        browser.action.setBadgeText({
            text: "err",
            tabId: tab.id
        })
        // store the error state for the popup and display the error
        saveTabResult(tab.id, { error: `${error}` })
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
    // forget the closed tab's result
    try {
        await clearTabResult(tabId)
    } catch (error) {
        console.error(`Error: ${error}`)
    }
}
