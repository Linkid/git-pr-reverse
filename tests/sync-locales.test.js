import { test } from "node:test"
import assert from "node:assert/strict"

import { syncLocale, templateFrom } from "../scripts/sync-locales.js"

const reference = {
    popupTitle: { message: "Pull requests", description: "Popup title" },
    popupCount: {
        message: "$COUNT$ open",
        description: "Open PR count",
        placeholders: { count: { content: "$1", example: "3" } },
    },
}

//
// templateFrom
//
test("templateFrom keeps the reference keys with empty messages", () => {
    assert.deepEqual(templateFrom(reference), {
        popupTitle: { message: "", description: "Popup title" },
        popupCount: {
            message: "",
            description: "Open PR count",
            placeholders: { count: { content: "$1", example: "3" } },
        },
    })
})

//
// syncLocale
//
test("syncLocale keeps an up-to-date locale unchanged", () => {
    const locale = {
        popupTitle: { message: "Demandes", description: "Titre" },
        popupCount: { message: "$COUNT$ ouvertes", description: "Nombre" },
    }
    const { messages, added, removed } = syncLocale(reference, locale)
    assert.deepEqual(messages, locale)
    assert.deepEqual(added, [])
    assert.deepEqual(removed, [])
})

test("syncLocale adds the missing keys with an empty message", () => {
    const locale = { popupTitle: { message: "Demandes", description: "Titre" } }
    const { messages, added } = syncLocale(reference, locale)
    assert.deepEqual(added, ["popupCount"])
    assert.deepEqual(messages.popupCount, templateFrom(reference).popupCount)
    assert.deepEqual(messages.popupTitle, locale.popupTitle)
})

test("syncLocale drops the keys the reference no longer has", () => {
    const locale = {
        popupTitle: { message: "Demandes", description: "Titre" },
        popupCount: { message: "$COUNT$ ouvertes", description: "Nombre" },
        popupOld: { message: "Ancien", description: "Obsolète" },
    }
    const { messages, removed } = syncLocale(reference, locale)
    assert.deepEqual(removed, ["popupOld"])
    assert.equal(Object.hasOwn(messages, "popupOld"), false)
})

test("syncLocale orders the keys like the reference", () => {
    const locale = {
        popupCount: { message: "$COUNT$ ouvertes", description: "Nombre" },
        popupTitle: { message: "Demandes", description: "Titre" },
    }
    assert.deepEqual(Object.keys(syncLocale(reference, locale).messages), ["popupTitle", "popupCount"])
})
