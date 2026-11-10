import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { authFetch } from '../src/react/auth-fetch'
import {
  EvaAuthProvider,
  type AuthContextValue,
} from '../src/react/eva-auth-provider'
import type { EvaError } from '../src/types'

// El paquete no trae react-dom: se sustituyen los hooks por equivalentes síncronos
// para invocar EvaAuthProvider como función y leer el value que publica el Provider.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useMemo: <T>(factory: () => T) => factory(),
  useCallback: <T>(fn: T) => fn,
  useState: <T>(initial: T) => [initial, vi.fn()],
  useRef: <T>(initial: T) => ({ current: initial }),
  useEffect: () => undefined,
}))

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => {
  mockFetch.mockReset()
})

describe('authFetch — Result<T> con EvaError', () => {
  it('retorna { ok: true, data } cuando la respuesta es 200 con shape correcto', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: 'u1' } }), { status: 200 }),
    )

    const result = await authFetch<{ id: string }>('http://test/resource')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ id: 'u1' })
    }
  })

  it('retorna { ok: false, error: EvaApiError } cuando el servidor responde con wire nuevo { error: { code, message } }', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'unauthorized', message: 'Credenciales inválidas' },
        }),
        { status: 401 },
      ),
    )

    const result = await authFetch<unknown>('http://test/resource')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const error: EvaError = result.error
      expect(error.kind).toBe('api')
      if (error.kind === 'api') {
        expect(error.code).toBe('unauthorized')
        expect(error.message).toBe('Credenciales inválidas')
        expect(error.status).toBe(401)
      }
    }
  })

  it('retorna { ok: false, error: EvaSdkError } con reason malformed cuando la respuesta 4xx no tiene shape', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: true }), { status: 400 }),
    )

    const result = await authFetch<unknown>('http://test/resource')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const error: EvaError = result.error
      expect(error.kind).toBe('sdk')
      if (error.kind === 'sdk') {
        expect(error.reason).toBe('malformed')
      }
    }
  })

  it('retorna { ok: true, data: undefined } cuando el body 200 no tiene la key "data" (zod v4 z.unknown acepta ausencia)', async () => {
    // zod v4: z.object({ data: z.unknown() }) acepta objetos sin la key "data"
    // retornando data: undefined. Este es el comportamiento real del ApiResponseSchema.
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ wrongKey: 'value' }), { status: 200 }),
    )

    const result = await authFetch<unknown>('http://test/resource')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toBeUndefined()
    }
  })

  it('retorna { ok: false, error: EvaSdkError } con reason network cuando fetch lanza DOMException AbortError', async () => {
    mockFetch.mockRejectedValueOnce(
      Object.assign(new DOMException('aborted', 'AbortError'), {}),
    )

    const result = await authFetch<unknown>('http://test/resource')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const error: EvaError = result.error
      expect(error.kind).toBe('sdk')
      if (error.kind === 'sdk') {
        expect(error.reason).toBe('network')
        expect(error.status).toBe(0)
      }
    }
  })

  it('retorna { ok: false, error: EvaSdkError } con reason network cuando fetch lanza Error genérico', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))

    const result = await authFetch<unknown>('http://test/resource')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const error: EvaError = result.error
      expect(error.kind).toBe('sdk')
      if (error.kind === 'sdk') {
        expect(error.reason).toBe('network')
      }
    }
  })
})

describe('authFetch — shape de EvaError en narrowing', () => {
  it('error.status es accesible tanto en api como en sdk via narrowing', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'forbidden', message: 'Forbidden' } }),
        { status: 403 },
      ),
    )

    const result = await authFetch<unknown>('http://test/resource')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // status existe en ambas variantes de EvaError
      expect(result.error.status).toBe(403)
    }
  })
})

describe('EvaAuthProvider — login con challengeId', () => {
  const CHALLENGE_ID = '9f86d081884c7d659a2feaa0c55ad015'
  const storageSpy = { setItem: vi.fn(), getItem: vi.fn() }
  const cookieSetter = vi.fn()

  beforeEach(() => {
    storageSpy.setItem.mockClear()
    storageSpy.getItem.mockClear()
    cookieSetter.mockClear()
    vi.stubGlobal('localStorage', storageSpy)
    vi.stubGlobal('sessionStorage', storageSpy)
    vi.stubGlobal('document', {
      get cookie() {
        return ''
      },
      set cookie(value: string) {
        cookieSetter(value)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    globalThis.fetch = mockFetch
  })

  const renderLogin = () => {
    const element = EvaAuthProvider({
      children: null,
      basePath: '/auth',
    }) as unknown as {
      props: { value: AuthContextValue }
    }
    return element.props.value.login
  }

  it('verify_sends_challenge_id_stateless: el body incluye challengeId y no se escribe en storage ni cookies', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { user: { id: 'u1' } } }), {
        status: 200,
      }),
    )

    const result = await renderLogin().verify({
      phone: '+51999999999',
      code: '123456',
      challengeId: CHALLENGE_ID,
    })

    expect(result).toEqual({ ok: true, data: { user: { id: 'u1' } } })
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/auth/login')
    expect(JSON.parse(options.body as string)).toEqual({
      phone: '+51999999999',
      code: '123456',
      challengeId: CHALLENGE_ID,
    })
    expect(storageSpy.setItem).not.toHaveBeenCalled()
    expect(cookieSetter).not.toHaveBeenCalled()
  })

  it('getCode devuelve el challengeId del servidor sin persistirlo', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { message: 'Código enviado', challengeId: CHALLENGE_ID },
        }),
        { status: 200 },
      ),
    )

    const result = await renderLogin().getCode({ phone: '+51999999999' })

    expect(result).toEqual({
      ok: true,
      data: { message: 'Código enviado', challengeId: CHALLENGE_ID },
    })
    expect(storageSpy.setItem).not.toHaveBeenCalled()
    expect(cookieSetter).not.toHaveBeenCalled()
  })
})
