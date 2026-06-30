import { browser } from './browser.js'
import { forgeForHostname } from './forges.js'

//
// Main
//
let forge = new Object()
let urlInfo = new Object()
// headers sent with every forge API request; populated from the stored token
// (empty when the forge supports no auth or the user configured no token)
let requestHeaders = {}

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
function loadAuthHeaders(forge) {
    // forges without authentication need no token (and no storage read)
    if (!forge.authHeader || !forge.tokenStorageKey) {
        return Promise.resolve({})
    }

    return browser.storage.local.get(forge.tokenStorageKey)
        .then(stored => authHeadersFor(forge, stored))
}

// fetch all pull requests
// returns a promise with the list of pull requests
function listAllPRs() {
    console.log("List all pull requests")

    const request = new Request(forge.listPRsUrl(urlInfo), { headers: requestHeaders })

    return fetch(request).then(response => {
        //if (!response.ok) {
        //    throw new Error(`Failed to list pull requests: [${response.status}] ${response.statusText}: ${data.message}`)
        //}
        return response
    })
}

// fetch modified files of a pull request
// returns a promise with the list of modified files for a pull request
function getModifiedFiles(pr) {
    // fetch the API
    const request = new Request(forge.filesUrl(urlInfo, pr), { headers: requestHeaders })

    return fetch(request).then(async response => {
        const data = await response.json()

        if (!response.ok) {
            throw new Error(`Failed to list pull request modified files: [${response.status}] ${response.statusText}: ${data}`)
        }
        return data
    })
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
// returns a list of pull requests numbers
function getFilesPRs(prs) {
    const list = new Array()

    prs.forEach(pr => {
        list.push(
            getModifiedFiles(pr)
            .then(files => getFilenames(forge, files))
            .then(filenames => addIfIncluded(filenames, urlInfo.filepath, forge.prNumber(pr)))
        )
    })

    return list
}

// check the rate limit
function checkRateLimit() {
    // forges without a rate-limit endpoint skip this check
    if (!forge.rateLimit) {
        return Promise.resolve()
    }

    console.log("Check the rate limit")

    // fetch the rate limit endpoint
    return fetch(forge.rateLimit.url, { headers: requestHeaders })
        .then(async response => {
            const data = await response.json()

            if (!response.ok) {
                throw new Error(`Failed to get rate limits: [${response.status}] ${response.statusText}: ${data.message}`)
            }

            const remaining = forge.rateLimit.remaining(data)
            console.log("Rate limit remaining:", remaining)
            if (remaining == 0) {
                throw new Error("Rate limit reached!")
            }

            return
        })
}

// check the rate limit comparing to PRs length
function checkRateLimitFromPRs(response) {
    // get the rate limit header (forges without one skip the comparison)
    const remaining = forge.rateLimit ? response.headers.get(forge.rateLimit.header) : null
    console.log("Rate limit remaining (from header):", remaining)

    // compare prs length to the rate limit
    const prs = response.json()
        .then(data => {
            // check the "list" response
            if (!response.ok) {
                throw new Error(`Failed to list pull requests: [${response.status}] ${response.statusText}: ${data.message}`)
            }

            // normalize the list response to an array of PRs (forge-specific)
            const list = forge.pullRequests(data)

            // compare number of pull requests with rate limit
            console.log("Number of pull requests:", list.length)
            if (remaining !== null && remaining <= list.length) {
                throw new Error("Rate limit reached!")
            }
            return list
        })

    return prs
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

function main(tab) {
    // split the url
    const url = new URL(tab.url)

    // get the forge adapter by hostname
    forge = forgeForHostname(url.hostname)
    if (forge == null) {
        return
    }
    browser.action.enable(tab.id)

    // get project info from the URL (forge-specific parsing)
    const info = forge.parseUrl(url)
    if (info == null) {
        browser.action.disable(tab.id)
        return
    }
    urlInfo = info

    // load the stored API token, then check the forge rate limit
    loadAuthHeaders(forge)
        .then(headers => { requestHeaders = headers })
        .then(checkRateLimit)
        // list pull requests
        .then(listAllPRs)
        .then(checkRateLimitFromPRs)
        .then(getFilesPRs)
        .then(values => Promise.all(values)
            // remove null values
            .then(values => values.filter(x => x))
            // render
            .then(prs => render(prs, tab.id))
        )
        .catch(error => {
            // set the popup badge
            browser.action.setBadgeText({
                text: "err",
                tabId: tab.id
            })
            // display the error
            console.error(`${error}`)
        })
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

function handleRemoved(tabId, removeInfo) {
    // remove info from storage
    browser.storage.local.get().then(results => {
        if (Object.keys(results).length != 0 && results.tabId == tabId) {
            browser.storage.local.remove(["tabId", "prs"])
                .catch(error => console.error(`Error: ${error}`))
        }
    })
}
