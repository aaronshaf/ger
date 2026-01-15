# ADR 0022: Biome Formatter + oxlint Linter

## Status

Accepted

## Context

We need code formatting and linting tools. Options considered:

1. **ESLint + Prettier** - Standard combo, highly configurable
2. **Biome** - Fast, Rust-based formatter and linter
3. **oxlint** - Ultra-fast Rust-based linter
4. **deno fmt/lint** - Built into Deno, not Bun

## Decision

Use Biome for formatting and oxlint for linting.

## Rationale

- **Speed**: Both are Rust-based, extremely fast
- **Compatibility**: Work well with Bun
- **Simple config**: Less configuration than ESLint
- **Modern defaults**: Sensible rules out of the box

## Tool Responsibilities

| Tool | Purpose |
|------|---------|
| Biome | Code formatting (spacing, line breaks, quotes) |
| oxlint | Static analysis (errors, best practices) |

## Consequences

### Positive
- Sub-second formatting on entire codebase
- Near-instant linting
- Fewer dependencies than ESLint ecosystem
- Works in pre-commit without slowdown

### Negative
- Less mature than ESLint (fewer rules)
- Smaller community
- May miss some ESLint-specific rules

## Biome Configuration

```json
// biome.json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": false
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingComma": "all",
      "semicolons": "asNeeded"
    }
  }
}
```

## oxlint Configuration

```json
// .oxlintrc.json
{
  "rules": {
    "no-unused-vars": "error",
    "no-console": "warn",
    "prefer-const": "error"
  },
  "ignorePatterns": [
    "node_modules",
    "tmp",
    "*.d.ts"
  ]
}
```

## lint-staged Integration

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

## Scripts

```json
// package.json
{
  "scripts": {
    "format": "biome format --write .",
    "format:check": "biome format .",
    "lint": "oxlint .",
    "check:all": "bun run format:check && bun run lint && bun run typecheck"
  }
}
```

## Performance Comparison

| Tool | Time (100 files) |
|------|------------------|
| Prettier | ~2s |
| Biome | ~50ms |
| ESLint | ~5s |
| oxlint | ~100ms |
