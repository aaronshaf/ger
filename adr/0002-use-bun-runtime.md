# ADR 0002: Use Bun Runtime

## Status

Accepted

## Context

We need to choose a JavaScript/TypeScript runtime for the CLI tool. Options considered:

1. **Node.js** - Most common, widely supported
2. **Deno** - Modern, secure by default, built-in TypeScript
3. **Bun** - Fast, native TypeScript, all-in-one toolchain

## Decision

Use Bun 1.2.0+ as the runtime.

## Rationale

- **Native TypeScript**: No compilation step needed, run `.ts` files directly
- **Speed**: Faster startup time than Node.js (~4x faster cold start)
- **All-in-one**: Package manager, test runner, bundler included
- **SQLite built-in**: Native SQLite support for future caching needs
- **Consistency**: Matches `ji` and `cn` projects (same author)

## Consequences

### Positive
- No separate build step for development
- Faster CLI startup time (important for frequently-run tool)
- Single tool for package management, testing, and running
- Built-in test runner with coverage support

### Negative
- Smaller ecosystem than Node.js
- Some npm packages may have compatibility issues
- Users must install Bun (not pre-installed like Node on many systems)
- Breaking changes between Bun versions possible

## Version Requirements

```typescript
// src/cli/index.ts
const [major, minor] = Bun.version.split('.').map(Number)
if (major < 1 || (major === 1 && minor < 2)) {
  console.error('ger requires Bun 1.2.0 or later')
  process.exit(1)
}
```

## Build Configuration

```json
// package.json
{
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit && echo 'Build successful - CLI runs directly with bun'",
    "dev": "bun run src/cli/index.ts",
    "test": "bun test"
  }
}
```
