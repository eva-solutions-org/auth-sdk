import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    typecheck: {
      enabled: true,
      tsconfig: './tests/tsconfig.json',
      include: ['tests/**/*.test-d.ts'],
    },
  },
})
