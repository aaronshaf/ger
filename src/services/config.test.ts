import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { Effect } from 'effect'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ConfigService, ConfigServiceLive } from './config'

describe('ConfigService', () => {
  let originalEnv: NodeJS.ProcessEnv
  const CONFIG_DIR = path.join(os.homedir(), '.ger')
  const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
  let originalConfigContent: string | null = null

  beforeEach(() => {
    // Store original env vars
    originalEnv = { ...process.env }

    // Clear environment variables for clean tests
    delete process.env.GERRIT_HOST
    delete process.env.GERRIT_USERNAME
    delete process.env.GERRIT_PASSWORD

    // Backup and remove existing config file for clean tests
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        originalConfigContent = fs.readFileSync(CONFIG_FILE, 'utf8')
        fs.unlinkSync(CONFIG_FILE)
      }
    } catch {
      // Ignore errors
    }
  })

  afterEach(() => {
    // Restore original env vars
    process.env = originalEnv

    // Restore original config file
    try {
      if (originalConfigContent !== null) {
        if (!fs.existsSync(CONFIG_DIR)) {
          fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
        }
        fs.writeFileSync(CONFIG_FILE, originalConfigContent, 'utf8')
        fs.chmodSync(CONFIG_FILE, 0o600)
      }
    } catch {
      // Ignore errors
    }
    originalConfigContent = null
  })

  describe('Environment Variable Configuration', () => {
    test('loads config from environment variables when all required vars are present', async () => {
      // Set environment variables
      process.env.GERRIT_HOST = 'https://gerrit.example.com'
      process.env.GERRIT_USERNAME = 'envuser'
      process.env.GERRIT_PASSWORD = 'envpass123'

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.getFullConfig
      }).pipe(Effect.provide(ConfigServiceLive), Effect.runPromise)

      expect(result).toEqual({
        host: 'https://gerrit.example.com',
        username: 'envuser',
        password: 'envpass123',
        aiAutoDetect: true,
        aiTool: undefined,
      })
    })

    test('loads credentials from environment variables', async () => {
      // Set environment variables
      process.env.GERRIT_HOST = 'https://gerrit.example.com'
      process.env.GERRIT_USERNAME = 'envuser'
      process.env.GERRIT_PASSWORD = 'envpass123'

      const result = await Effect.gen(function* () {
        const configService = yield* ConfigService
        return yield* configService.getCredentials
      }).pipe(Effect.provide(ConfigServiceLive), Effect.runPromise)

      expect(result).toEqual({
        host: 'https://gerrit.example.com',
        username: 'envuser',
        password: 'envpass123',
      })
    })

    test('fails when only some environment variables are present', async () => {
      // Set only some environment variables
      process.env.GERRIT_HOST = 'https://gerrit.example.com'
      process.env.GERRIT_USERNAME = 'envuser'
      // GERRIT_PASSWORD is missing

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getFullConfig
        }).pipe(Effect.provide(ConfigServiceLive), Effect.runPromise),
      ).rejects.toThrow('Configuration not found')
    })

    test('validates environment variable configuration format', async () => {
      // Set invalid environment variables
      process.env.GERRIT_HOST = 'not-a-url'
      process.env.GERRIT_USERNAME = 'envuser'
      process.env.GERRIT_PASSWORD = 'envpass123'

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getFullConfig
        }).pipe(Effect.provide(ConfigServiceLive), Effect.runPromise),
      ).rejects.toThrow('Invalid environment configuration format')
    })

    test('rejects empty environment variables', async () => {
      // Set empty environment variables
      process.env.GERRIT_HOST = 'https://gerrit.example.com'
      process.env.GERRIT_USERNAME = ''
      process.env.GERRIT_PASSWORD = 'envpass123'

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getFullConfig
        }).pipe(Effect.provide(ConfigServiceLive), Effect.runPromise),
      ).rejects.toThrow('Configuration not found')
    })

    test('provides helpful error message when no configuration is found', async () => {
      // Clear all relevant environment variables
      delete process.env.GERRIT_HOST
      delete process.env.GERRIT_USERNAME
      delete process.env.GERRIT_PASSWORD

      await expect(
        Effect.gen(function* () {
          const configService = yield* ConfigService
          return yield* configService.getFullConfig
        }).pipe(Effect.provide(ConfigServiceLive), Effect.runPromise),
      ).rejects.toThrow(
        'Configuration not found. Run "ger setup" to set up your credentials or set GERRIT_HOST, GERRIT_USERNAME, and GERRIT_PASSWORD environment variables.',
      )
    })
  })
})
