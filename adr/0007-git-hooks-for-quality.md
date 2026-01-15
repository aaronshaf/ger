# ADR 0007: Git Hooks for Code Quality

## Status

Accepted

## Context

We need to enforce code quality standards automatically. Options considered:

1. **CI-only checks** - Run in pipeline, no local enforcement
2. **Manual commands** - Developers run checks before committing
3. **Git hooks** - Automatic checks on commit/push
4. **IDE integration** - Real-time feedback in editor

## Decision

Use Husky + lint-staged for pre-commit hooks, with additional pre-push validation.

## Rationale

- **Automatic enforcement**: Can't forget to run checks
- **Fast feedback**: Catch issues before push, not in CI
- **Staged files only**: lint-staged only checks changed files (fast)
- **Consistent**: All developers run same checks

## Consequences

### Positive
- Consistent code quality across all commits
- Fast local feedback
- Prevents broken commits from reaching CI
- Staged-only linting is fast

### Negative
- Initial setup required (Husky install)
- Can slow down commits if checks are slow
- Developers may skip with `--no-verify` (discouraged)

## Pre-commit Checks

```bash
# .husky/pre-commit
bun lint-staged
bun run scripts/check-file-size.ts
```

## lint-staged Configuration

```json
// package.json
{
  "lint-staged": {
    "*.ts": [
      "biome format --write",
      "oxlint"
    ]
  }
}
```

## Pre-push Checks

```bash
# .husky/pre-push
bun run build
bun test
bun run test:coverage:check
```

## File Size Enforcement

Custom script checks file lengths:

```typescript
// scripts/check-file-size.ts
const WARN_THRESHOLD = 500  // lines
const ERROR_THRESHOLD = 700 // lines

// Warn at 500, error at 700 lines
// Excludes: generated files, tmp/, node_modules/
```

## Coverage Enforcement

```typescript
// scripts/check-coverage.ts
const THRESHOLDS = {
  line: 80,
  function: 80,
  statement: 80,
  branch: 80,
}
```
