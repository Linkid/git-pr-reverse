import { browser } from "./browser.js"

// Replace every __MSG_<key>__ placeholder in the text of the page's
// [i18n]-tagged elements with its localized string. Shared by the popup and the
// options page; `root` defaults to the document but can be a subtree (or a mock
// in tests).
export function localize(root = document) {
    for (const element of root.querySelectorAll("[i18n]")) {
        const text = element.textContent
        const localized = text.replace(
            /__MSG_(\w+)__/g,
            (match, key) => (key ? browser.i18n.getMessage(key) : ""),
        )

        if (localized !== text) {
            element.textContent = localized
        }
    }
}
