# ADR 0004: Use Commander.js for CLI Framework

## Status

Accepted

## Context

We need a CLI framework for argument parsing, command routing, and help generation. Options considered:

1. **Ink** - React-like components for terminal UIs
2. **Commander.js** - Classic, stable CLI framework
3. **Yargs** - Feature-rich, complex API
4. **Clipanion** - Type-safe, used by Yarn

## Decision

Use Commander.js for the CLI framework, with Inquirer for interactive prompts.

## Rationale

- **Stability**: Most downloaded CLI framework, battle-tested
- **Simplicity**: Straightforward API for defining commands
- **Features**: Built-in help, version, option parsing
- **Ecosystem**: Wide community support and documentation
- **Consistency**: Matches patterns from other tools

## Consequences

### Positive
- Simple command definition with `.command()`, `.option()`, `.action()`
- Automatic `--help` and `--version` generation
- Subcommand support for complex CLIs
- Well-documented with many examples

### Negative
- Not as type-safe as Clipanion
- Less suitable for complex interactive UIs (use Inquirer instead)
- Callback-based API (wrapped with Effect)

## Implementation

```typescript
// src/cli/index.ts
import { Command } from 'commander'

const program = new Command()
  .name('ger')
  .description('Gerrit CLI tool')
  .version(version)

// Register commands
program
  .command('show [change-id]')
  .description('Show change details')
  .option('--xml', 'Output as XML')
  .action((changeId, options) => {
    // Wrapped in Effect.runPromise
  })
```

## Interactive Prompts

For interactive input, use `@inquirer/prompts`:

```typescript
import { input, select } from '@inquirer/prompts'

const changeId = await select({
  message: 'Select a change to abandon:',
  choices: changes.map(c => ({
    name: `${c._number}: ${c.subject}`,
    value: String(c._number)
  }))
})
```
