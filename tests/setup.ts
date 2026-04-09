import { vi } from 'vitest'

// Mock global fetch
globalThis.fetch = vi.fn()

// Reset env between tests
const originalEnv = { ...process.env }

export function resetEnv() {
  process.env = { ...originalEnv }
}
