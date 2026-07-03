import { browser } from "../browser.js"
import { forgeForHostname } from "../forges.js"
import { localize } from "../i18n.js"

//
// Functions
//
async function getUrlInfo(tab) {
    // split the url
    const url = new URL(tab.url)

    // pick the forge adapter (built-in or a configured self-hosted instance)
    // and parse the URL through it (null on a non-forge / non-file page)
    const stored = await browser.storage.local.get("selfHostedInstances")
    const forge = forgeForHostname(url.hostname, stored.selfHostedInstances || [])
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

export function renderError(urlInfo) {
    // create a div element
    const div = document.createElement("div")
    div.setAttribute("id", "error")
    div.textContent = browser.i18n.getMessage("popupErrorMessage")

    // replace the ul element with the div element
    const ul = document.getElementById("prs")
    document.body.replaceChild(div, ul)

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

    // get the prs list and render
    const result = await browser.storage.local.get()
    if (result.tabId == tabId) {
        render(result.prs, urlInfo)
    } else {
        // error in bg script
        renderError(urlInfo)
    }
}
// register the popup logic against the browser; skipped when this module is
// imported outside a WebExtension context (e.g. the test runner, where the
// browser shim resolves to undefined)
if (browser) {
    localize()
    init().catch(error => console.error(`Error: ${error}`))
}
