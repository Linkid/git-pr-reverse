import js from "@eslint/js"
import globals from "globals"

export default [
    js.configs.recommended,
    {
        // extension code runs in the browser; tests run under Node
        languageOptions: {
            globals: globals.browser,
        },
    },
    {
        files: ["tests/**"],
        languageOptions: {
            globals: globals.nodeBuiltin,
        },
    },
]
