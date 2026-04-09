import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react'
import type { Result } from '../types'
import type { EvaAuthError } from '../errors'
import { authFetch } from './auth-fetch'

// ── Types ──────────────────────────────────────────────

export type AuthState = {
  isAuthenticated: boolean
  isLoading: boolean
  error: EvaAuthError | null
}

export type AuthContextValue = AuthState & {
  login: {
    getCode: (params: { phone: string }) => Promise<Result<{ message: string }>>
    verify: (params: { phone: string; code: string }) => Promise<Result<{ user: { id: string } }>>
  }
  logout: () => Promise<Result<{ message: string }>>
  setAuthenticated: (value: boolean) => void
  basePath: string
}

export type EvaAuthProviderProps = {
  children: ReactNode
  basePath?: string
  apiUrl?: string
  onAuthChange?: (authenticated: boolean) => void
}

// ── Context ────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null)

export const useAuthContext = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('Hook must be used within EvaAuthProvider')
  return ctx
}

// ── Provider ───────────────────────────────────────────

const RETRY_DELAYS = [1000, 2000, 4000]

export const EvaAuthProvider = ({ children, basePath = '/auth', apiUrl, onAuthChange }: EvaAuthProviderProps) => {
  const urlBase = useMemo(() => {
    if (!apiUrl) return basePath
    return `${apiUrl.replace(/\/$/, '')}${basePath}`
  }, [apiUrl, basePath])

  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    error: null,
  })

  const prevAuthRef = useRef(state.isAuthenticated)
  const onAuthChangeRef = useRef(onAuthChange)
  onAuthChangeRef.current = onAuthChange

  // Notify on auth transitions
  useEffect(() => {
    if (prevAuthRef.current !== state.isAuthenticated) {
      prevAuthRef.current = state.isAuthenticated
      onAuthChangeRef.current?.(state.isAuthenticated)
    }
  }, [state.isAuthenticated])

  // Silent refresh on mount
  useEffect(() => {
    const controller = new AbortController()

    const checkSession = async () => {
      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        const result = await authFetch<unknown>(`${urlBase}/refresh`, {
          method: 'POST',
          signal: controller.signal,
        })

        if (controller.signal.aborted) return

        if (result.ok) {
          setState({ isAuthenticated: true, isLoading: false, error: null })
          return
        }

        if (result.status === 401) {
          setState({ isAuthenticated: false, isLoading: false, error: null })
          return
        }

        // Errores de cliente (4xx) no son recuperables con retry
        if (result.status >= 400 && result.status < 500) {
          setState({ isAuthenticated: false, isLoading: false, error: { error: result.error, status: result.status } })
          return
        }

        if (attempt < RETRY_DELAYS.length) {
          await new Promise<void>(r => setTimeout(r, RETRY_DELAYS[attempt]))
          if (controller.signal.aborted) return
        }
      }

      setState({
        isAuthenticated: false,
        isLoading: false,
        error: { error: 'Fallo al verificar sesión después de reintentos', status: 0 },
      })
    }

    checkSession()
    return () => controller.abort()
  }, [urlBase])

  const setAuthenticated = useCallback((value: boolean) => {
    setState(prev => ({ ...prev, isAuthenticated: value, error: null }))
  }, [])

  const login = useMemo(() => ({
    getCode: (params: { phone: string }) =>
      authFetch<{ message: string }>(`${urlBase}/get-code`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    verify: async (params: { phone: string; code: string }) => {
      const result = await authFetch<{ user: { id: string } }>(`${urlBase}/login`, {
        method: 'POST',
        body: JSON.stringify(params),
      })
      if (result.ok) setState({ isAuthenticated: true, isLoading: false, error: null })
      return result
    },
  }), [urlBase])

  const logout = useCallback(async () => {
    const result = await authFetch<{ message: string }>(`${urlBase}/logout`, {
      method: 'POST',
    })
    if (result.ok) setState({ isAuthenticated: false, isLoading: false, error: null })
    return result
  }, [urlBase])

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    login,
    logout,
    setAuthenticated,
    basePath: urlBase,
  }), [state, login, logout, setAuthenticated, urlBase])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
