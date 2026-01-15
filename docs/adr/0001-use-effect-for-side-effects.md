# ADR 0001: Use Effect for Side Effects

## Status

Accepted

## Context

We need to decide on a strategy for handling side effects (API calls, file I/O, errors) in the `ger` CLI. Options considered:

1. **Traditional try/catch** - Simple but errors lose type information
2. **Result types (manual)** - Explicit but verbose
3. **Effect library** - Type-safe, composable, full dependency injection

## Decision

Use the Effect library for all side effects and dependency injection.

## Rationale

- **Type-safe errors**: Effect tracks error types at compile time via tagged unions
- **Composability**: Operations compose naturally with `Effect.gen` and `pipe()`
- **Dependency injection**: Layers provide testable, swappable dependencies
- **Resource management**: `Effect.scoped` handles cleanup automatically
- **Concurrent operations**: Effect handles parallelism safely

## Consequences

### Positive
- Compile-time error tracking with `Effect.catchTag`
- Clear error handling paths without try/catch
- Testable services via Layer injection
- No runtime surprises from unhandled errors

### Negative
- Learning curve for Effect newcomers
- Additional dependency (~100KB)
- More verbose than simple async/await
- Requires understanding of functional programming patterns

## Example

```typescript
// Tagged error types
export class ApiError extends Schema.TaggedError<ApiError>()('ApiError', {
  message: Schema.String,
  statusCode: Schema.Number,
}) {}

// Effect-based service
export const getChange = (changeId: string): Effect.Effect<ChangeInfo, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const api = yield* GerritApiService
    const change = yield* api.getChange(changeId)
    return change
  })

// Provide dependencies via layers
Effect.runPromise(
  getChange('12345').pipe(
    Effect.provide(GerritApiServiceLive),
    Effect.provide(ConfigServiceLive)
  )
)
```
