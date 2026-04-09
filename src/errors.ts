export type EvaAuthError = {
  error: string
  status: number
}

export const createAuthError = (error: string, status: number): EvaAuthError => ({
  error,
  status,
})

export const isAuthError = (value: unknown): value is EvaAuthError =>
  typeof value === 'object'
  && value !== null
  && 'error' in value
  && 'status' in value
  && typeof (value as EvaAuthError).error === 'string'
  && typeof (value as EvaAuthError).status === 'number'

export const parseErrorResponse = async (
  response: Response,
): Promise<{ error: string; status: number }> => {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body as { error: string }
      return { error: typeof error === 'string' ? error : 'Error desconocido', status: response.status }
    }
    return { error: response.statusText || 'Error desconocido', status: response.status }
  } catch {
    return { error: response.statusText || 'Error desconocido', status: response.status }
  }
}
