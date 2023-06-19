//
// Main
//
let forge = new Object()
let urlInfo = new Object()

// disable the action
browser.action.disable()

browser.tabs.onCreated.addListener(handleCreated)
browser.tabs.onUpdated.addListener(handleUpdated)

//
// Functions
//
// fetch all pull requests
// returns a promise with the list of pull requests
function listAllPRs() {
    const request = new Request(forge.base_url + forge.repos + "/" + urlInfo.projectKey + "/" + urlInfo.repoSlug + forge.list_prs)

    return fetch(request).then((response) => {
        if (!response.ok) {
            throw new Error(`Failed to list pull requests: [${response.status}] ${response.statusText}`)
        }
        return response.json()
    })
}

// fetch modified files of a pull request
// returns a promise with the list of modified files for a pull request
function getModifiedFiles(pr) {
    // fetch the API
    const request = new Request(forge.base_url + forge.repos + "/" + urlInfo.projectKey + "/" + urlInfo.repoSlug + forge.list_prs + "/" + pr.number + forge.get_pred_files)

    return fetch(request).then((response) => {
        if (!response.ok) {
            throw new Error(`Failed to list pull request modified files: [${response.status}] ${response.statusText}`)
        }
        return response.json()
    })
}

// get filenames from a list of modified files
// returns a list of filenames
function getFilenames(files) {
    const filenames = new Array()
    files.forEach(file => filenames.push(file.filename))
    return filenames
}

// returns the key if the item is in the array
function addIfIncluded(array, item, key) {
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
            .then(getFilenames)
            .then(filenames => addIfIncluded(filenames, urlInfo.filepath, pr.number))
        )
    })

    return list
}

function render(prs, tabId) {
    // set the popup badge
    browser.action.setBadgeText({
        text: (prs.length).toString(),
        tabId: tabId
    })
}

function main(tab) {
    // split the url
    const url = new URL(tab.url)
    const hostname = url.hostname

    // get project info from the URL
    const urlInfoMatch = url.pathname.match("/(?<projectKey>[^/]+)\/(?<repoSlug>[^/]+)\/[^/]+\/[^/]+\/(?<filepath>.*)")
    if (urlInfoMatch == null) {
        browser.action.disable(tab.id)
        return
    }
    urlInfo = urlInfoMatch.groups

    // list pull requests
    listAllPRs()
        .then(getFilesPRs)
        .then(values => Promise.all(values)
            // remove null values
            .then(values => values.filter(x => x))
            // render
            .then(prs => render(prs, tab.id))
        )
        .catch(error => console.error(`Error: ${error}`))
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
