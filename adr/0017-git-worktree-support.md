# ADR 0017: Git Worktree Support

## Status

Accepted

## Context

Git worktrees allow multiple working directories for a single repository. Many developers use worktrees for parallel work on multiple changes.

## Decision

Fully support git worktrees in all git-related operations.

## Rationale

- **Common workflow**: Worktrees are popular for code review
- **Parallel development**: Work on multiple changes simultaneously
- **Clean separation**: Each worktree is isolated

## Worktree Challenges

1. `.git` is a file pointing to main repo, not a directory
2. Hooks live in main repo's `.git/hooks`, not worktree
3. `git rev-parse` behaves differently in worktrees
4. Branch tracking differs between worktrees

## Consequences

### Positive
- Works for developers using worktrees
- No special configuration needed
- Automatic detection of worktree context

### Negative
- More complex git detection logic
- Hook installation must find main repo
- Path resolution is more complex

## Implementation

```typescript
// src/services/git-worktree.ts
export const isWorktree = async (): Promise<boolean> => {
  const gitDir = await runGit(['rev-parse', '--git-dir'])
  const gitFile = Bun.file(path.join(process.cwd(), '.git'))

  // In worktree, .git is a file, not directory
  return await gitFile.exists() && !(await gitFile.stat()).isDirectory()
}

export const getMainGitDir = async (): Promise<string> => {
  // Returns the main repo's .git directory, even in worktree
  const { stdout } = await runGit(['rev-parse', '--git-common-dir'])
  return path.resolve(stdout.trim())
}

export const getHooksDir = async (): Promise<string> => {
  const mainGitDir = await getMainGitDir()
  return path.join(mainGitDir, 'hooks')
}
```

## Hook Installation

```typescript
// Install hook in main repo, not worktree
export const installCommitHook = async (): Promise<void> => {
  const hooksDir = await getHooksDir()
  const hookPath = path.join(hooksDir, 'commit-msg')

  // Check if already installed
  if (await Bun.file(hookPath).exists()) {
    return
  }

  // Download and install Gerrit hook
  const hookContent = await fetchGerritHook()
  await Bun.write(hookPath, hookContent, { mode: 0o755 })
}
```

## Worktree Creation

```typescript
// ger checkout creates worktree for change review
export const createReviewWorktree = async (changeId: string): Promise<string> => {
  const worktreePath = `../review-${changeId}`
  await runGit(['worktree', 'add', worktreePath])
  return path.resolve(worktreePath)
}
```

## Path Resolution

```typescript
// Always resolve to absolute paths
export const resolveGitPath = async (relativePath: string): Promise<string> => {
  const toplevel = await runGit(['rev-parse', '--show-toplevel'])
  return path.resolve(toplevel.trim(), relativePath)
}
```
