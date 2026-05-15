import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __EVA_AUTH_URL__: JSON.stringify('http://auth.test'),
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
