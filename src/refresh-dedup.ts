import type { Result, TokenPair } from './types'

type RefreshResult = Result<{ user: { id: string }; tokens?: TokenPair }>

const pendingRefreshes = new Map<string, Promise<RefreshResult>>()

export function deduplicateRefresh(
  refreshToken: string,
  refreshFn: () => Promise<RefreshResult>,
): Promise<RefreshResult> {
  const existing = pendingRefreshes.get(refreshToken)
  if (existing) return existing

  const promise = refreshFn().finally(() => {
    pendingRefreshes.delete(refreshToken)
  })
  pendingRefreshes.set(refreshToken, promise)
  return promise
}
