import { browser } from "../browser.js"
import { authForges, gerritMirrorTypes, selfHostedTypes, selfHostedTokenKey } from "../forges.js"
import { localize } from "../i18n.js"
import { loadInstances, saveInstances } from "../storage.js"

//
// Functions
//
function showStatus(messageKey, elementId = "status") {
    document.getElementById(elementId).textContent = browser.i18n.getMessage(messageKey)
}

// build a token-input fieldset shared by the static forges and the self-hosted
// instances: a legend, a "token" label, an optional hint and a password input
// whose data-storage-key ties it to the forge-agnostic load/save/clear. Returns
// the fieldset so callers can append extras (e.g. a remove button).
function tokenFieldset({ legendText, storageKey, hintKey }) {
    const fieldset = document.createElement("fieldset")
    fieldset.className = "options__forge"

    const legend = document.createElement("legend")
    legend.textContent = legendText
    fieldset.appendChild(legend)

    const label = document.createElement("label")
    label.className = "options__label"
    label.setAttribute("for", storageKey)
    label.textContent = browser.i18n.getMessage("optionsTokenLabel")
    fieldset.appendChild(label)

    if (hintKey) {
        const hint = document.createElement("p")
        hint.className = "options__hint"
        hint.textContent = browser.i18n.getMessage(hintKey)
        fieldset.appendChild(hint)
    }

    const input = document.createElement("input")
    input.type = "password"
    input.id = storageKey
    input.className = "options__input"
    input.autocomplete = "off"
    input.spellcheck = false
    input.dataset.storageKey = storageKey
    fieldset.appendChild(input)

    return fieldset
}

// render one token field per authenticated forge; each input is tagged with the
// forge's storage key so load/save/clear can stay forge-agnostic
function renderForges() {
    const container = document.getElementById("forges")

    for (const forge of authForges()) {
        // forge name is a proper noun, not localized
        container.appendChild(tokenFieldset({
            legendText: forge.label,
            storageKey: forge.tokenStorageKey,
            hintKey: "optionsTokenHint",
        }))
    }
}

// fill each forge input from the stored token
async function loadTokens() {
    try {
        const stored = await browser.storage.local.get()
        for (const input of document.querySelectorAll("input[data-storage-key]")) {
            const value = stored[input.dataset.storageKey]
            if (value) {
                input.value = value
            }
        }
    } catch (error) {
        console.error(`Error: ${error}`)
    }
}

// save every forge token: store the non-empty ones, drop the emptied ones
async function saveTokens(event) {
    event.preventDefault()

    const toSet = {}
    const toRemove = []
    for (const input of document.querySelectorAll("input[data-storage-key]")) {
        const token = input.value.trim()
        if (token) {
            toSet[input.dataset.storageKey] = token
        } else {
            toRemove.push(input.dataset.storageKey)
        }
    }

    try {
        await Promise.all([
            browser.storage.local.set(toSet),
            browser.storage.local.remove(toRemove),
        ])
        showStatus("optionsSaved")
    } catch (error) {
        console.error(`Error: ${error}`)
    }
}

// remove every forge token
async function clearTokens() {
    const keys = []
    for (const input of document.querySelectorAll("input[data-storage-key]")) {
        input.value = ""
        keys.push(input.dataset.storageKey)
    }

    try {
        await browser.storage.local.remove(keys)
        showStatus("optionsCleared")
    } catch (error) {
        console.error(`Error: ${error}`)
    }
}

//
// Self-hosted instances
//
// normalize a user-entered instance address to a bare hostname; accepts a full
// URL or a bare hostname, returns null when it cannot be parsed
function normalizeHostname(value) {
    let raw = value.trim()
    if (!raw) return null
    if (!raw.includes("://")) raw = `https://${raw}`
    try {
        return new URL(raw).hostname || null
    } catch {
        return null
    }
}

// normalize a user-entered review server address to an origin URL; accepts a
// full URL or a bare hostname, returns null when it cannot be parsed
function normalizeOrigin(value) {
    let raw = value.trim()
    if (!raw) return null
    if (!raw.includes("://")) raw = `https://${raw}`
    try {
        return new URL(raw).origin || null
    } catch {
        return null
    }
}

// the hostname whose permission an instance needs: the host it queries — the
// review server for a Gerrit instance, the instance itself otherwise
function permissionHostname(instance) {
    try {
        return instance.reviewUrl ? new URL(instance.reviewUrl).hostname : instance.hostname
    } catch {
        return instance.hostname
    }
}

// fill a select element with { type, label } options
function fillTypeSelect(id, types) {
    const select = document.getElementById(id)
    for (const { type, label } of types) {
        const option = document.createElement("option")
        option.value = type
        option.textContent = label
        select.appendChild(option)
    }
}

// populate the software-type dropdowns for the "add instance" form: the forge
// type, and the mirror software a Gerrit instance pairs with
function renderTypeOptions() {
    fillTypeSelect("instance-type", selfHostedTypes())
    fillTypeSelect("instance-mirror-type", gerritMirrorTypes())
}

// render one fieldset per configured self-hosted instance: its label, a token
// field (tagged with the shared data-storage-key so load/save/clear handle it)
// and a remove button
async function renderInstances() {
    const container = document.getElementById("instances")
    container.replaceChildren()

    const instances = await loadInstances()
    const typeLabels = Object.fromEntries(selfHostedTypes().map(t => [t.type, t.label]))

    for (const instance of instances) {
        // a Gerrit instance shows its browse-mirror → review-server pairing
        const hosts = instance.reviewUrl
            ? `${instance.hostname} → ${instance.reviewUrl}`
            : instance.hostname
        const fieldset = tokenFieldset({
            legendText: `${hosts} — ${typeLabels[instance.type] || instance.type}`,
            storageKey: selfHostedTokenKey(instance.hostname),
            hintKey: instance.type === "gerrit" ? "optionsGerritTokenHint" : undefined,
        })

        const remove = document.createElement("button")
        remove.type = "button"
        remove.className = "options__remove"
        remove.textContent = browser.i18n.getMessage("optionsRemove")
        remove.addEventListener("click", () => removeInstance(instance.hostname))
        fieldset.appendChild(remove)

        container.appendChild(fieldset)
    }
}

// add a self-hosted instance: validate the hostname (and, for Gerrit, the
// review server URL), request the queried host's permission (this click is the
// required user gesture), then persist it
async function addInstance() {
    const type = document.getElementById("instance-type").value
    const hostname = normalizeHostname(document.getElementById("instance-hostname").value)
    if (!hostname) {
        showStatus("optionsInvalidHostname", "instance-status")
        return
    }

    const instance = { type, hostname }
    if (type === "gerrit") {
        // a Gerrit instance pairs the browsed mirror with the review server
        // it queries, and needs the mirror's URL layout to parse pages
        const reviewUrl = normalizeOrigin(document.getElementById("instance-review-url").value)
        if (!reviewUrl) {
            showStatus("optionsInvalidReviewUrl", "instance-status")
            return
        }
        instance.reviewUrl = reviewUrl
        instance.mirrorType = document.getElementById("instance-mirror-type").value
    }

    // critical path: request the permission and persist the instance. Any
    // failure here means the instance was not added, so surface it.
    try {
        // the extension may only call the queried API (the review server for
        // a Gerrit instance) once the user grants access to its origin.
        // permissions.request() must run before any other await, or it loses
        // the click's user-activation context and the browser rejects it; an
        // already-granted host (the duplicate case) resolves without a prompt.
        const granted = await browser.permissions.request(
            { origins: [`*://${permissionHostname(instance)}/*`] })
        if (!granted) {
            showStatus("optionsPermissionDenied", "instance-status")
            return
        }

        const instances = await loadInstances()

        if (instances.some(i => i.hostname === hostname)) {
            showStatus("optionsInstanceExists", "instance-status")
            return
        }

        instances.push(instance)
        await saveInstances(instances)
    } catch (error) {
        console.error(`Error: ${error}`)
        showStatus("optionsInstanceError", "instance-status")
        return
    }

    // the instance is saved; clearing the inputs and refreshing the list is
    // display-only, so a failure here must not report the add as failed
    document.getElementById("instance-hostname").value = ""
    document.getElementById("instance-review-url").value = ""
    showStatus("optionsInstanceAdded", "instance-status")
    try {
        await renderInstances()
        await loadTokens()
    } catch (error) {
        console.error(`Error: ${error}`)
    }
}

// remove a self-hosted instance: drop it from storage, forget its token and
// give back the queried host's permission we no longer need
async function removeInstance(hostname) {
    // critical path: drop the instance from storage. A failure here means it
    // was not removed, so surface it.
    let removed
    try {
        const instances = await loadInstances()
        removed = instances.find(i => i.hostname === hostname)
        await saveInstances(instances.filter(i => i.hostname !== hostname))
    } catch (error) {
        console.error(`Error: ${error}`)
        showStatus("optionsInstanceError", "instance-status")
        return
    }

    // the instance is gone; forgetting its token, releasing the host
    // permission and refreshing the list are best-effort cleanup, so a
    // failure here must not report the removal as failed
    showStatus("optionsInstanceRemoved", "instance-status")
    try {
        await browser.storage.local.remove(selfHostedTokenKey(hostname))
        if (removed) {
            await browser.permissions.remove(
                { origins: [`*://${permissionHostname(removed)}/*`] })
        }
        await renderInstances()
    } catch (error) {
        console.error(`Error: ${error}`)
    }
}

//
// Main
//
localize()
renderForges()
renderTypeOptions()
document.getElementById("instance-hostname").placeholder =
    browser.i18n.getMessage("optionsHostnamePlaceholder")
document.getElementById("instance-review-url").placeholder =
    browser.i18n.getMessage("optionsReviewUrlPlaceholder")

// the mirror-type and review-URL fields only apply to the gerrit type
const typeSelect = document.getElementById("instance-type")
function syncGerritFields() {
    const gerrit = typeSelect.value === "gerrit"
    document.getElementById("instance-mirror-type").hidden = !gerrit
    document.getElementById("instance-review-url").hidden = !gerrit
}
typeSelect.addEventListener("change", syncGerritFields)
syncGerritFields()

// fill token fields once both the static forges and the instances are rendered
renderInstances().then(loadTokens)
document.getElementById("options-form").addEventListener("submit", saveTokens)
document.getElementById("clear").addEventListener("click", clearTokens)
document.getElementById("add-instance").addEventListener("click", addInstance)
