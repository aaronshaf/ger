# ADR 0020: Code Coverage Enforcement

## Status

Accepted

## Context

We need to ensure adequate test coverage without slowing down development. Options:

1. **CI-only enforcement** - Check in pipeline, local commits unrestricted
2. **Pre-commit enforcement** - Block commits below threshold
3. **Pre-push enforcement** - Block push if coverage drops
4. **Advisory only** - Report but don't enforce

## Decision

Enforce 80% code coverage threshold in pre-commit and pre-push hooks.

## Rationale

- **Quality gate**: Prevents untested code from entering codebase
- **Fast feedback**: Know immediately if coverage dropped
- **Prevents drift**: Coverage doesn't slowly degrade
- **Meaningful threshold**: 80% balances coverage with practicality

## Thresholds

| Metric | Threshold |
|--------|-----------|
| Lines | 80% |
| Functions | 80% |
| Statements | 80% |
| Branches | 80% |

## Consequences

### Positive
- Consistent test coverage across codebase
- Bugs caught before production
- Documentation of behavior via tests
- Confidence in refactoring

### Negative
- May slow commits when adding new code
- Some code is hard to test (UI, edge cases)
- Can encourage gaming metrics vs quality tests

## Exclusions

Excluded from coverage calculations:
- `tmp/` - Temporary files
- `scripts/` - Build scripts
- `*.d.ts` - Type declarations
- Test files themselves

## Configuration

```toml
# bunfig.toml
[test]
coverage = true
coverageThreshold = { line = 80, function = 80, statement = 80, branch = 80 }
coverageSkipTestFiles = true
```

## Enforcement Script

```typescript
// scripts/check-coverage.ts
import { $ } from 'bun'

const result = await $`bun test --coverage`.json()

const thresholds = {
  line: 80,
  function: 80,
  statement: 80,
  branch: 80,
}

let failed = false

for (const [metric, threshold] of Object.entries(thresholds)) {
  const actual = result.coverage[metric]
  if (actual < threshold) {
    console.error(`${metric} coverage ${actual}% < ${threshold}%`)
    failed = true
  }
}

if (failed) {
  process.exit(1)
}
```

## Bypassing (Emergency Only)

```bash
# Skip hooks entirely (discouraged)
git commit --no-verify -m "Emergency fix"

# Add to exclusion list temporarily
# (requires PR review)
```
