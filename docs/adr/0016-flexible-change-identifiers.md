# ADR 0016: Flexible Change Identifiers

## Status

Accepted

## Context

Gerrit changes can be identified by numeric ID (12345) or Change-ID (I1234567890abcdef...). Users may have either and shouldn't need to convert.

## Decision

Accept both numeric change IDs and full Change-IDs in all commands.

## Rationale

- **User convenience**: No mental mapping required
- **Copy-paste friendly**: Works with whatever user has
- **Gerrit API compatible**: API accepts both formats
- **Auto-detection**: Can detect from HEAD commit

## Identifier Formats

| Format | Example | Regex |
|--------|---------|-------|
| Numeric | `12345` | `/^\d+$/` |
| Change-ID | `If5a3ae8cb5a107e187447802358417f311d0c4b1` | `/^I[0-9a-f]{40}$/` |
| Full triplet | `project~branch~Change-Id` | Complex |

## Consequences

### Positive
- Works with URLs, commits, or manual entry
- No conversion needed
- Matches Gerrit web UI behavior

### Negative
- Validation logic in every command
- API may need to handle both
- Error messages need to cover both formats

## Implementation

```typescript
// src/utils/change-id.ts
export const isChangeNumber = (id: string): boolean =>
  /^\d+$/.test(id)

export const isChangeId = (id: string): boolean =>
  /^I[0-9a-f]{40}$/i.test(id)

export const normalizeChangeIdentifier = (input: string): string => {
  // Already valid
  if (isChangeNumber(input) || isChangeId(input)) {
    return input
  }

  // Try to extract from URL
  const urlMatch = input.match(/\/c\/[^/]+\/\+\/(\d+)/)
  if (urlMatch) return urlMatch[1]

  // Try to extract Change-ID from text
  const cidMatch = input.match(/(I[0-9a-f]{40})/i)
  if (cidMatch) return cidMatch[1]

  throw new Error(`Invalid change identifier: ${input}`)
}
```

## Auto-Detection from Git

```typescript
export const detectChangeFromHead = async (): Promise<string | null> => {
  try {
    const { stdout } = await runGit(['log', '-1', '--format=%b'])
    const match = stdout.match(/Change-Id: (I[0-9a-f]{40})/i)
    return match ? match[1] : null
  } catch {
    return null
  }
}
```

## Command Usage

```bash
# All equivalent
ger show 12345
ger show If5a3ae8cb5a107e187447802358417f311d0c4b1
ger show https://gerrit.example.com/c/project/+/12345

# Auto-detect from current commit
ger show  # Uses Change-ID from HEAD
```
