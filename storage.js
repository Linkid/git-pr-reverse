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
