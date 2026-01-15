# ADR 0021: TypeScript Isolated Declarations

## Status

Accepted

## Context

TypeScript 5.5+ introduced `isolatedDeclarations` which requires explicit return type annotations on exported functions. This improves declaration file generation.

## Decision

Enable `isolatedDeclarations: true` in tsconfig.json.

## Rationale

- **Faster builds**: Declaration files generated without full type-check
- **Explicit types**: Forces documentation of public API
- **Parallel builds**: Enables parallel .d.ts generation
- **Better tooling**: IDEs understand types without inference

## Consequences

### Positive
- Declaration files are accurate and fast to generate
- Public API is self-documenting
- Catches missing type annotations
- Better for SDK consumers

### Negative
- More verbose code (explicit return types)
- Learning curve for developers
- Some Effect patterns require workarounds

## Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "isolatedDeclarations": true,
    "declaration": true,
    "strict": true,
    "noEmit": true
  }
}
```

## Code Changes Required

```typescript
// Before (inferred return type)
export const getChange = (id: string) =>
  Effect.gen(function* () {
    const api = yield* GerritApiService
    return yield* api.getChange(id)
  })

// After (explicit return type)
export const getChange = (id: string): Effect.Effect<ChangeInfo, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const api = yield* GerritApiService
    return yield* api.getChange(id)
  })
```

## Common Patterns

```typescript
// Simple functions - explicit return
export const add = (a: number, b: number): number => a + b

// Effect functions - full type signature
export const fetchData = (): Effect.Effect<Data, ApiError, ApiService> =>
  Effect.gen(function* () { ... })

// Constants - as const for literal types
export const STATUS_OPTIONS = ['NEW', 'MERGED', 'ABANDONED'] as const
```

## Enforcement

TypeScript compiler enforces this automatically when enabled. Build fails if any exported function lacks explicit return type annotation.
