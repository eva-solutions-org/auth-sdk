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
   pnpm run build:prod
   ```

## Pull request workflow

1. Create a branch from `main`: `git checkout -b feat/short-description`.
2. Make your changes. Follow existing patterns and conventions (see [docs/conventions.md](./docs/conventions.md)).
3. Add or update tests so coverage stays at 411+ passing.
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

## Security

Do not open public issues for security vulnerabilities. See [SECURITY.md](./SECURITY.md) for the disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
