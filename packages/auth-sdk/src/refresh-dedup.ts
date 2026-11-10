import type { EvaError, Result, TokenPair } from './types'

type RefreshResult = Result<{ user: { id: string }; tokens?: TokenPair }>

type Pending = { promise: Promise<RefreshResult>; startedMs: number }

const pendingRefreshes = new Map<string, Pending>()

/**
 * What a refresh may last before it is given up as orphaned. Its own deadline, shorter than the
 * `ORPHAN_AFTER_MS` of the service tokens: Auth accepts the old refresh token again only inside a
 * 10 s grace window after a rotation, so a retry with it must leave before that.
 */
const REFRESH_DEADLINE_MS = 8_000

const isStale = (startedMs: number): boolean =>
  Date.now() - startedMs >= REFRESH_DEADLINE_MS

/**
 * Concurrent refreshes with the same token share one request. A request cancelled by the runtime
 * leaves its entry hanging (its `finally` never runs): an entry older than 8 s is dropped without
 * timers. A caller that joins one retries on its own at `startedMs + 8 s`, however late it joined
 * (never 8 s after joining). If by then another caller already replaced the entry, it joins that
 * one once more, bounded by the replacement's own deadline, and then retries directly: the wait
 * has at most two steps.
 */
export function deduplicateRefresh(
  refreshToken: string,
  refreshFn: () => Promise<RefreshResult>,
  depth = 0,
): Promise<RefreshResult> {
  let existing = pendingRefreshes.get(refreshToken)
  if (existing !== undefined && isStale(existing.startedMs)) {
    pendingRefreshes.delete(refreshToken)
    existing = undefined
  }
  if (existing !== undefined) {
    const { promise: shared, startedMs } = existing
    const delay = Math.max(0, startedMs + REFRESH_DEADLINE_MS - Date.now())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingRefreshes.get(refreshToken)?.promise === shared) {
          pendingRefreshes.delete(refreshToken)
        }
        const retry =
          depth >= 1
            ? refreshFn()
            : deduplicateRefresh(refreshToken, refreshFn, depth + 1)
        retry.then(resolve, reject)
      }, delay)
      shared.then(
        (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        (err: unknown) => {
          clearTimeout(timer)
          reject(err)
        },
      )
    })
  }

  const promise: Promise<RefreshResult> = refreshFn().finally(() => {
    if (pendingRefreshes.get(refreshToken)?.promise === promise) {
      pendingRefreshes.delete(refreshToken)
    }
  })
  pendingRefreshes.set(refreshToken, { promise, startedMs: Date.now() })
  return promise
}

/**
 * True when Auth definitively rejected the refresh token: an API error that is not transient
 * (not 408, 429 or 5xx). A network failure or a transient status does not prove the session is
 * dead, so the caller must keep the cookies.
 */
export function isDefinitiveRejection(error: EvaError): boolean {
  return (
    error.kind === 'api' &&
    error.status !== 408 &&
    error.status !== 429 &&
    error.status < 500
  )
}
