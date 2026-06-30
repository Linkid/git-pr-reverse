import { browser } from "../browser.js"
import { forgeForHostname } from "../forges.js"

//
// Functions
//
function getUrlInfo(tab) {
    // split the url
    const url = new URL(tab.url)

    // pick the forge adapter and parse the URL through it (null on a non-forge / non-file page)
    const forge = forgeForHostname(url.hostname)
    if (!forge) return null
    const info = forge.parseUrl(url)
    if (!info) return null

    return { forge, ...info }
}

function render(prs, urlInfo) {
    // get the ul element and clear the loading state
    ul = document.getElementById("prs")
    ul.replaceChildren()

    // empty state: no open pull request modifies the file
    if (prs.length == 0) {
        li = document.createElement("li")
        li.setAttribute("class", "pr-list__empty")
        li.textContent = browser.i18n.getMessage("popupEmptyList")
        ul.appendChild(li)
       return
    }

    fragment = document.createDocumentFragment()
    for (let pr of prs) {
        li = document.createElement("li")
        a = document.createElement("a")
        a.setAttribute("href", urlInfo.forge.prWebUrl(urlInfo, pr))
        a.setAttribute("target", "_blank")
        a.textContent = "#" + pr
        li.appendChild(a)
        fragment.appendChild(li)
    }
    ul.appendChild(fragment)
}

function renderError(urlInfo) {
    // create a div element
    div = document.createElement("div")
    div.setAttribute("id", "error")
    div.textContent = browser.i18n.getMessage("popupErrorMessage")

    // replace the ul element with the div element
    ul = document.getElementById("prs")
    document.body.replaceChild(div, ul)

}

function localize() {
    //Localize by replacing __MSG_***__ meta tags
    var toLocalize = document.querySelectorAll("[i18n]")
    for (var i=0; i < toLocalize.length; i++) {
        var obj = toLocalize[i]
        var text = obj.textContent
        var textLocalized = text.replace(
            /__MSG_(\w+)__/g,
            function(match, v1) {
                return v1 ? browser.i18n.getMessage(v1) : ""
            }
        )

        if(textLocalized != text) {
            obj.textContent = textLocalized
        }
    }
}

//
// Main
//
localize()
browser.tabs.query({active: true, currentWindow: true})
    .then(tabs => {
        // get the first tab object in the array
        const tabInfo = tabs.pop()

        // get the tabId
        const tabId = tabInfo.id

        // get url info
        const urlInfo = getUrlInfo(tabInfo)
        if (!urlInfo) {
            return
        }

        // get the prs list
        browser.storage.local.get()
            // render
            .then(result => {
                if (result.tabId == tabId) {
                    render(result.prs, urlInfo)
                } else {
                    // error in bg script
                    renderError(urlInfo)
                }
            })
            .catch(error => console.error(`Error: ${error}`))
    })
    .catch(error => console.error(`Error: ${error}`))
