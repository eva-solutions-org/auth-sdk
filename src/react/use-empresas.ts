import type { EvaEmpresa } from '../types'
import { useAuthData } from './use-auth-data'

export const useEmpresas = () => {
  const { data: empresas, ...rest } = useAuthData<EvaEmpresa[]>('/empresas')
  return { empresas, ...rest }
}
