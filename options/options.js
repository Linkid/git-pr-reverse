import { browser } from "../browser.js"
import { authForges, selfHostedTypes, selfHostedTokenKey } from "../forges.js"
import { localize } from "../i18n.js"
import { loadInstances, saveInstances } from "../storage.js"

//
// Functions
//
function showStatus(messageKey, elementId = "status") {
    document.getElementById(elementId).textContent = browser.i18n.getMessage(messageKey)
}

// render one token field per authenticated forge; each input is tagged with the
// forge's storage key so load/save/clear can stay forge-agnostic
function renderForges() {
    const container = document.getElementById("forges")

    for (const forge of authForges()) {
        const fieldset = document.createElement("fieldset")
        fieldset.className = "options__forge"

        // forge name (a proper noun, not localized)
        const legend = document.createElement("legend")
        legend.textContent = forge.label
        fieldset.appendChild(legend)

        const label = document.createElement("label")
        label.className = "options__label"
        label.setAttribute("for", forge.tokenStorageKey)
        label.textContent = browser.i18n.getMessage("optionsTokenLabel")
        fieldset.appendChild(label)

        const hint = document.createElement("p")
        hint.className = "options__hint"
        hint.textContent = browser.i18n.getMessage("optionsTokenHint")
        fieldset.appendChild(hint)

        const input = document.createElement("input")
        input.type = "password"
        input.id = forge.tokenStorageKey
        input.className = "options__input"
        input.autocomplete = "off"
        input.spellcheck = false
        input.dataset.storageKey = forge.tokenStorageKey
        fieldset.appendChild(input)

        container.appendChild(fieldset)
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

// populate the software-type dropdown for the "add instance" form
function renderTypeOptions() {
    const select = document.getElementById("instance-type")
    for (const { type, label } of selfHostedTypes()) {
        const option = document.createElement("option")
        option.value = type
        option.textContent = label
        select.appendChild(option)
    }
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
        const fieldset = document.createElement("fieldset")
        fieldset.className = "options__forge"

        const legend = document.createElement("legend")
        legend.textContent = `${instance.hostname} — ${typeLabels[instance.type] || instance.type}`
        fieldset.appendChild(legend)

        const key = selfHostedTokenKey(instance.hostname)

        const label = document.createElement("label")
        label.className = "options__label"
        label.setAttribute("for", key)
        label.textContent = browser.i18n.getMessage("optionsTokenLabel")
        fieldset.appendChild(label)

        const input = document.createElement("input")
        input.type = "password"
        input.id = key
        input.className = "options__input"
        input.autocomplete = "off"
        input.spellcheck = false
        input.dataset.storageKey = key
        fieldset.appendChild(input)

        const remove = document.createElement("button")
        remove.type = "button"
        remove.className = "options__remove"
        remove.textContent = browser.i18n.getMessage("optionsRemove")
        remove.addEventListener("click", () => removeInstance(instance.hostname))
        fieldset.appendChild(remove)

        container.appendChild(fieldset)
    }
}

// add a self-hosted instance: validate the hostname, request the host
// permission (this click is the required user gesture), then persist it
async function addInstance() {
    const type = document.getElementById("instance-type").value
    const hostname = normalizeHostname(document.getElementById("instance-hostname").value)
    if (!hostname) {
        showStatus("optionsInvalidHostname", "instance-status")
        return
    }

    try {
        const instances = await loadInstances()

        if (instances.some(i => i.hostname === hostname)) {
            showStatus("optionsInstanceExists", "instance-status")
            return
        }

        // the extension may only call the instance API once the user grants
        // access to its origin
        const granted = await browser.permissions.request({ origins: [`*://${hostname}/*`] })
        if (!granted) {
            showStatus("optionsPermissionDenied", "instance-status")
            return
        }

        instances.push({ type, hostname })
        await saveInstances(instances)
        document.getElementById("instance-hostname").value = ""
        await renderInstances()
        await loadTokens()
        showStatus("optionsInstanceAdded", "instance-status")
    } catch (error) {
        console.error(`Error: ${error}`)
    }
}

// remove a self-hosted instance: drop it from storage, forget its token and
// give back the host permission we no longer need
async function removeInstance(hostname) {
    try {
        const instances = (await loadInstances()).filter(i => i.hostname !== hostname)

        await saveInstances(instances)
        await browser.storage.local.remove(selfHostedTokenKey(hostname))
        await browser.permissions.remove({ origins: [`*://${hostname}/*`] })

        await renderInstances()
        showStatus("optionsInstanceRemoved", "instance-status")
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
// fill token fields once both the static forges and the instances are rendered
renderInstances().then(loadTokens)
document.getElementById("options-form").addEventListener("submit", saveTokens)
document.getElementById("clear").addEventListener("click", clearTokens)
document.getElementById("add-instance").addEventListener("click", addInstance)
