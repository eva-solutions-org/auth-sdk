import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Workspace layout: dependencies are symlinks into the repo-root store, outside this package's
  // Vite root. Resolving their real path makes Vitest re-fetch `zod` over RPC after every
  // vi.resetModules(), which breaks tests/configure-eva-auth.mock.test.ts ("sin process global",
  // it deletes globalThis.process). Keeping the symlinked path keeps them inside the root.
  resolve: { preserveSymlinks: true },
  test: {
    include: ['tests/**/*.test.ts'],
    typecheck: {
      enabled: true,
      tsconfig: './tests/tsconfig.json',
      include: ['tests/**/*.test-d.ts'],
    },
  },
})
