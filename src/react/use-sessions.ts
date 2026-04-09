import { useCallback } from 'react'
import type { EvaSession, Result } from '../types'
import { useAuthContext } from './eva-auth-provider'
import { useAuthData } from './use-auth-data'
import { authFetch } from './auth-fetch'

export const useSessions = () => {
  const { basePath } = useAuthContext()
  const { data: sessions, refetch, ...rest } = useAuthData<EvaSession[]>('/sessions')

  const closeSession = useCallback(async (sessionId: string): Promise<Result<{ message: string }>> => {
    const result = await authFetch<{ message: string }>(`${basePath}/sessions/${sessionId}`, {
      method: 'DELETE',
    })
    if (result.ok) refetch()
    return result
  }, [basePath, refetch])

  const closeAllOther = useCallback(async (): Promise<Result<{ message: string }>> => {
    const result = await authFetch<{ message: string }>(`${basePath}/sessions`, {
      method: 'DELETE',
    })
    if (result.ok) refetch()
    return result
  }, [basePath, refetch])

  return { sessions, ...rest, refetch, closeSession, closeAllOther }
}
