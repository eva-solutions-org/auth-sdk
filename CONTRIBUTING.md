# Contributing

Thanks for considering a contribution to `@eva_solutions/auth-sdk`. This document outlines the process for proposing changes.

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md) before participating.

## Development setup

1. Fork the repo and clone your fork.
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Verify the baseline passes:
   ```bash
   pnpm run lint
   pnpm run type-check
   pnpm run test:run
   pnpm run build
   ```

## Pull request workflow

1. Create a branch from `main`: `git checkout -b feat/short-description`.
2. Make your changes. Follow existing patterns and conventions (see [docs/conventions.md](./docs/conventions.md)).
3. Add or update tests so the whole suite passes and the new behavior is covered.
4. Add a changeset describing the user-facing impact:
   ```bash
   pnpm run changeset
   ```
   Choose `patch` for bug fixes, `minor` for additions, `major` only after maintainer review.
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
6. Open a PR targeting `main`. Fill in the PR template.

## Code conventions

- TypeScript-first (no `any`).
- Functional paradigm (no classes for business logic).
- Result Pattern for fallible operations (no thrown exceptions in business flows).
- Barrel files (`index.ts`) per module.
- See [docs/conventions.md](./docs/conventions.md) for the full convention set.

## Code review

- All PRs require at least one approval from a maintainer.
- CI must pass (lint, typecheck, tests, build, publish dry-run).
- Breaking changes require explicit discussion and a `major` changeset.

## Releasing (maintainers)

**Normal flow.** Merge a PR that includes a changeset into `main`. `.github/workflows/release.yml` opens a "Version Packages" PR; merging it publishes to npm through OIDC trusted publishing, with provenance. No token is involved.

**Authorization.** Steps marked **[AUTH]** are outward or irreversible (npm and GitHub settings, tokens, merges that publish). A maintainer performs each one deliberately and individually. Automation and AI agents must not run them without explicit authorization for that specific action.

### One-time setup and first publish

Needed only while the package has no trusted publisher yet.

| # | Step | Evidence |
|---|------|----------|
| 1 | **[AUTH]** Confirm you belong to the npm scope: `npm org ls eva_solutions` | Your user listed as member or owner |
| 2 | **[AUTH]** Allow GitHub Actions to open the Version PR: enable "Allow GitHub Actions to create and approve pull requests" at the **organization** level first, then at the repository level. If the repository checkbox is greyed out, the organization setting is locking it: ask an organization owner to enable it at the organization level | `gh api repos/eva-solutions-org/auth-sdk/actions/permissions/workflow` shows `"can_approve_pull_request_reviews": true` |
| 3 | Merge every pending PR into `main` before touching any Version PR. The action keeps updating the open Version PR as changesets land | `main` contains all intended changesets |
| 4 | **[AUTH]** Create the bootstrap npm token: granular access token, 7-day expiry, read and write on the `eva_solutions` scope, "Bypass 2FA". Store it as the repository secret `NPM_TOKEN` from the GitHub UI, or with `gh secret set NPM_TOKEN --repo eva-solutions-org/auth-sdk` typing the value at the interactive prompt. Never put it in a command line, file, log or chat | `gh secret list` shows the name `NPM_TOKEN` (never the value) |
| 5 | **[AUTH]** Merge the Version PR. `release.yml` publishes using `NPM_TOKEN` (the workflow already passes `secrets.NPM_TOKEN`) | `npm view @eva_solutions/auth-sdk version` prints the new version. Provenance is expected but not a stop condition on this token publish |
| 6 | **[AUTH]** Configure the trusted publisher for the package: npmjs.com package settings, or `npm trust github` (see below). Organization `eva-solutions-org`, repository `auth-sdk`, workflow file `release.yml`, no environment. **Note the time: you have 2 days to complete steps 7 and 8** | The trusted publisher appears in the package settings (or `npm trust list`) |
| 7 | **[AUTH]** Trust-switch PR: remove the `NPM_TOKEN` line and its bootstrap comment from `release.yml`, and add a `patch` changeset (for example "ci: switch to npm trusted publishing"). Merge it, then merge the Version PR it produces | The publish workflow ran without a token |
| 8 | Hard check: the release job log says "No NPM_TOKEN found, but OIDC is available", `npm view` shows the new patch version, and npmjs.com shows provenance for it | If any of the three is missing, stop and use [Recovery](#recovery-trust-lapsed-or-oidc-publish-failed); do not revoke the token yet |
| 9 | **[AUTH]** Only after step 8 passes: revoke the npm token in npm settings and delete the repository secret `NPM_TOKEN` | npm token list without it; `gh secret list` without `NPM_TOKEN` |

`npm trust` requires npm 11.15.0 or newer, two-factor authentication on your npm account, write access to the package, and an already published package. A granular token with "Bypass 2FA" does not work for `npm trust`; run it with your own logged-in session. The registry allows one trusted-publisher configuration per package. Check `npm trust github --help` for the exact flags.

### Recovery: trust lapsed or OIDC publish failed

Once the package exists on npm, recovering trust **never needs a token**:

1. **[AUTH]** Remove the stale configuration: `npm trust list @eva_solutions/auth-sdk`, then `npm trust revoke --id <id> @eva_solutions/auth-sdk`.
2. **[AUTH]** Create the trusted publisher again with the same fields as step 6. The 2-day window restarts.
3. Open a PR with a `patch` changeset, merge it, and merge the Version PR it produces. Confirm the publish with the checks of step 8.

A token is only an emergency fallback. Using one again needs a new, deliberate authorization and its own revocation afterwards.

### Things that surprise people

- **Version PRs get no CI run.** The Version PR is opened with `GITHUB_TOKEN`, and events created by `GITHUB_TOKEN` do not start new workflow runs. The content was already checked by CI on the PRs that introduced it. Keep `main` without required status checks, or close and reopen the Version PR to trigger CI. Adding required checks later needs a personal access token or a GitHub App token.
- **pnpm version.** `packageManager` pins `pnpm@11.28.2`. If your local pnpm differs, pnpm 11 may silently switch to the pinned version (`pmOnFail` defaults to `download`); add `--config.pm-on-fail=ignore` to run the one you have installed.
- **Provenance** is requested by `PNPM_CONFIG_PROVENANCE: 'true'` in `release.yml` and `publishConfig.provenance` in `package.json`.

## Security

Do not open public issues for security vulnerabilities. See [SECURITY.md](./SECURITY.md) for the disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
