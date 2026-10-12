import type { EvaUser } from '../types'
import { useAuthData } from './use-auth-data'

export const useUser = () => {
  const { data: user, ...rest } = useAuthData<EvaUser>('/me')
  return { user, ...rest }
}
