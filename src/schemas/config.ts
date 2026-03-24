import { Schema } from '@effect/schema'

// Flat Application Configuration
export const AppConfig: Schema.Struct<{
  host: typeof Schema.String
  username: typeof Schema.String
  password: typeof Schema.String
  retriggerComment: Schema.optional<typeof Schema.String>
}> = Schema.Struct({
  host: Schema.String.pipe(
    Schema.pattern(/^https?:\/\/.+$/),
    Schema.annotations({ description: 'Gerrit server URL' }),
  ),
  username: Schema.String.pipe(
    Schema.minLength(1),
    Schema.annotations({ description: 'Gerrit username' }),
  ),
  password: Schema.String.pipe(
    Schema.minLength(1),
    Schema.annotations({ description: 'HTTP password or API token' }),
  ),
  // CI retrigger comment
  retriggerComment: Schema.optional(Schema.String),
})

export type AppConfig = Schema.Schema.Type<typeof AppConfig>

// Schema for validating legacy nested config structure
const LegacyNestedConfig = Schema.Struct({
  credentials: Schema.Struct({
    host: Schema.String.pipe(
      Schema.pattern(/^https?:\/\/.+$/),
      Schema.annotations({ description: 'Gerrit server URL' }),
    ),
    username: Schema.String.pipe(Schema.minLength(1)),
    password: Schema.String.pipe(Schema.minLength(1)),
  }),
})

type LegacyNestedConfig = Schema.Schema.Type<typeof LegacyNestedConfig>

// Helper to convert from legacy nested format to flat format with validation
export const migrateFromNestedConfig = (nested: unknown): AppConfig => {
  const validatedNested = Schema.decodeUnknownSync(LegacyNestedConfig)(nested)

  const flatConfig = {
    host: validatedNested.credentials.host,
    username: validatedNested.credentials.username,
    password: validatedNested.credentials.password,
  }

  return Schema.decodeUnknownSync(AppConfig)(flatConfig)
}
