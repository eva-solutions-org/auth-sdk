---
'@eva_solutions/auth-sdk': major
---

Restructure the SDK repo as a pnpm workspace with a private `@eva_solutions/auth-contracts` package. No public API change yet: the `@eva_solutions/auth-sdk/contracts` entry point is not exposed until a later slice (S1) and this changeset will be updated then.
