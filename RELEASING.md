# Releasing TalkToCursor

The public repository is the npm publishing source. Publishing a stable GitHub
Release runs `.github/workflows/release.yml`, verifies the tag matches
`package.json`, runs the build and tests, and publishes to npm with provenance.

## One-time npm setup

In the npm package settings for `talktocursor`, add a trusted publisher:

- Provider: GitHub Actions
- Organization or user: `MindSyncTech`
- Repository: `talk-to-cursor`
- Workflow filename: `release.yml`
- Environment: leave blank unless the workflow is later assigned one

No long-lived npm token is required by the workflow.

## Release steps

1. Synchronize reviewed package changes into this public repository.
2. Update the version in `package.json` and `package-lock.json`.
3. Move the relevant changelog entries from **Unreleased** into a dated version.
4. Commit and push the release changes.
5. Create a GitHub Release whose tag is exactly `v<package version>`.
6. Publish the GitHub Release. Do not run `npm publish` separately.
7. Confirm the **Publish npm release** workflow succeeds and that npm’s
   `latest` tag reports the new version.

The built-in checker reads npm’s `latest` endpoint. The settings dashboard and
MCP startup notice will begin reporting the release after npm updates, subject
to the local 24-hour cache. Users can bypass that cache with **Check for
updates**.
