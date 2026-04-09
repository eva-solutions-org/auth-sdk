import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    EVA_AUTH_URL: z.string().url(),
    NODE_ENV: z.string().optional().default('production'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
