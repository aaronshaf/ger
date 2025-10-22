import { Schema } from '@effect/schema'

// Flat Application Configuration (similar to ji structure)
export const AppConfig: Schema.Struct<{
  host: typeof Schema.String
  username: typeof Schema.String
  password: typeof Schema.String
  aiTool: Schema.optional<Schema.Literal<['claude', 'llm', 'opencode', 'gemini']>>
  aiAutoDetect: Schema.optionalWith<typeof Schema.Boolean, { default: () => boolean }>
}> = Schema.Struct({
  // Gerrit credentials (flattened)
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
  // AI configuration (flattened)
  aiTool: Schema.optional(Schema.Literal('claude', 'llm', 'opencode', 'gemini')),
  aiAutoDetect: Schema.optionalWith(Schema.Boolean, { default: (): boolean => true }),
})

export type AppConfig = Schema.Schema.Type<typeof AppConfig>

// Legacy schemas for backward compatibility (deprecated)
export const AiConfig: Schema.Struct<{
  tool: Schema.optional<Schema.Literal<['claude', 'llm', 'opencode', 'gemini']>>
  autoDetect: Schema.optionalWith<typeof Schema.Boolean, { default: () => boolean }>
}> = Schema.Struct({
  tool: Schema.optional(Schema.Literal('claude', 'llm', 'opencode', 'gemini')),
  autoDetect: Schema.optionalWith(Schema.Boolean, { default: (): boolean => true }),
})

export type AiConfig = Schema.Schema.Type<typeof AiConfig>

// Helper to convert from flat config to legacy AI config
export const aiConfigFromFlat = (config: AppConfig): AiConfig => ({
  tool: config.aiTool,
  autoDetect: config.aiAutoDetect,
})

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
  ai: Schema.optional(
    Schema.Struct({
      tool: Schema.optional(Schema.Literal('claude', 'llm', 'opencode', 'gemini')),
      autoDetect: Schema.optional(Schema.Boolean),
    }),
  ),
})

type LegacyNestedConfig = Schema.Schema.Type<typeof LegacyNestedConfig>

// Helper to convert from legacy nested format to flat format with validation
export const migrateFromNestedConfig = (nested: unknown): AppConfig => {
  // Validate input structure using Schema
  const validatedNested = Schema.decodeUnknownSync(LegacyNestedConfig)(nested)

  // Convert to flat structure
  const flatConfig = {
    host: validatedNested.credentials.host,
    username: validatedNested.credentials.username,
    password: validatedNested.credentials.password,
    aiTool: validatedNested.ai?.tool,
    aiAutoDetect: validatedNested.ai?.autoDetect ?? true,
  }

  // Validate the resulting flat config
  return Schema.decodeUnknownSync(AppConfig)(flatConfig)
}
