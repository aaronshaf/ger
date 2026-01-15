# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │  show   │ │ comment │ │  push   │ │ review  │  ...      │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │
└───────┼───────────┼───────────┼───────────┼─────────────────┘
        │           │           │           │
┌───────┴───────────┴───────────┴───────────┴─────────────────┐
│                      Service Layer                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ GerritApi    │ │ ConfigService│ │ ReviewStrategy│        │
│  │ Service      │ │              │ │              │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└───────┬───────────────────────────────────────────────────────┘
        │
┌───────┴─────────────────────────────────────────────────────┐
│                     External Systems                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Gerrit API   │ │ Git (spawn)  │ │ AI Tools     │        │
│  │              │ │              │ │ (claude/llm) │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── cli/                    # CLI interface layer
│   ├── index.ts           # Entry point, command registration
│   ├── register-commands.ts    # Main command setup
│   ├── register-group-commands.ts  # Group commands
│   └── commands/          # Individual commands
│       ├── show.ts
│       ├── comment.ts
│       ├── push.ts
│       └── ... (27 commands)
│
├── api/                    # External API clients
│   └── gerrit.ts          # Gerrit REST API service
│
├── services/              # Business logic services
│   ├── config.ts          # Configuration management
│   ├── review-strategy.ts # AI tool strategies
│   ├── git-worktree.ts    # Git worktree operations
│   └── commit-hook.ts     # Gerrit hook installation
│
├── schemas/               # Data validation schemas
│   ├── gerrit.ts          # Gerrit API types
│   └── config.ts          # Config file schema
│
├── utils/                 # Shared utilities
│   ├── change-id.ts       # Change identifier parsing
│   ├── git-commit.ts      # Git operations
│   ├── formatters.ts      # Output formatting
│   ├── shell-safety.ts    # XML/CDATA handling
│   └── ... (diff, comment, review utils)
│
├── prompts/               # AI review prompts
│   ├── default-review.md
│   ├── system-inline-review.md
│   └── system-overall-review.md
│
└── i18n/                  # Internationalization (planned)

tests/
├── unit/                  # Pure function tests
├── integration/           # API + command tests
├── mocks/                 # MSW handlers
└── helpers/               # Test utilities
```

## Dependency Injection

Effect Layers provide dependency injection:

```typescript
// Define service interface
interface GerritApiService {
  readonly getChange: (id: string) => Effect.Effect<ChangeInfo, ApiError>
  readonly listChanges: (query?: string) => Effect.Effect<ChangeInfo[], ApiError>
  // ...
}

// Create service tag
const GerritApiService = Context.GenericTag<GerritApiService>('GerritApiService')

// Implement live service
const GerritApiServiceLive = Layer.succeed(GerritApiService, {
  getChange: (id) => Effect.gen(function* () {
    const config = yield* ConfigService
    const response = yield* fetchJson(`${config.host}/a/changes/${id}`)
    return yield* Schema.decodeUnknown(ChangeInfo)(response)
  }),
  // ...
})

// Use in commands
const showCommand = Effect.gen(function* () {
  const api = yield* GerritApiService
  const change = yield* api.getChange(changeId)
  console.log(formatChange(change))
})

// Provide layers at runtime
Effect.runPromise(
  showCommand.pipe(
    Effect.provide(GerritApiServiceLive),
    Effect.provide(ConfigServiceLive)
  )
)
```

## Error Handling

Tagged errors with Effect Schema:

```typescript
// Define error types
export class ApiError extends Schema.TaggedError<ApiError>()('ApiError', {
  message: Schema.String,
  statusCode: Schema.Number,
  url: Schema.String,
}) {}

export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  message: Schema.String,
}) {}

// Handle by tag
Effect.catchTag('ApiError', (error) => {
  console.error(`API Error: ${error.message} (${error.statusCode})`)
  return Effect.succeed(null)
})

// Or let errors propagate
Effect.runPromise(effect).catch((error) => {
  if (error._tag === 'ApiError') {
    console.error(`API failed: ${error.message}`)
  }
})
```

## Data Flow

### Read Operation (show command)

```
User: ger show 12345
         │
         ▼
┌─────────────────────┐
│ Parse arguments     │
│ Normalize change ID │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Load config         │
│ (~/.ger/config.json)│
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ API: GET /changes   │
│ Validate response   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Format output       │
│ (text/xml/json)     │
└─────────┬───────────┘
          │
          ▼
       Console
```

### Write Operation (comment command)

```
User: echo '...' | ger comment 12345
         │
         ▼
┌─────────────────────┐
│ Parse stdin (JSON)  │
│ Validate schema     │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Load config         │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ API: POST /review   │
│ (batch comments)    │
└─────────┬───────────┘
          │
          ▼
       Success/Error
```

## AI Integration Flow

```
User: ger review 12345
         │
         ▼
┌─────────────────────┐
│ Fetch change diff   │
│ (API: GET /patch)   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Detect AI tool      │
│ (claude/llm/etc)    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐     ┌─────────────────────┐
│ Stage 1: Inline     │────►│ AI: Generate inline │
│ comments            │     │ comments JSON       │
└─────────┬───────────┘     └─────────────────────┘
          │
          ▼
┌─────────────────────┐     ┌─────────────────────┐
│ Stage 2: Overall    │────►│ AI: Generate        │
│ review              │     │ summary             │
└─────────┬───────────┘     └─────────────────────┘
          │
          ▼
┌─────────────────────┐
│ API: POST /review   │
│ (all comments)      │
└─────────────────────┘
```

## Configuration Architecture

```
Priority: File > Environment > Error

┌─────────────────────────────────────┐
│ ~/.ger/config.json                  │
│ {                                   │
│   "host": "https://gerrit.com",     │
│   "username": "user",               │
│   "password": "token",              │
│   "aiTool": "claude",               │
│   "aiAutoDetect": true              │
│ }                                   │
└─────────────────────────────────────┘
              │
              ▼ (file not found)
┌─────────────────────────────────────┐
│ Environment Variables               │
│ GERRIT_HOST                         │
│ GERRIT_USERNAME                     │
│ GERRIT_PASSWORD                     │
└─────────────────────────────────────┘
              │
              ▼ (not set)
┌─────────────────────────────────────┐
│ ConfigError: No credentials found   │
└─────────────────────────────────────┘
```

## Testing Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Test Runner (Bun)                      │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Unit Tests   │   │  Integration  │   │  E2E Tests    │
│               │   │  Tests        │   │  (manual)     │
│ - Schemas     │   │ - Commands    │   │               │
│ - Utilities   │   │ - API flows   │   │ - Full CLI    │
│ - Formatters  │   │ - Services    │   │ - Real Gerrit │
└───────────────┘   └───────┬───────┘   └───────────────┘
                            │
                            ▼
                  ┌───────────────────┐
                  │   MSW Handlers    │
                  │                   │
                  │ Mock HTTP at      │
                  │ network level     │
                  └───────────────────┘
```

## Security Model

```
┌─────────────────────────────────────────────────────────────┐
│ Credential Storage                                          │
│ - File: ~/.ger/config.json (mode 0600)                     │
│ - Never logged or printed in errors                        │
│ - Basic auth over HTTPS only                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Input Validation                                            │
│ - Schema validation on all external data                   │
│ - Git subprocess (no shell=true, no string interpolation)  │
│ - CDATA wrapping for XML output                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Output Sanitization                                         │
│ - Credentials never in output                              │
│ - Error messages sanitized                                 │
│ - XML special chars handled via CDATA                      │
└─────────────────────────────────────────────────────────────┘
```
