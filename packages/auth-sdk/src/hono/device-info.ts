import Bowser from 'bowser'
import type { DeviceInfo } from '../types'

export function parseDeviceInfo(request: Request): DeviceInfo {
  const userAgent = request.headers.get('user-agent') || ''
  const parsed = Bowser.parse(userAgent)

  return {
    deviceType: parsed.platform?.type || 'desktop',
    os: parsed.os?.name || 'Unknown',
    browser: parsed.browser?.name || 'Unknown',
    userAgent: userAgent.slice(0, 500),
  }
}
