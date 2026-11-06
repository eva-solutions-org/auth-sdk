# Contributing

Thanks for considering a contribution to `@eva_solutions/auth-sdk`. This document outlines the process for proposing changes.

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md) before participating.

## Development setup

The repo is a pnpm workspace (`pnpm-workspace.yaml`, packages under `packages/`):

| Package | Path | Role |
|---------|------|------|
| `@eva_solutions/auth-sdk` | `packages/auth-sdk/` | The published SDK (source, tests, build, `CHANGELOG.md`) |
| `@eva_solutions/auth-contracts` | `packages/auth-contracts/` | Shared API contract. `"private": true`: never published on its own |

`docs/`, `.changeset/`, `.github/` and the community files stay at the repo root.

1. Fork the repo and clone your fork.
2. Install dependencies (once, from the repo root):
   ```bash
   pnpm install
   ```
3. Verify the baseline passes. Run these **from the repo root**, not inside a package:
   ```bash
   pnpm run lint
   pnpm run fmt:check
   pnpm run type-check
   pnpm run test:run
   pnpm run build
   ```
   - `lint`, `fmt` and `fmt:check` are root scripts with a single config (`.oxlintrc.json`, `.oxfmtrc.jsonc`) over both packages. Use `pnpm run fmt` to fix formatting.
   - `type-check` and `test:run` build `@eva_solutions/auth-contracts` first (`build:contracts`), because the SDK consumes the contract from its built `dist/`. A bare `pnpm -r type-check` on a clean tree fails with "cannot find module": use the root scripts.
   - `pnpm run test:types` runs the type tests only.
   - To work on a single package, use `pnpm --filter @eva_solutions/auth-sdk run <script>`; run `pnpm run build:contracts` first if the contract changed.
   - `pnpm run build` retries on its own: the tsdown 0.22.0 / rolldown-plugin-dts 0.25.1 build is not deterministic with the `.d.ts.map` files of the index, and today it fails about 60 % of the time without producing them. See [Build y distribución](./docs/configuration.md#build-y-distribución).

## Build gates

CI runs these checks on the built `dist/` after `pnpm run build` (`.github/workflows/ci.yml`). Run them locally from the repo root after a build when you touch `packages/auth-contracts/` or the imports of the SDK.

### Contract is inlined in the SDK

`@eva_solutions/auth-contracts` is private and never published, so no file in `packages/auth-sdk/dist` may reference it, and the SDK manifest must not list it under `dependencies` or `peerDependencies`. `pnpm --filter @eva_solutions/auth-sdk run check:self-contained` (`scripts/check-self-contained.mjs`) scans `dist/**/*.d.ts`, `*.d.cts`, `*.js` and `*.cjs` for `@eva_solutions/auth-contracts` and fails on any match; CI and the `prepack` script of the SDK both run it. A second CI step loads `dist/contracts/index.js` (ESM) and `index.cjs` (CJS) and fails if `AUTH_ROUTES` or `loginRequestSchema` is missing.

If the grep finds a match, the build left the contract as an external import: check first that `deps.alwaysBundle` in `packages/auth-sdk/tsdown.config.ts` still lists the package.

### React entry closure gate

The `react` entry must stay small and free of schema modules, in both formats. `packages/auth-sdk/scripts/react-closure-size.mjs` measures the transitive closure of `dist/react/index.js` (ESM, following `import`/`from`) and of `dist/react/index.cjs` (CJS, following `require("./…")`): the entry plus every shared chunk it pulls through relative specifiers; bare specifiers are external and do not count. Both closures are always measured, separately. CI and `prepack` run it through the package script, which holds the real budgets:

```bash
pnpm --filter @eva_solutions/auth-sdk run check:react-closure
# = node scripts/react-closure-size.mjs dist --max 11800 --max-cjs 12380 --forbid "\.meta\("
```

| Flag | Meaning |
|------|---------|
| `--max <bytes>` | Fails if the gzip size of the ESM closure is above this number (and of the CJS one when `--max-cjs` is absent). CI uses `11800`. It was `11272` (10 248 B baseline plus 10 %); the identity phase 1 change (`product` in `configureEvaAuth`, per-product cookie names, four more event codes) took the closure from 11 212 B to 11 622 B and the maintainers raised the budget (ADR-020). |
| `--max-cjs <bytes>` | Own budget for the CJS closure. CJS is larger by design: it carries the bundler interop helper as its own chunk (`rolldown-runtime-*.cjs`). CI uses `12380`: the measured 10 954 B plus 13 %, the same relative margin as ESM. |
| `--forbid <regex>` | Fails if the text of any file in either closure matches. CI uses `\.meta\(`: a file that registers `.meta()` metadata is a SCHEMA module of the contract, and it must not be reachable from `react`. |

An unknown flag is an error on purpose: a gate that silently ignored a flag would pass without checking anything. A missing `react/index.js` or `react/index.cjs` is also an error.

The script prints one JSON line, `{ "esm": <closure>, "cjs": <closure> }`, where each closure is `{ "files": <count>, "gzipBytes": <total>, "perFile": { "<file>": <gzip bytes> } }`, and exits `1` on a failure.

The same gate (plus `check:self-contained`) runs in the `prepack` script of `@eva_solutions/auth-sdk`: building the contract and the SDK first, so no tarball is produced without passing it, even when CI does not run on the branch.

**How to read a failure**

- `react closure (esm|cjs) file <name> matches forbidden pattern /\.meta\(/`: the named chunk contains contract schema code, so something reachable from `src/react/index.ts` imports a value from a SCHEMA module of `@eva_solutions/auth-contracts` (or from an SDK module such as `src/schemas.ts` that does). Find the import chain from `src/react/` to that file. Fix it by importing only values from PURE contract modules (`constants.ts`, `routes.ts`) or `import type`, or by moving the logic into a module without schema imports (as `src/parse-error-response.ts` does). The failure appears even when the size is still under the budget, which is the point of `--forbid`. If only the `cjs` line fails and the chunk is an `auth-handlers-*.cjs`, check that `outputOptions.codeSplitting` in `tsdown.config.ts` still isolates the bundler runtime in its own chunk: without it, `react/index.cjs` requires whichever chunk holds the helpers.
- `react closure (esm|cjs) <N> B gzip exceeds budget <M> B`: compare `perFile` with the previous run to see which file grew. Raising the budget is a maintainer decision, not a fix.
- `unknown argument: <flag>` or a usage error: the command line is wrong; nothing was measured.

The module kinds and the rule behind this gate are described in [docs/architecture.md](./docs/architecture.md) and in the [contract README](./packages/auth-contracts/README.md).

## Three environments

The SDK follows the ecosystem model: local, development and production. Nothing is committed with `file:` or a tarball; consumers install from npm.

| Environment | Branch | Published as | Install |
|-------------|--------|--------------|---------|
| local | any | not published (link) | `pnpm link`, below |
| development | `development` | snapshot `X.Y.Z-dev-<timestamp>`, dist-tag `dev` | `npm i @eva_solutions/auth-sdk@dev`, or pin the exact snapshot version (`npm i @eva_solutions/auth-sdk@3.0.0-dev-20261106181555`) |
| production | `main` (GitHub Release) | stable `X.Y.Z`, dist-tag `latest` | `npm i @eva_solutions/auth-sdk` |

`X.Y.Z` of a snapshot is the version the pending changesets will produce (`snapshot.useCalculatedVersion` in `.changeset/config.json`). The `@dev` tag moves with every snapshot; a consumer that needs reproducible installs pins the exact version. A push to `development` publishes only if `changeset version --snapshot dev` changes `packages/auth-sdk/package.json`; without pending changesets it publishes nothing.

### Link in local

```bash
pnpm run build                      # repo root
cd packages/auth-sdk && pnpm link --global
cd <consumer> && pnpm link --global @eva_solutions/auth-sdk
```

Run `pnpm run build` again after each SDK change. Undo it in the consumer with `pnpm unlink @eva_solutions/auth-sdk` followed by `pnpm install`. Do not commit the link to the consumer's `package.json`.

## Pull request workflow

1. Create a branch from `development`: `git checkout -b feat/short-description`.
2. Make your changes. Follow existing patterns and conventions (see [docs/conventions.md](./docs/conventions.md)).
3. Add or update tests so the whole suite passes and the new behavior is covered.
4. Add a changeset describing the user-facing impact:
   ```bash
   pnpm run changeset
   ```
   Choose `patch` for bug fixes, `minor` for additions, `major` only after maintainer review. Changesets target `@eva_solutions/auth-sdk`; the contract package is private and is not versioned or published by itself.
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
6. Open a PR targeting `development`. Fill in the PR template. Once the snapshot is validated in development, `development` goes to `main` through another PR.

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

**Normal flow.** Merge a PR that includes a changeset into `development`: in `.github/workflows/release.yml` the `checks` job (lint, format, type-check, tests, build) runs first and the `snapshot` job, which `needs` it, publishes `X.Y.Z-dev-<timestamp>` with the dist-tag `dev` (no git tags, no commits). Nothing publishes with red checks, and the workflow does not use `workflow_run`. When it is validated, merge `development` into `main`. The `version-pr` job opens (or updates) a "Version Packages" PR that bumps the version and the CHANGELOG; it never publishes. Merge it and create a GitHub Release `vX.Y.Z` from `main` (not a prerelease; `X.Y.Z` is the version in `packages/auth-sdk/package.json`). You do not need to wait for CI: the `publish` job runs the `checks` job on the tagged commit first and publishes to npm through OIDC trusted publishing, with provenance, only if they pass. It fails without publishing if the tag is not `v<version>` or if the tagged commit is not in `main`. A push to `main` never publishes. **Back-merge:** after each stable release, open a PR `main` → `development` (it carries the Version PR and the changelog). Without it `development` keeps the already released changesets and publishes snapshots of a version that is already out.

**Cases.** A prerelease promoted to a release does not fire `published`: create a new Release (not a prerelease). A Release for a version that already exists on npm ends without publishing (`changeset publish` skips what is already published) and the job does not fail.

**Authorization.** Steps marked **[AUTH]** are outward or irreversible (npm and GitHub settings, tokens, merges that publish). A maintainer performs each one deliberately and individually. Automation and AI agents must not run them without explicit authorization for that specific action.

### One-time setup and first publish

Needed only while the package has no trusted publisher yet.

| # | Step | Evidence |
|---|------|----------|
| 1 | **[AUTH]** Confirm you belong to the npm scope: `npm org ls eva_solutions` | Your user listed as member or owner |
| 2 | **[AUTH]** Allow GitHub Actions to open the Version PR: enable "Allow GitHub Actions to create and approve pull requests" at the **organization** level first, then at the repository level. If the repository checkbox is greyed out, the organization setting is locking it: ask an organization owner to enable it at the organization level | `gh api repos/eva-solutions-org/auth-sdk/actions/permissions/workflow` shows `"can_approve_pull_request_reviews": true` |
| 3 | **[AUTH]** Create the protected GitHub Environment `npm` (see [Environment `npm`](#environment-npm)). Both publishing jobs declare `environment: npm` | `gh api repos/eva-solutions-org/auth-sdk/environments/npm/deployment-branch-policies` lists `development` (branch) and `v*` (tag) |
| 4 | **[AUTH]** Create the bootstrap npm token: granular access token, 7-day expiry, read and write on the `eva_solutions` scope, "Bypass 2FA". Store it as a secret of the **Environment `npm`**, not of the repository: from the GitHub UI, or with `gh secret set NPM_TOKEN --env npm --repo eva-solutions-org/auth-sdk` typing the value at the interactive prompt. Never put it in a command line, file, log or chat | `gh secret list --env npm --repo eva-solutions-org/auth-sdk` shows the name `NPM_TOKEN` (never the value) |
| 5 | **[AUTH]** First publish: push a change with a changeset to `development`. The `snapshot` job publishes `X.Y.Z-dev-<timestamp>` with the dist-tag `dev` using `NPM_TOKEN` (written nowhere: the job's userconfig only references the variable). The first stable release comes later, from a GitHub Release on `main` | `npm view @eva_solutions/auth-sdk dist-tags` shows `dev`. Whether the registry also set `latest` on this first publish is not verified: if `latest` points to a `-dev-` version, see [Things that surprise people](#things-that-surprise-people). Provenance is expected but not a stop condition on this token publish |
| 6 | Promote what was validated: merge every pending PR into `development`, then open the PR `development` → `main` and merge it. Do this before configuring the trusted publisher, so the 2-day window of step 7 is not spent waiting. The `version-pr` job opens the Version PR; the action keeps updating it as changesets land | `main` contains all intended changesets and the Version PR is open |
| 7 | **[AUTH]** Configure the trusted publisher for the package: npmjs.com package settings, or `npm trust github` (see below). Organization `eva-solutions-org`, repository `auth-sdk`, workflow file `release.yml`, Environment name `npm`. **Note the time: you have 2 days to complete steps 8 and 9** | The trusted publisher appears in the package settings (or `npm trust list`) |
| 8 | **[AUTH]** Trust-switch PR against `development`: in `release.yml`, remove (a) the two `Configure bootstrap token (only if the secret exists)` steps (in `snapshot` and in `publish`), (b) the `NPM_TOKEN: ${{ secrets.NPM_TOKEN }}` lines of the `Publish` steps and of `Ensure latest is not a snapshot`, and (c) their `Bootstrap only` comments. Add a `patch` changeset (for example "ci: switch to npm trusted publishing"). Merge it, promote it to `main`, merge the Version PR it produces, create the GitHub Release for that version and do the back-merge | `release.yml` has no `NPM_TOKEN` reference and the publish workflow ran |
| 9 | Hard check: the `publish` job is green with no `NPM_TOKEN` in the workflow (so it authenticated through OIDC), `npm view @eva_solutions/auth-sdk@<new version> version` returns the new patch version, and npmjs.com shows provenance for it | If any of the three is missing, stop and use [Recovery](#recovery-trust-lapsed-or-oidc-publish-failed); do not revoke the token yet |
| 10 | **[AUTH]** Only after step 9 passes: revoke the npm token in npm settings and delete the Environment secret `NPM_TOKEN` | npm token list without it; `gh secret list --env npm --repo eva-solutions-org/auth-sdk` without `NPM_TOKEN` |

### Environment `npm`

The `snapshot` and `publish` jobs declare `environment: npm`. The Environment is the second layer that limits which refs can publish, on top of the `if:` conditions of the workflow. Create it once **[AUTH]**, with admin rights on the repository:

```bash
gh api -X PUT repos/eva-solutions-org/auth-sdk/environments/npm \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/eva-solutions-org/auth-sdk/environments/npm/deployment-branch-policies -f name=development -f type=branch
gh api -X POST repos/eva-solutions-org/auth-sdk/environments/npm/deployment-branch-policies -f name='v*' -f type=tag
```

`development` covers the snapshot and the tag rule `v*` covers the GitHub Release (a release run has the tag as its ref). Optionally add required reviewers in the UI for a manual approval. The trusted publisher on npm must be configured with the Environment name `npm`, and `NPM_TOKEN`, while it exists, lives as a secret of this Environment, not of the repository.

**SDK repositories must be PUBLIC.** On GitHub Free, an Environment's branch and tag rules (deployment branch policy) and rulesets are enforced only in public repositories; in a private one they restrict nothing.

**Residual risk.** Even with the Environment, anyone with write access can create a `v*` tag on another commit and that ref passes the Environment policy. The recommended closure is a tag ruleset (free in public repos) that restricts creation of `v*` to admins **[AUTH]**:

```bash
gh api -X POST repos/eva-solutions-org/auth-sdk/rulesets --input - <<'JSON'
{
  "name": "protect-release-tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [{ "type": "creation" }],
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }]
}
JSON
```

`actor_id: 5` is the Admin repository role. Verify with `gh api repos/eva-solutions-org/auth-sdk/rulesets` (`target: tag`, `enforcement: active`).

`npm trust` requires npm 11.15.0 or newer, two-factor authentication on your npm account, write access to the package, and an already published package. A granular token with "Bypass 2FA" does not work for `npm trust`; run it with your own logged-in session. The registry allows one trusted-publisher configuration per package. Check `npm trust github --help` for the exact flags (pass the Environment `npm`).

### Recovery: trust lapsed or OIDC publish failed

Once the package exists on npm, recovering trust **never needs a token**:

1. **[AUTH]** Remove the stale configuration: `npm trust list @eva_solutions/auth-sdk`, then `npm trust revoke --id <id> @eva_solutions/auth-sdk`.
2. **[AUTH]** Create the trusted publisher again with the same fields as step 7. The 2-day window restarts.
3. Open a PR with a `patch` changeset, merge it, merge the Version PR it produces and create the GitHub Release for that version. Confirm the publish with the checks of step 9.

A token is only an emergency fallback. Using one again needs a new, deliberate authorization and its own revocation afterwards.

### Tags and packing

- **Tag format.** The tag is the one of your GitHub Release: `vX.Y.Z`, where `X.Y.Z` is the version of `packages/auth-sdk` (the only published package; `auth-contracts` is private). The `publish` job compares the tag with that `package.json`. `changeset publish` runs with `--no-git-tag`, so no `@eva_solutions/auth-sdk@X.Y.Z` tags are created.
- **Check the tarball contents** without writing anything: `npm pack --dry-run`, run inside `packages/auth-sdk` (it is what the CI `publish-dryrun` job runs). It must list `LICENSE`, `README.md`, `CHANGELOG.md` and `dist/`. `pnpm pack --dry-run` does not exist in pnpm 11.28.2 (`Unknown option`); a real `pnpm pack` writes a `.tgz` in the current directory.
- **Nothing publishes from a PR branch.** `release.yml` publishes only on pushes to `development` (snapshot) and on published GitHub Releases (stable), always after the `checks` job; a push to `main` only updates the Version PR; `@eva_solutions/auth-contracts` is skipped because it is private.

### Things that surprise people

- **First publish comes from `development`, as a snapshot.** The package does not exist on npm until the bootstrap publish, and the first one is the snapshot job pushing to `development` with `NPM_TOKEN` (step 4 first), not a release from `main`. It is not verified whether the registry assigns `latest` to the first version published with `--tag dev`: after the first snapshot run `npm view @eva_solutions/auth-sdk dist-tags`. If `latest` points to a `-dev-` version, the `Ensure latest is not a snapshot` step tries `npm dist-tag rm` (with the token if present; with OIDC only on npm >= 11.21.0 and with "Allow npm dist-tag" enabled on the trusted publisher). If that fails it leaves a warning, never a red job, and you run `npm dist-tag rm @eva_solutions/auth-sdk latest` yourself.
- **Snapshots and the Version PR.** The changesets stay in `development` until the Version PR is merged into `main` and `main` is merged back into `development`; each push to `development` in between publishes a new snapshot with the same `X.Y.Z`. That is why every stable release is followed by the back-merge `main` → `development`.

- **Version PRs get no CI run.** The Version PR is opened with `GITHUB_TOKEN`, and events created by `GITHUB_TOKEN` do not start new workflow runs. The content was already checked by CI on the PRs that introduced it. Keep `main` without required status checks, or close and reopen the Version PR to trigger CI. Adding required checks later needs a personal access token or a GitHub App token.
- **pnpm version.** `packageManager` pins `pnpm@11.28.2`. If your local pnpm differs, pnpm 11 may silently switch to the pinned version (`pmOnFail` defaults to `download`); add `--config.pm-on-fail=ignore` to run the one you have installed.
- **Provenance** is requested by `PNPM_CONFIG_PROVENANCE: 'true'` in `release.yml` and `publishConfig.provenance` in `package.json`.

## Security

Do not open public issues for security vulnerabilities. See [SECURITY.md](./SECURITY.md) for the disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
