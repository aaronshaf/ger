# ADR 0009: Enforce File Size Limits

## Status

Accepted

## Context

Large files are harder to maintain, test, and understand. We need limits to encourage modular code.

## Decision

Enforce file size limits in pre-commit hooks:
- **Warning** at 500 lines
- **Error** (block commit) at 700 lines

## Rationale

- **Maintainability**: Smaller files are easier to understand
- **Single responsibility**: Large files often do too much
- **Code review**: Easier to review smaller, focused files
- **Testing**: Smaller modules are easier to test in isolation

## Consequences

### Positive
- Encourages modular architecture
- Easier code reviews
- Better test coverage (smaller units)
- Faster navigation in IDE

### Negative
- May need refactoring for legitimate large files
- Arbitrary thresholds may not fit all cases
- Some complex modules genuinely need more code

## Exclusions

The following are excluded from size checks:
- `node_modules/`
- `tmp/`
- Generated files
- Test fixture files

## Implementation

```typescript
// scripts/check-file-size.ts
import { glob } from 'glob'

const WARN_THRESHOLD = 500
const ERROR_THRESHOLD = 700

const files = await glob('src/**/*.ts')

for (const file of files) {
  const content = await Bun.file(file).text()
  const lines = content.split('\n').length

  if (lines > ERROR_THRESHOLD) {
    console.error(`ERROR: ${file} has ${lines} lines (max: ${ERROR_THRESHOLD})`)
    process.exit(1)
  } else if (lines > WARN_THRESHOLD) {
    console.warn(`WARN: ${file} has ${lines} lines (consider refactoring)`)
  }
}
```

## Current Large Files

Files approaching limits (as of v0.3.5):
- `src/cli/commands/show.ts` (~400 lines) - display formatting
- `src/cli/commands/comment.ts` (~300 lines) - batch processing
- `src/cli/commands/checkout.ts` (~300 lines) - patchset handling

## Refactoring Strategies

When files approach limits:
1. Extract utility functions to `src/utils/`
2. Split formatters into separate modules
3. Move constants to dedicated files
4. Extract sub-commands to separate files
