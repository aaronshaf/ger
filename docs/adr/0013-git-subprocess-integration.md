# ADR 0013: Git Subprocess Integration

## Status

Accepted

## Context

We need to interact with Git for checkout, push, commit-msg hooks, and detecting Change-IDs. Options considered:

1. **isomorphic-git** - Pure JS Git implementation
2. **simple-git** - Node.js Git wrapper
3. **nodegit** - libgit2 bindings
4. **Subprocess spawning** - Shell out to git

## Decision

Shell out to the `git` command via `Bun.spawn()` rather than using a library.

## Rationale

- **No dependency**: Git is already installed on dev machines
- **Full feature support**: All git features available
- **Worktree support**: Libraries often struggle with worktrees
- **Familiar output**: Same output as manual git commands
- **No native bindings**: Avoid node-gyp/native module issues

## Consequences

### Positive
- Zero additional dependencies for Git
- Works with any Git version
- Full worktree support out of box
- Same behavior as command line

### Negative
- Error handling is string parsing
- Platform-specific edge cases
- Subprocess overhead per call
- Security: must sanitize inputs

## Implementation

```typescript
// src/utils/git-commit.ts
export const runGit = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  const proc = Bun.spawn(['git', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new GitError({ message: stderr.trim(), exitCode })
  }

  return { stdout: stdout.trim(), stderr: stderr.trim() }
}
```

## Security Considerations

```typescript
// Validate ref names to prevent injection
const isValidRefName = (ref: string): boolean => {
  // Git ref naming rules
  return /^[a-zA-Z0-9_\-/.]+$/.test(ref) &&
    !ref.includes('..') &&
    !ref.startsWith('-')
}

// Use array args, not shell string
// GOOD: spawn(['git', 'checkout', branchName])
// BAD:  spawn(`git checkout ${branchName}`, { shell: true })
```

## Worktree Detection

```typescript
// Handles both regular repos and worktrees
export const getGitDir = async (): Promise<string> => {
  const { stdout } = await runGit(['rev-parse', '--git-dir'])
  return path.resolve(stdout)
}
```

## Change-ID Extraction

```typescript
export const extractChangeIdFromHead = async (): Promise<string | null> => {
  const { stdout } = await runGit(['log', '-1', '--format=%b'])
  const match = stdout.match(/Change-Id: (I[0-9a-f]{40})/)
  return match ? match[1] : null
}
```
