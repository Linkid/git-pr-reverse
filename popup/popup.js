//
// Functions
//
function getUrlInfo(tab) {
    // split the url
    const url = new URL(tab.url)
    const hostname = url.hostname
    urlInfo = url.pathname.match("/(?<projectKey>[^/]+)\/(?<repoSlug>[^/]+)\/[^/]+\/[^/]+\/(?<filepath>.*)").groups
    urlInfo["origin"] = url.origin

    return urlInfo
}

function render(prs, urlInfo) {
    // get the ul element
    ul = document.getElementById("prs")
    fragment = document.createDocumentFragment()

    // remove the first element if there are pull requests
    if (prs.length > 0) {
        //ul.removeChild(ul.firstChild)
        ul.replaceChildren()
    }

    for (let pr of prs) {
        li = document.createElement("li")
        a = document.createElement("a")
        a.setAttribute("href", urlInfo.origin + "/" + urlInfo.projectKey + "/" + urlInfo.repoSlug  + "/" + "/pull/" + pr)
        a.textContent = pr
        li.appendChild(a)
        fragment.appendChild(li)
    }
    ul.appendChild(fragment)
}

//
// Main
//
browser.tabs.query({active: true, currentWindow: true})
    .then(tabs => {
        // get the first tab object in the array
        const tabInfo = tabs.pop()

        // get the tabId
        const tabId = tabInfo.id

        // get url info
        const urlInfo = getUrlInfo(tabInfo)

        // get the prs list
        browser.storage.local.get()
            // render
            .then(result => {
                if (result.tabId == tabId) {
                    render(result.prs, urlInfo)
                }
            })
            .catch(error => console.error(`Error: ${error}`))
    })
    .catch(error => console.error(`Error: ${error}`))
