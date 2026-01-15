# ADR 0014: Group Management Support

## Status

Accepted

## Context

Gerrit uses groups for access control and reviewer assignment. Large teams need to manage groups and add them as reviewers efficiently.

## Decision

Implement full group management commands: `groups`, `groups-show`, `groups-members`.

## Rationale

- **Team workflows**: Add entire teams as reviewers at once
- **Discovery**: Find groups by name, owner, project
- **Visibility**: See group membership without Gerrit UI
- **Automation**: Script group-based reviewer assignment

## Commands

| Command | Purpose |
|---------|---------|
| `groups` | List groups with filtering |
| `groups-show <id>` | Detailed group information |
| `groups-members <id>` | List group members |
| `add-reviewer --group` | Add group as reviewer |

## Consequences

### Positive
- Efficient team reviewer management
- Discoverable group information
- Scriptable group operations
- Consistent with other ger commands

### Negative
- Additional API endpoints to maintain
- Group permissions can be complex
- LDAP groups may have sync delays

## Implementation

```typescript
// List groups with filters
export const listGroups = (options: GroupListOptions) =>
  Effect.gen(function* () {
    const api = yield* GerritApiService
    const params = new URLSearchParams()

    if (options.pattern) params.set('m', options.pattern)
    if (options.owned) params.set('owned', '')
    if (options.project) params.set('p', options.project)
    if (options.user) params.set('user', options.user)

    return yield* api.listGroups(params)
  })
```

## Filtering Options

```bash
# Filter by name pattern
ger groups --pattern "team-*"

# Groups I own
ger groups --owned

# Groups with access to project
ger groups --project canvas-lms

# Groups a user belongs to
ger groups --user john.doe
```

## Add Group as Reviewer

```bash
# Add group to change
ger add-reviewer 12345 --group frontend-team

# Add as CC instead of reviewer
ger add-reviewer 12345 --group frontend-team --cc
```

## API Endpoints

```
GET /a/groups/                    # List groups
GET /a/groups/{id}                # Group info
GET /a/groups/{id}/detail         # Detailed info with members
GET /a/groups/{id}/members        # Member list
```
