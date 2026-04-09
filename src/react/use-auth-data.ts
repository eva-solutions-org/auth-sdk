import { useState, useEffect, useCallback, useRef } from 'react'
import type { EvaAuthError } from '../errors'
import { useAuthContext } from './eva-auth-provider'
import { authFetch } from './auth-fetch'

type AuthDataResult<T> = {
  data: T | null
  isLoading: boolean
  error: EvaAuthError | null
  refetch: () => void
}

export const useAuthData = <T>(path: string): AuthDataResult<T> => {
  const { basePath, isAuthenticated } = useAuthContext()

  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<EvaAuthError | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await authFetch<T>(`${basePath}${path}`, { signal })
      if (signal?.aborted) return

      if (result.ok) {
        setData(result.data)
        setError(null)
      } else {
        setData(null)
        setError({ error: result.error, status: result.status })
      }
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [basePath, path])

  useEffect(() => {
    if (!isAuthenticated) {
      setData(null)
      setIsLoading(false)
      setError(null)
      return
    }

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    fetchData(controller.signal)
    return () => controller.abort()
  }, [isAuthenticated, fetchData])

  const refetch = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    fetchData(controller.signal)
  }, [fetchData])

  return { data, isLoading, error, refetch }
}
