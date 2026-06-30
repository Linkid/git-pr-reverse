// Resolve the WebExtension API namespace across browsers. Firefox exposes the
// standard promise-based `browser`; Chrome only exposes `chrome` (whose MV3
// APIs also return promises). Returns `undefined` outside a WebExtension
// context (e.g. the Node test runner), so importing modules can guard on it.
export function getBrowser(globalObj = globalThis) {
    return globalObj.browser ?? globalObj.chrome
}

export const browser = getBrowser()
