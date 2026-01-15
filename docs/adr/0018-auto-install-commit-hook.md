# ADR 0018: Auto-Install Gerrit Commit-msg Hook

## Status

Accepted

## Context

Gerrit requires a Change-Id footer in commit messages. This is typically added by a commit-msg hook that must be installed manually.

## Decision

Auto-install the Gerrit commit-msg hook when pushing if not present.

## Rationale

- **Convenience**: Users don't need manual setup
- **Error prevention**: Avoid "missing Change-Id" rejections
- **Standard practice**: Same hook Gerrit provides
- **Idempotent**: Safe to run multiple times

## Consequences

### Positive
- Just works out of the box
- No manual hook installation
- Consistent Change-Id format
- Reduces onboarding friction

### Negative
- Modifies user's git hooks
- Hook download requires network
- Must handle worktrees correctly

## Implementation

```typescript
// src/services/commit-hook.ts
export const ensureCommitHook = async (gerritHost: string): Promise<void> => {
  const hooksDir = await getHooksDir()
  const hookPath = path.join(hooksDir, 'commit-msg')

  // Check if hook exists and is executable
  try {
    const stat = await Bun.file(hookPath).stat()
    if (stat.mode & 0o111) {
      return // Already installed and executable
    }
  } catch {
    // Hook doesn't exist, continue to install
  }

  // Download from Gerrit
  const hookUrl = `${gerritHost}/tools/hooks/commit-msg`
  const response = await fetch(hookUrl)

  if (!response.ok) {
    throw new Error(`Failed to download commit-msg hook: ${response.status}`)
  }

  const hookContent = await response.text()

  // Write with executable permissions
  await Bun.write(hookPath, hookContent, { mode: 0o755 })

  console.log(`Installed commit-msg hook to ${hookPath}`)
}
```

## Hook Behavior

The Gerrit commit-msg hook:
1. Checks if Change-Id already exists in message
2. If not, generates a unique Change-Id
3. Appends `Change-Id: I...` to commit message
4. Change-Id is SHA-1 based on tree, parent, author, committer

## When to Install

```typescript
// Install before push operations
export const pushCommand = (options: PushOptions) =>
  Effect.gen(function* () {
    const config = yield* ConfigService

    // Ensure hook is installed before push
    yield* Effect.tryPromise(() => ensureCommitHook(config.host))

    // Proceed with push
    yield* performPush(options)
  })
```

## Manual Override

Users can skip auto-install:
```bash
# Environment variable
GERRIT_SKIP_HOOK=1 ger push

# Or install their own hook
# (ger won't overwrite existing executable hooks)
```
