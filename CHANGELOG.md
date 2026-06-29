# Changelog

## v1.1.0 (2026-06-29)

- chore(manifest): bump `strict_min_version` to 140.0
- ci: add permissions and persist-credentials checkout option
- ci: pin actions versions with git hashes
- docs: add a Firefox add-on badge
- docs: add a project documentation
- docs: add an overview of the extension
- feat(popup): add a loading state while fetching
- feat(popup): support dark mode
- fix(manifest): declare `data_collection_permissions`
- fix(popup): remove a slash before `/pull`
- refactor(popup): remove old `X-UA-Compatible` header support

## v1.0.1 (2023-07-08)

fix: stop calling GitHub API if the rate limit can be reached (#3)

## v1.0.0 (2023-06-24)

Initial release: list open pull requests of a file from GitHub and display it in a popup.
