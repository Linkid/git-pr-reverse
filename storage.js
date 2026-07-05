import { browser } from "./browser.js"

// storage.local key holding the user's configured self-hosted instances, each
// an { type, hostname } object. Kept here so the key string lives in one place.
const INSTANCES_KEY = "selfHostedInstances"

// load the user's configured self-hosted instances ([] when none configured)
export async function loadInstances() {
    const stored = await browser.storage.local.get(INSTANCES_KEY)
    return stored[INSTANCES_KEY] || []
}

// persist the self-hosted instances list
export async function saveInstances(instances) {
    await browser.storage.local.set({ [INSTANCES_KEY]: instances })
}

// storage.session key holding the popup result for a tab. Per-tab keys let
// concurrent tabs store results without clobbering each other, and the session
// area clears itself when the browser closes.
function tabResultKey(tabId) {
    return `prs:${tabId}`
}

// save a tab's popup result: { prs } on success, { error } on failure
export async function saveTabResult(tabId, result) {
    await browser.storage.session.set({ [tabResultKey(tabId)]: result })
}

// load a tab's popup result (undefined while the background is still fetching)
export async function loadTabResult(tabId) {
    const stored = await browser.storage.session.get(tabResultKey(tabId))
    return stored[tabResultKey(tabId)]
}

// forget a tab's popup result (tab closed, or a new page load under way)
export async function clearTabResult(tabId) {
    await browser.storage.session.remove(tabResultKey(tabId))
}

// call back with a tab's popup result whenever the background stores one
export function onTabResult(tabId, callback) {
    browser.storage.session.onChanged.addListener(changes => {
        const change = changes[tabResultKey(tabId)]
        if (change?.newValue) callback(change.newValue)
    })
}
