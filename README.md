# Auth SDK

Monorepo of the EVA Auth client libraries. It is a pnpm workspace with two packages:

| Package | Path | Published | Purpose |
|---------|------|-----------|---------|
| [`@eva_solutions/auth-sdk`](./packages/auth-sdk) | `packages/auth-sdk/` | Yes (npm) | Official TypeScript client for the EVA Auth Service: cookie-based auth, JWT ES256 verification, JWKS, S2S signing, webhooks. **Start with its [README](./packages/auth-sdk/README.md)**: install, usage and API |
| [`@eva_solutions/auth-contracts`](./packages/auth-contracts) | `packages/auth-contracts/` | No (`private`) | Shared API contract (wire schemas, constants, route descriptors). See its [README](./packages/auth-contracts/README.md) |

If you only want to use the SDK in an application, you do not need this repo: install `@eva_solutions/auth-sdk` from npm and follow the package README.

## Working in this repo

```bash
pnpm install
pnpm run lint && pnpm run fmt:check && pnpm run type-check && pnpm run test:run && pnpm run build
```

Run the scripts from the repo root. Details (why the contract builds first, working on one package, releasing, tags) are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Documentation

| Doc | Content |
|-----|---------|
| [docs/api.md](./docs/api.md) | Public API per entry point |
| [docs/architecture.md](./docs/architecture.md) | Structure, modules, auth flow |
| [docs/configuration.md](./docs/configuration.md) | Runtime config, build and distribution |
| [docs/integrations.md](./docs/integrations.md) | Consumers, cross-repo contract, releasing |
| [docs/migration.md](./docs/migration.md) | Migration guides between major versions |

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](./SECURITY.md).

## Contributing and license

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Licensed under the [MIT License](./LICENSE).
