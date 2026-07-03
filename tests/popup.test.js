import { test } from "node:test"
import assert from "node:assert/strict"

//
// Minimal DOM + browser mocks
//
// popup.js reads `document` as a global and `browser` as the module import
// captured at load time (browser.js resolves it from globalThis). Both must be
// in place *before* importing popup.js, so this file installs them on
// globalThis and then dynamically imports the module under test.

// a tiny stand-in for a DOM node: enough of the Element/DocumentFragment API
// for render()/renderError() (setAttribute, textContent, appendChild,
// replaceChildren). appendChild flattens a fragment, mirroring the real DOM.
class FakeNode {
    constructor(tag) {
        this.tag = tag
        this.children = []
        this.attributes = {}
        this.textContent = ""
    }
    setAttribute(name, value) { this.attributes[name] = value }
    appendChild(child) {
        if (child.tag === "#fragment") {
            this.children.push(...child.children)
        } else {
            this.children.push(child)
        }
        return child
    }
    replaceChildren(...nodes) { this.children = nodes }
}

// the <ul id="prs"> the popup renders into; recreated per test via reset()
let prsNode

const documentMock = {
    getElementById: (id) => (id === "prs" ? prsNode : null),
    createElement: (tag) => new FakeNode(tag),
    createDocumentFragment: () => new FakeNode("#fragment"),
    querySelectorAll: () => [],
    body: {
        replaced: null,
        replaceChild(newNode, oldNode) { this.replaced = { newNode, oldNode } },
    },
}

const browserMock = {
    i18n: { getMessage: (key) => key },
    // the guarded auto-init in popup.js runs on import; a non-forge tab makes
    // getUrlInfo() return null so init() exits early without side effects
    tabs: { query: async () => [{ id: 1, url: "https://example.org/" }] },
    storage: { local: { get: async () => ({}) } },
}

globalThis.document = documentMock
globalThis.browser = browserMock

const { render, renderError } = await import("../popup/popup.js")

function reset() {
    prsNode = new FakeNode("ul")
    documentMock.body.replaced = null
}

// a stub forge adapter: render() only needs prWebUrl to build the links
const urlInfo = {
    forge: { prWebUrl: (info, prNumber) => `https://example.com/pr/${prNumber}` },
}

//
// render — regression guard for the strict-mode undeclared-variable bug
//
// popup.js is an ES module (strict mode), so the previously undeclared `ul` /
// `li` / `a` / `fragment` assignments threw a ReferenceError that aborted
// render() before any list item was built, leaving the popup empty. These
// tests fail with that bug and pass once the variables are declared.
test("render lists a link per pull request", () => {
    reset()

    render([1, 2, 42], urlInfo)

    // one <li> per PR, each wrapping an <a> to the forge PR URL
    assert.equal(prsNode.children.length, 3)
    const links = prsNode.children.map(li => li.children[0])
    assert.deepEqual(links.map(a => a.textContent), ["#1", "#2", "#42"])
    assert.deepEqual(links.map(a => a.attributes.href), [
        "https://example.com/pr/1",
        "https://example.com/pr/2",
        "https://example.com/pr/42",
    ])
    // links open in a new tab
    assert.ok(links.every(a => a.attributes.target === "_blank"))
})

test("render clears the loading state before listing", () => {
    reset()
    // seed a leftover child (the loading <li>) to prove it gets replaced
    prsNode.children = [new FakeNode("li")]

    render([1], urlInfo)

    assert.equal(prsNode.children.length, 1)
    assert.equal(prsNode.children[0].children[0].textContent, "#1")
})

test("render shows the empty state when no PR touches the file", () => {
    reset()

    render([], urlInfo)

    assert.equal(prsNode.children.length, 1)
    const li = prsNode.children[0]
    assert.equal(li.attributes.class, "pr-list__empty")
    assert.equal(li.textContent, "popupEmptyList")
})

//
// renderError
//
test("renderError replaces the list with an error element", () => {
    reset()

    renderError(urlInfo)

    const { newNode, oldNode } = documentMock.body.replaced
    assert.equal(oldNode, prsNode)
    assert.equal(newNode.attributes.id, "error")
    assert.equal(newNode.textContent, "popupErrorMessage")
})
