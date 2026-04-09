export type ActivityState = 'activo' | 'ausente' | 'ocupado' | 'desconectado'
export type PrivacyState = 'publico' | 'amigos' | 'invisible'

export type EvaUser = {
  id: string
  phone: string
  name: string | null
  lastName: string | null
  email: string | null
  dni: string | null
  stateActivity: ActivityState
  statePrivacy: PrivacyState
  createdAt: string
}

export type EvaSession = {
  sessionId: string
  deviceType: string
  os: string
  browser: string
  ipAddress: string
  createdAt: string
  current: boolean
}

export type EvaEmpresa = {
  id: string
  ruc: string
  razonSocial: string
  slug: string
  direccion: string | null
  celular: string | null
  email: string | null
  img: string | null
}

export type EvaTokenPayload = {
  id: string
  sessionId: string
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number }

export type DeviceInfo = {
  deviceType: string
  os: string
  browser: string
  userAgent: string
}

export type TokenPair = {
  accessToken: string
  refreshToken: string
}
