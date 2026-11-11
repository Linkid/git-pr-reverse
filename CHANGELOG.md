# Changelog

## 1.4.1 (2026-11-11)

- build: move to Node.js 26 (LTS)
- ci(dep): let Dependabot watch the npm dependencies too, not only the GitHub Actions
- ci: merge lint, test and build workflows
- docs: add Gerrit HTTP credentials
- docs: add the missing Bitbucket Server / Data Center HTTP access token
- docs: name the token to create for every authenticated forge
- feat(i18n): add an npm script to sync locales
- fix(options): lay the Gerrit mirror and review server fields on their own row
- fix(options): shorten the review server placeholder, so it is no longer cut off

## 1.4.0 (2026-07-10)

- feat: add Gerrit support as code review software
- feat: add Gitiles as Gerrit mirror layout
- fix: display a status message when adding or removing a self-hosted instance fails, and stop a list-refresh error from reporting a successful add/remove as failed
- fix: request the host permission before reading storage when adding a self-hosted instance, so the click's user-activation is preserved and the browser no longer rejects the request

## 1.3.3 (2026-07-07)

- build: run web-ext with npm
- ci(lint): use ESLint
- docs: add a development section
- fix: allow pagination when listing PR and files
- fix: cap the concurrent per-PR file fetches at 10
- fix: enable toolbar action after URL parsing
- perf: drop the rate limit pre-check request

## 1.3.2 (2026-07-05)

- ci(test): run the tests with coverage
- docs: fix the popup stylesheet name in the file layout
- fix(forges): match forge hostnames exactly or by subdomain instead of by substring, so lookalike hosts no longer trigger API calls
- fix(popup): display error instead of the loading state
- fix(storage): store the popup results per tab in storage session
- refactor(popup): drop the unused renderError parameter

## 1.3.1 (2026-07-03)

- fix(popup): declare all variables
- refactor: factorize duplicated functions (i18n, storage, token)

## 1.3.0 (2026-07-03)

- build(artifact): do not include tests and node stuff with web-ext
- feat(forges): support Codeberg
- feat(forges): support the GitLab public instance
- feat(forges): support self-hosted forges (GitLab CE/EE, Forgejo/Gitea, Bitbucket Server/Data Center)
- fix(background): replace globals with helpers params
- refactor: use async/await instead of `then()`

## 1.2.0 (2026-06-30)

- ci(build): build and upload the Chrome artifact
- feat(forges): support Bitbucket Cloud
- feat: add Chrome support
- feat: add optional authentication with a personal access token
- refactor(forges): use a modular adapter interface
- tests: init tests for JS scripts with CI

## 1.1.0 (2026-06-29)

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

## 1.0.1 (2023-07-08)

fix: stop calling GitHub API if the rate limit can be reached (#3)

## 1.0.0 (2023-06-24)

Initial release: list open pull requests of a file from GitHub and display it in a popup.
