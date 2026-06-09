import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __EVA_AUTH_URL__: JSON.stringify('http://localhost:4000'),
    __EVA_ENV__: JSON.stringify('production'),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
    },
  },
})
