export type EvaEnv = 'local' | 'development' | 'production'

export const AUTH_URL: string = __EVA_AUTH_URL__
export const ENV: EvaEnv = __EVA_ENV__ as EvaEnv

export function getAuthUrl(): string {
  return AUTH_URL
}

export function getEvaEnv(): EvaEnv {
  return ENV
}
