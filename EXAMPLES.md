# Programmatic Usage Examples

This package can be used both as a CLI tool and as a library. Below are examples of using `@aaronshaf/ger` programmatically with Effect-TS.

## Installation

```bash
bun add @aaronshaf/ger
# or
npm install @aaronshaf/ger
```

## Basic Setup

All services in this package are built with Effect-TS, providing type-safe, composable operations.

### Import the services

```typescript
import { Effect, pipe } from 'effect'
import {
  GerritApiService,
  GerritApiServiceLive,
  ConfigServiceLive,
  type ChangeInfo,
} from '@aaronshaf/ger'
```

## Configuration

### Using Environment Variables

Set these environment variables before running your program:

```bash
export GERRIT_HOST="https://gerrit.example.com"
export GERRIT_USERNAME="your-username"
export GERRIT_PASSWORD="your-http-password"
```

### Using File-Based Config

Or run the CLI once to set up configuration:

```bash
ger setup
```

This stores credentials in `~/.ger/config.json`.

## Examples

### 1. Get Change Information

```typescript
import { Effect, pipe } from 'effect'
import {
  GerritApiService,
  GerritApiServiceLive,
  ConfigServiceLive,
} from '@aaronshaf/ger'

const getChangeDetails = (changeId: string) =>
  Effect.gen(function* () {
    const api = yield* GerritApiService
    const change = yield* api.getChange(changeId)

    console.log(`Change: ${change.subject}`)
    console.log(`Status: ${change.status}`)
    console.log(`Owner: ${change.owner?.name || 'Unknown'}`)

    return change
  })

// Run the program
const program = pipe(
  getChangeDetails('12345'),
  Effect.provide(GerritApiServiceLive),
  Effect.provide(ConfigServiceLive)
)

Effect.runPromise(program)
  .then(() => console.log('Done!'))
  .catch(console.error)
```

### 2. List Open Changes

```typescript
import { Effect, pipe } from 'effect'
import {
  GerritApiService,
  GerritApiServiceLive,
  ConfigServiceLive,
} from '@aaronshaf/ger'

const listMyChanges = Effect.gen(function* () {
  const api = yield* GerritApiService

  // Query for your open changes
  const changes = yield* api.listChanges('is:open owner:self')

  console.log(`You have ${changes.length} open changes:`)
  for (const change of changes) {
    console.log(`  - #${change._number}: ${change.subject}`)
  }

  return changes
})

const program = pipe(
  listMyChanges,
  Effect.provide(GerritApiServiceLive),
  Effect.provide(ConfigServiceLive)
)

Effect.runPromise(program).catch(console.error)
```

### 3. Post a Comment

```typescript
import { Effect, pipe } from 'effect'
import {
  GerritApiService,
  GerritApiServiceLive,
  ConfigServiceLive,
  type ReviewInput,
} from '@aaronshaf/ger'

const postComment = (changeId: string) =>
  Effect.gen(function* () {
    const api = yield* GerritApiService

    const review: ReviewInput = {
      message: 'Looks good to me!',
      labels: {
        'Code-Review': 1,
      },
    }

    yield* api.postReview(changeId, review)
    console.log('Comment posted successfully!')
  })

const program = pipe(
  postComment('12345'),
  Effect.provide(GerritApiServiceLive),
  Effect.provide(ConfigServiceLive)
)

Effect.runPromise(program).catch(console.error)
```

### 4. Post Inline Comments

```typescript
import { Effect, pipe } from 'effect'
import {
  GerritApiService,
  GerritApiServiceLive,
  ConfigServiceLive,
  type ReviewInput,
} from '@aaronshaf/ger'

const postInlineComments = (changeId: string) =>
  Effect.gen(function* () {
    const api = yield* GerritApiService

    const review: ReviewInput = {
      message: 'Review complete',
      comments: {
        'src/api.ts': [
          {
            line: 42,
            message: 'Consider using const here for immutability',
            unresolved: false,
          },
          {
            line: 55,
            message: 'This could cause a security issue',
            unresolved: true,
          },
        ],
        'src/utils.ts': [
          {
            line: 10,
            message: 'Nice refactor!',
          },
        ],
      },
    }

    yield* api.postReview(changeId, review)
    console.log('Inline comments posted!')
  })

const program = pipe(
  postInlineComments('12345'),
  Effect.provide(GerritApiServiceLive),
  Effect.provide(ConfigServiceLive)
)

Effect.runPromise(program).catch(console.error)
```

### 5. Get Diff for a Change

```typescript
import { Effect, pipe } from 'effect'
import {
  GerritApiService,
  GerritApiServiceLive,
  ConfigServiceLive,
  type DiffOptions,
} from '@aaronshaf/ger'

const getDiff = (changeId: string) =>
  Effect.gen(function* () {
    const api = yield* GerritApiService

    // Get unified diff format (default)
    const diff = yield* api.getDiff(changeId, { format: 'unified' })
    console.log('Diff:', diff)

    // Or get list of changed files
    const files = yield* api.getDiff(changeId, { format: 'files' })
    console.log('Changed files:', files)

    return diff
  })

const program = pipe(
  getDiff('12345'),
  Effect.provide(GerritApiServiceLive),
  Effect.provide(ConfigServiceLive)
)

Effect.runPromise(program).catch(console.error)
```

### 6. Test Connection

```typescript
import { Effect, pipe } from 'effect'
import {
  GerritApiService,
  GerritApiServiceLive,
  ConfigServiceLive,
} from '@aaronshaf/ger'

const testConnection = Effect.gen(function* () {
  const api = yield* GerritApiService
  const isConnected = yield* api.testConnection

  if (isConnected) {
    console.log('✓ Connected to Gerrit!')
  } else {
    console.log('✗ Connection failed')
  }

  return isConnected
})

const program = pipe(
  testConnection,
  Effect.provide(GerritApiServiceLive),
  Effect.provide(ConfigServiceLive)
)

Effect.runPromise(program).catch(console.error)
```

### 7. Error Handling with Effect

```typescript
import { Effect, pipe, Console } from 'effect'
import {
  GerritApiService,
  GerritApiServiceLive,
  ConfigServiceLive,
  ApiError,
  ConfigError,
} from '@aaronshaf/ger'

const safeGetChange = (changeId: string) =>
  Effect.gen(function* () {
    const api = yield* GerritApiService
    const change = yield* api.getChange(changeId)
    return change
  }).pipe(
    Effect.catchTag('ApiError', (error) =>
      Console.error(`API Error: ${error.message}`).pipe(
        Effect.map(() => null)
      )
    ),
    Effect.catchTag('ConfigError', (error) =>
      Console.error(`Config Error: ${error.message}`).pipe(
        Effect.map(() => null)
      )
    )
  )

const program = pipe(
  safeGetChange('invalid-change'),
  Effect.provide(GerritApiServiceLive),
  Effect.provide(ConfigServiceLive)
)

Effect.runPromise(program)
```

### 8. Using Utilities

```typescript
import {
  normalizeChangeIdentifier,
  extractChangeIdFromCommitMessage,
  extractChangeNumber,
  normalizeGerritHost,
} from '@aaronshaf/ger'

// Normalize change identifiers
const normalized = normalizeChangeIdentifier('12345')
// or
const normalizedId = normalizeChangeIdentifier('If5a3ae8cb5a107e187447802358417f311d0c4b1')

// Extract change ID from commit message
const commitMsg = `feat: add feature

Change-Id: If5a3ae8cb5a107e187447802358417f311d0c4b1`

const changeId = extractChangeIdFromCommitMessage(commitMsg)
console.log(changeId) // "If5a3ae8cb5a107e187447802358417f311d0c4b1"

// Extract change number from Gerrit URL
const url = 'https://gerrit.example.com/c/project/+/12345'
const changeNumber = extractChangeNumber(url)
console.log(changeNumber) // "12345"

// Normalize Gerrit host
const host = normalizeGerritHost('gerrit.example.com')
console.log(host) // "https://gerrit.example.com"
```

### 9. Working with Schemas

```typescript
import { Schema } from '@effect/schema'
import { Effect } from 'effect'
import { ChangeInfo, ReviewInput } from '@aaronshaf/ger'

// Validate and decode API responses
const validateChange = (data: unknown) =>
  Schema.decodeUnknown(ChangeInfo)(data)

// Validate review input before sending
const validateReview = (review: unknown) =>
  Schema.decodeUnknown(ReviewInput)(review)

// Use in an Effect program
const safeReview = Effect.gen(function* () {
  const review = {
    message: 'LGTM',
    labels: { 'Code-Review': 2 },
  }

  const validated = yield* validateReview(review)
  console.log('Review is valid:', validated)

  return validated
})
```

## Direct Module Access

You can also import directly from specific modules:

```typescript
// Import from specific services
import { GerritApiService, GerritApiServiceLive } from '@aaronshaf/ger/api'
import { ConfigService, ConfigServiceLive } from '@aaronshaf/ger/services/config'

// Import from specific schemas
import { ChangeInfo, ReviewInput } from '@aaronshaf/ger/schemas/gerrit'

// Import utilities
import { normalizeChangeIdentifier, extractChangeNumber } from '@aaronshaf/ger/utils'
```

## TypeScript Configuration

Make sure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "strict": true
  }
}
```

## More Information

- See the [main README](./README.md) for CLI usage
- Check out the [Effect documentation](https://effect.website/) to learn more about Effect-TS
- View the type definitions in your IDE for detailed API documentation
