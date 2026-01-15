# ADR 0005: Use Effect Schema for Data Validation

## Status

Accepted

## Context

We need to validate data from external sources (Gerrit API, user input, config files). Options considered:

1. **Zod** - Popular, simple API, runtime validation
2. **io-ts** - Functional, integrates with fp-ts
3. **Effect Schema** - Part of Effect ecosystem, type inference
4. **Manual validation** - No dependencies, full control

## Decision

Use Effect Schema for all data validation.

## Rationale

- **Effect integration**: Seamless with Effect error handling
- **Single source of truth**: Schema defines type AND validation
- **Composable**: Schemas compose with `Schema.Struct`, `Schema.Array`, etc.
- **Branded types**: Support for refined types with constraints
- **Decode/Encode**: Bidirectional transformations supported

## Consequences

### Positive
- Types inferred from schemas automatically
- Validation errors are structured, not strings
- Reusable in tests with MSW mock validation
- Compile-time and runtime safety

### Negative
- Learning curve for Schema DSL
- Larger bundle than Zod
- Less documentation than mainstream libraries

## Implementation

```typescript
// src/schemas/gerrit.ts
import { Schema } from '@effect/schema'

export const ChangeInfo = Schema.Struct({
  id: Schema.String,
  _number: Schema.Number,
  project: Schema.String,
  branch: Schema.String,
  subject: Schema.String,
  status: Schema.Literal('NEW', 'MERGED', 'ABANDONED', 'DRAFT'),
  owner: Schema.Struct({
    _account_id: Schema.Number,
    name: Schema.optional(Schema.String),
    email: Schema.optional(Schema.String),
  }),
  created: Schema.String,
  updated: Schema.String,
})

// Type is inferred
export type ChangeInfo = Schema.Schema.Type<typeof ChangeInfo>
```

## Tagged Errors

Effect Schema supports tagged errors for type-safe error handling:

```typescript
export class ApiError extends Schema.TaggedError<ApiError>()('ApiError', {
  message: Schema.String,
  statusCode: Schema.Number,
  url: Schema.String,
}) {}

// Usage
Effect.catchTag('ApiError', (error) => {
  console.error(`API failed: ${error.message} (${error.statusCode})`)
})
```

## Validation in API Layer

```typescript
const parseResponse = <T>(schema: Schema.Schema<T>, data: unknown): Effect.Effect<T, ApiError> =>
  Schema.decodeUnknown(schema)(data).pipe(
    Effect.mapError((parseError) =>
      new ApiError({ message: 'Invalid response format', statusCode: 500, url: '' })
    )
  )
```
