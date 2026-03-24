import { describe, expect, test } from 'bun:test'
import { Schema } from '@effect/schema'
import { Effect } from 'effect'
import { AppConfig, migrateFromNestedConfig } from './config'

describe('Config Schemas', () => {
  describe('AppConfig (Flat Structure)', () => {
    test('validates complete flat config', () => {
      const validConfig = {
        host: 'https://gerrit.example.com',
        username: 'testuser',
        password: 'testpass123',
      }

      const result = Schema.decodeUnknownSync(AppConfig)(validConfig)
      expect(result).toEqual(validConfig)
    })

    test('validates minimal flat config', () => {
      const minimalConfig = {
        host: 'https://gerrit.example.com',
        username: 'testuser',
        password: 'testpass123',
      }

      const result = Schema.decodeUnknownSync(AppConfig)(minimalConfig)
      expect(result).toEqual(minimalConfig)
    })

    test('rejects invalid host URL', () => {
      const invalidConfig = {
        host: 'not-a-url',
        username: 'testuser',
        password: 'testpass123',
      }

      expect(() => Schema.decodeUnknownSync(AppConfig)(invalidConfig)).toThrow()
    })

    test('rejects empty username', () => {
      const invalidConfig = {
        host: 'https://gerrit.example.com',
        username: '',
        password: 'testpass123',
      }

      expect(() => Schema.decodeUnknownSync(AppConfig)(invalidConfig)).toThrow()
    })

    test('rejects empty password', () => {
      const invalidConfig = {
        host: 'https://gerrit.example.com',
        username: 'testuser',
        password: '',
      }

      expect(() => Schema.decodeUnknownSync(AppConfig)(invalidConfig)).toThrow()
    })
  })

  describe('Helper Functions', () => {
    test('migrateFromNestedConfig converts old nested format', () => {
      const nestedConfig = {
        credentials: {
          host: 'https://gerrit.example.com',
          username: 'testuser',
          password: 'testpass123',
        },
      }

      const flatConfig = migrateFromNestedConfig(nestedConfig)
      expect(flatConfig).toEqual({
        host: 'https://gerrit.example.com',
        username: 'testuser',
        password: 'testpass123',
      })
    })

    test('migrateFromNestedConfig ignores legacy AI config fields', () => {
      const nestedConfig = {
        credentials: {
          host: 'https://gerrit.example.com',
          username: 'testuser',
          password: 'testpass123',
        },
        ai: {
          tool: 'claude',
          autoDetect: false,
        },
      }

      const flatConfig = migrateFromNestedConfig(nestedConfig)
      expect(flatConfig).toEqual({
        host: 'https://gerrit.example.com',
        username: 'testuser',
        password: 'testpass123',
      })
    })
  })

  describe('Effect Schema Integration', () => {
    test('Effect.gen with valid flat config', async () => {
      const config = {
        host: 'https://gerrit.example.com',
        username: 'testuser',
        password: 'testpass123',
      }

      const result = await Effect.gen(function* () {
        return yield* Schema.decodeUnknown(AppConfig)(config)
      }).pipe(Effect.runPromise)

      expect(result).toEqual(config)
    })

    test('Effect.gen with validation error', async () => {
      const invalidConfig = {
        host: 'not-a-url',
        username: 'testuser',
        password: 'testpass123',
      }

      await expect(
        Effect.gen(function* () {
          return yield* Schema.decodeUnknown(AppConfig)(invalidConfig)
        }).pipe(Effect.runPromise),
      ).rejects.toThrow()
    })
  })
})
