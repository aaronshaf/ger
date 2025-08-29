import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Schema } from '@effect/schema'
import { Context, Effect, Layer } from 'effect'
import { GerritCredentials } from '@/schemas/gerrit'
import { AiConfig, AppConfig, aiConfigFromFlat, migrateFromNestedConfig } from '@/schemas/config'

export interface ConfigServiceImpl {
  readonly getCredentials: Effect.Effect<GerritCredentials, ConfigError>
  readonly saveCredentials: (credentials: GerritCredentials) => Effect.Effect<void, ConfigError>
  readonly deleteCredentials: Effect.Effect<void, ConfigError>
  readonly getAiConfig: Effect.Effect<AiConfig, ConfigError>
  readonly saveAiConfig: (config: AiConfig) => Effect.Effect<void, ConfigError>
  readonly getFullConfig: Effect.Effect<AppConfig, ConfigError>
  readonly saveFullConfig: (config: AppConfig) => Effect.Effect<void, ConfigError>
}

export class ConfigService extends Context.Tag('ConfigService')<
  ConfigService,
  ConfigServiceImpl
>() {}

export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  message: Schema.String,
} as const) {}

// File-based storage
const CONFIG_DIR = path.join(os.homedir(), '.ger')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const readFileConfig = (): unknown | null => {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf8')
      const parsed = JSON.parse(content)

      // Check if this is the old nested format and migrate if needed
      if (parsed && typeof parsed === 'object' && 'credentials' in parsed) {
        // Migrate from nested format to flat format
        const migrated = migrateFromNestedConfig(
          parsed as {
            credentials: { host: string; username: string; password: string }
            ai?: { tool?: 'claude' | 'llm' | 'opencode' | 'gemini'; autoDetect?: boolean }
          },
        )

        // Save the migrated config immediately
        try {
          writeFileConfig(migrated)
        } catch {
          // If write fails, still return the migrated config
        }

        return migrated
      }

      return parsed
    }
  } catch {
    // Ignore errors
  }
  return null
}

const writeFileConfig = (config: AppConfig): void => {
  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
  // Set restrictive permissions
  fs.chmodSync(CONFIG_FILE, 0o600)
}

const deleteFileConfig = (): void => {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE)
    }
  } catch {
    // Ignore errors
  }
}

export const ConfigServiceLive: Layer.Layer<ConfigService, never, never> = Layer.effect(
  ConfigService,
  Effect.sync(() => {
    const getFullConfig = Effect.gen(function* () {
      const fileContent = readFileConfig()
      if (!fileContent) {
        return yield* Effect.fail(
          new ConfigError({
            message: 'Configuration not found. Run "ger setup" to set up your credentials.',
          }),
        )
      }

      // Parse as flat config
      const fullConfigResult = yield* Schema.decodeUnknown(AppConfig)(fileContent).pipe(
        Effect.mapError(() => new ConfigError({ message: 'Invalid configuration format' })),
      )

      return fullConfigResult
    })

    const saveFullConfig = (config: AppConfig) =>
      Effect.gen(function* () {
        // Validate config using schema
        const validatedConfig = yield* Schema.decodeUnknown(AppConfig)(config).pipe(
          Effect.mapError(() => new ConfigError({ message: 'Invalid configuration format' })),
        )

        try {
          writeFileConfig(validatedConfig)
        } catch {
          yield* Effect.fail(new ConfigError({ message: 'Failed to save configuration to file' }))
        }
      })

    const getCredentials = Effect.gen(function* () {
      const config = yield* getFullConfig
      return {
        host: config.host,
        username: config.username,
        password: config.password,
      }
    })

    const saveCredentials = (credentials: GerritCredentials) =>
      Effect.gen(function* () {
        // Validate credentials using schema
        const validatedCredentials = yield* Schema.decodeUnknown(GerritCredentials)(
          credentials,
        ).pipe(Effect.mapError(() => new ConfigError({ message: 'Invalid credentials format' })))

        // Get existing config or create new one
        const existingConfig = yield* getFullConfig.pipe(
          Effect.orElseSucceed(
            () =>
              ({
                host: validatedCredentials.host,
                username: validatedCredentials.username,
                password: validatedCredentials.password,
                aiAutoDetect: true,
              }) as AppConfig,
          ),
        )

        // Update credentials in flat config
        const updatedConfig: AppConfig = {
          ...existingConfig,
          host: validatedCredentials.host,
          username: validatedCredentials.username,
          password: validatedCredentials.password,
        }

        yield* saveFullConfig(updatedConfig)
      })

    const deleteCredentials = Effect.gen(function* () {
      try {
        deleteFileConfig()
        yield* Effect.void
      } catch {
        // Ignore errors
        yield* Effect.void
      }
    })

    const getAiConfig = Effect.gen(function* () {
      const config = yield* getFullConfig
      return aiConfigFromFlat(config)
    })

    const saveAiConfig = (aiConfig: AiConfig) =>
      Effect.gen(function* () {
        // Validate AI config using schema
        const validatedAiConfig = yield* Schema.decodeUnknown(AiConfig)(aiConfig).pipe(
          Effect.mapError(() => new ConfigError({ message: 'Invalid AI configuration format' })),
        )

        // Get existing config
        const existingConfig = yield* getFullConfig

        // Update AI config in flat structure
        const updatedConfig: AppConfig = {
          ...existingConfig,
          aiTool: validatedAiConfig.tool,
          aiAutoDetect: validatedAiConfig.autoDetect,
        }

        yield* saveFullConfig(updatedConfig)
      })

    return {
      getCredentials,
      saveCredentials,
      deleteCredentials,
      getAiConfig,
      saveAiConfig,
      getFullConfig,
      saveFullConfig,
    }
  }),
)
