# ADR 0008: Prohibit `as` Type Casting

## Status

Accepted

## Context

TypeScript's `as` keyword allows bypassing type safety. This can hide bugs and defeat the purpose of type checking. We need a policy on type assertions.

## Decision

Prohibit `as` type casting except for `as const` and `as unknown` (required for Effect Schema workarounds).

## Rationale

- **Type safety**: `as` bypasses TypeScript's guarantees
- **Hidden bugs**: Incorrect casts cause runtime errors
- **Better alternatives**: Type guards, generics, schema validation
- **Code review**: Hard to catch incorrect casts in review

## Exceptions

### Allowed: `as const`

```typescript
// Allowed - creates literal types
const statuses = ['NEW', 'MERGED', 'ABANDONED'] as const
```

### Allowed: `as unknown` (Effect Schema workaround)

```typescript
// Required for Effect Schema TaggedError pattern
export class ApiError
  extends (ApiErrorSchema as unknown as new (
    args: ApiErrorFields,
  ) => ApiErrorFields & Error & { readonly _tag: 'ApiError' })
  implements Error
{ ... }
```

## Consequences

### Positive
- Compile-time errors instead of runtime crashes
- Forces proper type design
- More maintainable code
- Better IDE support

### Negative
- More verbose in some cases
- Effect Schema requires workarounds
- Learning curve for developers used to `as`

## Enforcement

ast-grep rules (in progress):

```yaml
# sgconfig.yml
rules:
  - id: no-as-casting
    pattern: $EXPR as $TYPE
    except:
      - $EXPR as const
      - $EXPR as unknown
    message: "Avoid 'as' type casting. Use type guards or schema validation."
```

## Alternatives to `as`

```typescript
// Instead of: const x = data as ChangeInfo

// Use schema validation
const x = Schema.decodeUnknownSync(ChangeInfo)(data)

// Or type guards
function isChangeInfo(data: unknown): data is ChangeInfo {
  return typeof data === 'object' && data !== null && '_number' in data
}
```
