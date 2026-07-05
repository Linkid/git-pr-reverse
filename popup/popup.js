import { browser } from "../browser.js"
import { forgeForHostname } from "../forges.js"
import { localize } from "../i18n.js"
import { loadInstances, loadTabResult, onTabResult } from "../storage.js"

//
// Functions
//
async function getUrlInfo(tab) {
    // split the url
    const url = new URL(tab.url)

    // pick the forge adapter (built-in or a configured self-hosted instance)
    // and parse the URL through it (null on a non-forge / non-file page)
    const forge = forgeForHostname(url.hostname, await loadInstances())
    if (!forge) return null
    const info = forge.parseUrl(url)
    if (!info) return null

    return { forge, ...info }
}

export function render(prs, urlInfo) {
    // get the ul element and clear the loading state
    const ul = document.getElementById("prs")
    ul.replaceChildren()

    // empty state: no open pull request modifies the file
    if (prs.length == 0) {
        const li = document.createElement("li")
        li.setAttribute("class", "pr-list__empty")
        li.textContent = browser.i18n.getMessage("popupEmptyList")
        ul.appendChild(li)
        return
    }

    const fragment = document.createDocumentFragment()
    for (let pr of prs) {
        const li = document.createElement("li")
        const a = document.createElement("a")
        a.setAttribute("href", urlInfo.forge.prWebUrl(urlInfo, pr))
        a.setAttribute("target", "_blank")
        a.textContent = "#" + pr
        li.appendChild(a)
        fragment.appendChild(li)
    }
    ul.appendChild(fragment)
}

export function renderError() {
    // create a div element
    const div = document.createElement("div")
    div.setAttribute("id", "error")
    div.textContent = browser.i18n.getMessage("popupErrorMessage")

    // replace the ul element with the div element (already gone when an
    // earlier result showed the error state)
    const ul = document.getElementById("prs")
    if (ul) {
        document.body.replaceChild(div, ul)
    }
}

//
// Main
//
async function init() {
    // get the active tab
    const tabs = await browser.tabs.query({active: true, currentWindow: true})
    const tabInfo = tabs.pop()
    const tabId = tabInfo.id

    // get url info
    const urlInfo = await getUrlInfo(tabInfo)
    if (!urlInfo) {
        return
    }

    // show a result: the PR list on success, the error state on failure
    const show = result => result.error ? renderError() : render(result.prs, urlInfo)

    // the result is stored per tab; none stored yet means the background is
    // still fetching, so keep the loading state and show the result when the
    // background stores it (the listener registers first to not miss it)
    onTabResult(tabId, show)
    const result = await loadTabResult(tabId)
    if (result) {
        show(result)
    }
}
// register the popup logic against the browser; skipped when this module is
// imported outside a WebExtension context (e.g. the test runner, where the
// browser shim resolves to undefined)
if (browser) {
    localize()
    init().catch(error => console.error(`Error: ${error}`))
}
