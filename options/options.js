import { browser } from "../browser.js"
import { authForges } from "../forges.js"

//
// Functions
//
function localize() {
    // Localize by replacing __MSG_***__ meta tags
    const toLocalize = document.querySelectorAll("[i18n]")
    for (let i = 0; i < toLocalize.length; i++) {
        const obj = toLocalize[i]
        const text = obj.textContent
        const textLocalized = text.replace(
            /__MSG_(\w+)__/g,
            function(match, v1) {
                return v1 ? browser.i18n.getMessage(v1) : ""
            }
        )

        if (textLocalized != text) {
            obj.textContent = textLocalized
        }
    }
}

function showStatus(messageKey) {
    document.getElementById("status").textContent = browser.i18n.getMessage(messageKey)
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
function loadTokens() {
    browser.storage.local.get()
        .then(stored => {
            for (const input of document.querySelectorAll("#forges input")) {
                const value = stored[input.dataset.storageKey]
                if (value) {
                    input.value = value
                }
            }
        })
        .catch(error => console.error(`Error: ${error}`))
}

// save every forge token: store the non-empty ones, drop the emptied ones
function saveTokens(event) {
    event.preventDefault()

    const toSet = {}
    const toRemove = []
    for (const input of document.querySelectorAll("#forges input")) {
        const token = input.value.trim()
        if (token) {
            toSet[input.dataset.storageKey] = token
        } else {
            toRemove.push(input.dataset.storageKey)
        }
    }

    Promise.all([
        browser.storage.local.set(toSet),
        browser.storage.local.remove(toRemove),
    ])
        .then(() => showStatus("optionsSaved"))
        .catch(error => console.error(`Error: ${error}`))
}

// remove every forge token
function clearTokens() {
    const keys = []
    for (const input of document.querySelectorAll("#forges input")) {
        input.value = ""
        keys.push(input.dataset.storageKey)
    }

    browser.storage.local.remove(keys)
        .then(() => showStatus("optionsCleared"))
        .catch(error => console.error(`Error: ${error}`))
}

//
// Main
//
localize()
renderForges()
loadTokens()
document.getElementById("options-form").addEventListener("submit", saveTokens)
document.getElementById("clear").addEventListener("click", clearTokens)
