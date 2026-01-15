# ADR 0019: SDK Package Exports

## Status

Accepted

## Context

Beyond CLI usage, developers may want to use ger programmatically in their own tools, scripts, or automation.

## Decision

Export SDK modules for programmatic usage via package.json exports.

## Rationale

- **Reusability**: Build custom tools on top of ger
- **Testing**: Import specific modules in tests
- **Automation**: Script Gerrit operations
- **Type safety**: Full TypeScript types included

## Export Structure

```json
// package.json
{
  "name": "@aaronshaf/ger",
  "exports": {
    ".": "./src/index.ts",
    "./api/gerrit": "./src/api/gerrit.ts",
    "./services/config": "./src/services/config.ts",
    "./schemas/gerrit": "./src/schemas/gerrit.ts",
    "./utils": "./src/utils/index.ts"
  }
}
```

## Consequences

### Positive
- Build custom integrations
- Reuse validated schemas
- Access type-safe API client
- Import only what you need

### Negative
- More surface area to maintain
- Breaking changes affect SDK users
- Documentation burden

## Usage Examples

```typescript
// Import API service
import { GerritApiService, GerritApiServiceLive } from '@aaronshaf/ger'
import { Effect } from 'effect'

// Custom automation
const myScript = Effect.gen(function* () {
  const api = yield* GerritApiService
  const changes = yield* api.listChanges('owner:self status:open')

  for (const change of changes) {
    console.log(`${change._number}: ${change.subject}`)
  }
})

Effect.runPromise(
  myScript.pipe(Effect.provide(GerritApiServiceLive))
)
```

```typescript
// Import schemas for validation
import { ChangeInfo } from '@aaronshaf/ger/schemas/gerrit'
import { Schema } from '@effect/schema'

const validateChange = (data: unknown) =>
  Schema.decodeUnknownSync(ChangeInfo)(data)
```

```typescript
// Import utilities
import { normalizeChangeIdentifier, extractChangeIdFromCommitMessage } from '@aaronshaf/ger/utils'

const changeId = normalizeChangeIdentifier('https://gerrit.example.com/c/project/+/12345')
```

## API Documentation

See EXAMPLES.md for detailed SDK usage patterns:
- Effect-based API calls
- Config service setup
- Custom change processing
- Batch operations
