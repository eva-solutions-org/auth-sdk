import { useAuthContext } from './eva-auth-provider'

export const useAuth = () => {
  const { isAuthenticated, isLoading, error, login, logout } = useAuthContext()
  return { isAuthenticated, isLoading, error, login, logout }
}
