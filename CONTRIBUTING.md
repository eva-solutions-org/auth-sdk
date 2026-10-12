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
# = node scripts/react-closure-size.mjs dist --max 11272 --max-cjs 12380 --forbid "\.meta\("
```

| Flag | Meaning |
|------|---------|
| `--max <bytes>` | Fails if the gzip size of the ESM closure is above this number (and of the CJS one when `--max-cjs` is absent). CI uses `11272`, the budget fixed for this change (10 248 B baseline plus 10 %); the ESM closure measures 9 942 B. |
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

## Pull request workflow

1. Create a branch from `main`: `git checkout -b feat/short-description`.
2. Make your changes. Follow existing patterns and conventions (see [docs/conventions.md](./docs/conventions.md)).
3. Add or update tests so the whole suite passes and the new behavior is covered.
4. Add a changeset describing the user-facing impact:
   ```bash
   pnpm run changeset
   ```
   Choose `patch` for bug fixes, `minor` for additions, `major` only after maintainer review. Changesets target `@eva_solutions/auth-sdk`; the contract package is private and is not versioned or published by itself.
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

### Tags and packing

- **Tag format.** The repo is a workspace, so release tags are named after the package: `@eva_solutions/auth-sdk@X.Y.Z` (not `vX.Y.Z`).
- **Check the tarball contents** without writing anything: `npm pack --dry-run`, run inside `packages/auth-sdk` (it is what the CI `publish-dryrun` job runs). It must list `LICENSE`, `README.md`, `CHANGELOG.md` and `dist/`. `pnpm pack --dry-run` does not exist in pnpm 11.28.2 (`Unknown option`); a real `pnpm pack` writes a `.tgz` in the current directory.
- **Nothing publishes from a PR branch.** `release.yml` runs `changeset publish` on every push to `main`; `@eva_solutions/auth-contracts` is skipped because it is private.

### Things that surprise people

- **Version PRs get no CI run.** The Version PR is opened with `GITHUB_TOKEN`, and events created by `GITHUB_TOKEN` do not start new workflow runs. The content was already checked by CI on the PRs that introduced it. Keep `main` without required status checks, or close and reopen the Version PR to trigger CI. Adding required checks later needs a personal access token or a GitHub App token.
- **pnpm version.** `packageManager` pins `pnpm@11.28.2`. If your local pnpm differs, pnpm 11 may silently switch to the pinned version (`pmOnFail` defaults to `download`); add `--config.pm-on-fail=ignore` to run the one you have installed.
- **Provenance** is requested by `PNPM_CONFIG_PROVENANCE: 'true'` in `release.yml` and `publishConfig.provenance` in `package.json`.

## Security

Do not open public issues for security vulnerabilities. See [SECURITY.md](./SECURITY.md) for the disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
