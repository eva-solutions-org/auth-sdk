/**
 * deduplicateRefresh: concurrent refreshes with the same token share one request, and an entry
 * orphaned by a cancelled request (Workers never run its finally) cannot hang the next ones.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deduplicateRefresh } from '../src/refresh-dedup'

const ok = { ok: true, data: { user: { id: 'u1' } } } as const

afterEach(() => {
  vi.useRealTimers()
})

describe('deduplicateRefresh', () => {
  it('shares one request between concurrent callers', async () => {
    const fn = vi.fn(async () => ok)
    const [a, b] = await Promise.all([
      deduplicateRefresh('t-share', fn),
      deduplicateRefresh('t-share', fn),
    ])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('drops an entry older than its deadline without timers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const orphan = vi.fn(() => new Promise<never>(() => {}))
    void deduplicateRefresh('t-orphan', orphan) // initiator cancelled by the runtime

    vi.setSystemTime(Date.now() + 7_999)
    void deduplicateRefresh('t-orphan', orphan) // still within the 8 s deadline: joins
    expect(orphan).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 1)
    const own = vi.fn(async () => ok)
    expect(await deduplicateRefresh('t-orphan', own)).toEqual(ok)
    expect(own).toHaveBeenCalledTimes(1)
  })
})

describe('a joiner of an orphaned entry', () => {
  // Auth keeps a 10 s grace window for the old refresh token: the retry must leave at 8 s after the
  // request started, however late the joiner arrived.
  it.each([0, 3_000, 7_900])(
    'retries exactly 8 s after the start when it joined at +%i ms',
    async (joinAt) => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const start = Date.now()
      void deduplicateRefresh('t-joiner', () => new Promise<never>(() => {}))
      await vi.advanceTimersByTimeAsync(joinAt)
      const own = vi.fn(async () => ok)
      const joiner = deduplicateRefresh('t-joiner', own)

      await vi.advanceTimersByTimeAsync(8_000 - joinAt - 1)
      expect(Date.now() - start).toBe(7_999)
      expect(own).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      expect(own).toHaveBeenCalledTimes(1)
      expect(Date.now() - start).toBe(8_000)
      expect(await joiner).toEqual(ok)
    },
  )

  it('a replacement does not push a late joiner past its own bound', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const start = Date.now()
    void deduplicateRefresh('t-repl', () => new Promise<never>(() => {}))
    const first = vi.fn(() => new Promise<never>(() => {})) // also orphaned
    const a = deduplicateRefresh('t-repl', first)
    await vi.advanceTimersByTimeAsync(7_000)
    const last = vi.fn(async () => ok)
    const b = deduplicateRefresh('t-repl', last) // joins the orphan 1 s before its deadline

    await vi.advanceTimersByTimeAsync(1_000) // 8 s: `a` retries and becomes the replacement
    expect(first).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(8_000) // the replacement is orphaned too, 8 s later
    // `b` joined the first orphan, so it was released at 8 s onto the replacement and, bounded by
    // the replacement's own deadline, retries on its own at 16 s at the latest.
    expect(last).toHaveBeenCalledTimes(1)
    expect(Date.now() - start).toBe(16_000)
    void a
    expect(await b).toEqual(ok)
  })

  it('never makes a second request when the first answers in time', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    let release!: () => void
    const first = vi.fn(
      () => new Promise<typeof ok>((r) => (release = () => r(ok))),
    )
    const own = vi.fn(async () => ok)
    void deduplicateRefresh('t-fast', first)
    const joiner = deduplicateRefresh('t-fast', own)
    release()
    expect(await joiner).toEqual(ok)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(own).not.toHaveBeenCalled()
  })
})
