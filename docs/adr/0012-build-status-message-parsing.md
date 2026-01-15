# ADR 0012: Build Status via Message Parsing

## Status

Accepted

## Context

We need to report CI/CD build status for changes. Gerrit doesn't have a standard build status API - different instances configure CI differently.

## Decision

Parse change messages for build status patterns rather than relying on specific labels or plugins.

## Rationale

- **Universal**: Works with any Gerrit instance
- **No plugin dependency**: Doesn't require specific CI integration
- **Flexible**: Patterns can be adjusted per instance
- **Observable**: Same info visible in Gerrit UI

## Detected States

| State | Detection Pattern |
|-------|-------------------|
| `pending` | No build-related messages yet |
| `running` | "Build Started" message found |
| `success` | "Verified +1" after build messages |
| `failure` | "Verified -1" after build messages |
| `not_found` | Change doesn't exist |

## Consequences

### Positive
- Works out of box with most Gerrit setups
- No additional configuration needed
- Same logic users apply mentally

### Negative
- Pattern matching can have false positives
- Doesn't work with non-standard CI messages
- Can't get detailed build logs

## Implementation

```typescript
// src/cli/commands/build-status.ts
const detectBuildState = (messages: ChangeMessage[]): BuildState => {
  const sorted = [...messages].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  let buildStarted = false
  let lastVerified: number | null = null

  for (const msg of sorted) {
    if (msg.message.includes('Build Started')) {
      buildStarted = true
    }
    const verifiedMatch = msg.message.match(/Verified([+-]\d)/)
    if (verifiedMatch) {
      lastVerified = parseInt(verifiedMatch[1])
    }
  }

  if (lastVerified === 1) return 'success'
  if (lastVerified === -1) return 'failure'
  if (buildStarted) return 'running'
  return 'pending'
}
```

## Watch Mode

```bash
# Poll until terminal state
ger build-status 12345 --watch --interval 30 --timeout 1800

# Exit codes for CI pipelines
# 0: completed (any state, like gh run watch)
# 1: failure (only with --exit-status)
# 2: timeout
# 3: API error
```

## JSON Output

```json
{
  "changeId": "12345",
  "state": "running",
  "lastMessage": "Build Started: https://jenkins.example.com/job/123"
}
```
