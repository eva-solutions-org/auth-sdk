import { createHttpClient, type EvaHttpClient } from './http-client'

type EvaAuth = {
  client: EvaHttpClient
}

export function createEvaAuth(): EvaAuth {
  return {
    client: createHttpClient(),
  }
}
