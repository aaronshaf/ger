import type { Mock } from 'bun:test'
import { mock } from 'bun:test'
import type { SetupServer } from 'msw/node'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { Layer } from 'effect'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './config-mock'

export const server: SetupServer = setupServer(
  // Default handler for auth check
  http.get('*/a/accounts/self', ({ request }) => {
    const auth = request.headers.get('Authorization')
    if (!auth || !auth.startsWith('Basic ')) {
      return HttpResponse.text('Unauthorized', { status: 401 })
    }
    return HttpResponse.json({
      _account_id: 1000,
      name: 'Test User',
      email: 'test@example.com',
    })
  }),
)

// Store captured output
export let capturedStdout: string[] = []
export let capturedErrors: string[] = []

// Mock process.stdout.write to capture JSON output
export const mockStdoutWrite: Mock<(chunk: unknown) => boolean> = mock(
  (chunk: unknown): boolean => {
    capturedStdout.push(String(chunk))
    return true
  },
)

// Mock console.error to capture errors
export const mockConsoleError: Mock<(...args: unknown[]) => void> = mock(
  (...args: unknown[]): void => {
    capturedErrors.push(args.join(' '))
  },
)

// Mock process.exit to prevent test termination
export const mockProcessExit: Mock<(code?: number) => never> = mock((_code?: number): never => {
  throw new Error('Process exited')
})

// Store original methods
export const originalStdoutWrite: typeof process.stdout.write = process.stdout.write
export const originalConsoleError: typeof console.error = console.error
export const originalProcessExit: typeof process.exit = process.exit

export const setupBuildStatusTests = (): void => {
  server.listen({ onUnhandledRequest: 'bypass' })
  // @ts-ignore - Mocking stdout
  process.stdout.write = mockStdoutWrite
  // @ts-ignore - Mocking console
  console.error = mockConsoleError
  // @ts-ignore - Mocking process.exit
  process.exit = mockProcessExit
}

export const teardownBuildStatusTests = (): void => {
  server.close()
  // @ts-ignore - Restoring stdout
  process.stdout.write = originalStdoutWrite
  console.error = originalConsoleError
  // @ts-ignore - Restoring process.exit
  process.exit = originalProcessExit
}

export const resetBuildStatusMocks = (): void => {
  server.resetHandlers()
  mockStdoutWrite.mockClear()
  mockConsoleError.mockClear()
  mockProcessExit.mockClear()
  capturedStdout = []
  capturedErrors = []
}

export const createMockConfigLayer = (): Layer.Layer<ConfigService> =>
  Layer.succeed(ConfigService, createMockConfigService())
