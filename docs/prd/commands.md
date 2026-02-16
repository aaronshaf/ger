# Commands

Complete specification of all CLI commands.

## Change Viewing

### show

Display comprehensive change information.

```bash
ger show [change-id]
ger show 12345
ger show If5a3ae8...  # Change-ID format
ger show              # Auto-detect from HEAD
```

| Option | Description |
|--------|-------------|
| `--xml` | Output as XML for LLM consumption |
| `--no-diff` | Skip diff output |
| `--no-comments` | Skip comments |

**Output includes:**
- Change metadata (number, project, branch, status)
- Owner, reviewers, and CC information
- Submit requirements
- Full diff
- All comments with context

Reviewer listing for a specific change is provided by `show` (there is no separate `list-reviewers` command).

### diff

Get change diff in various formats.

```bash
ger diff <change-id>
ger diff 12345 --files-only
ger diff 12345 --base 1  # Diff against patchset 1
```

| Option | Description |
|--------|-------------|
| `--xml` | Output as XML |
| `--files-only` | List only changed files |
| `--base <ps>` | Diff against specific patchset |

### comments

View all comments on a change with diff context.

```bash
ger comments <change-id>
ger comments 12345 --xml
```

| Option | Description |
|--------|-------------|
| `--xml` | Output as XML |
| `--context <n>` | Lines of context (default: 3) |

### search

Query changes with Gerrit syntax.

```bash
ger search "owner:self status:open"
ger search "project:canvas-lms branch:main"
```

| Option | Description |
|--------|-------------|
| `--xml` | Output as XML |
| `--limit <n>` | Max results (default: 25) |

## Change Management

### mine

List user's open changes.

```bash
ger mine
ger mine --xml
```

**Output:** Changes grouped by project with status indicators.

### incoming

View changes needing your review.

```bash
ger incoming
ger incoming --xml
```

**Output:** Changes where you're a reviewer, grouped by project.

### abandon

Abandon a change.

```bash
ger abandon <change-id>
ger abandon <change-id> -m "No longer needed"
ger abandon  # Interactive selection
```

| Option | Description |
|--------|-------------|
| `-m <message>` | Abandon reason |

### restore

Restore an abandoned change.

```bash
ger restore <change-id>
ger restore <change-id> -m "Needed after all"
```

### workspace

View local git branch tracking information.

```bash
ger workspace
```

**Output:** Current branch and associated Gerrit change.

### topic

Get, set, or remove topic for a change.

```bash
ger topic [change-id]              # View current topic (auto-detect from HEAD)
ger topic [change-id] <topic>      # Set topic
ger topic [change-id] --delete     # Remove topic
ger topic [change-id] --xml        # XML output
```

| Option | Description |
|--------|-------------|
| `--delete` | Remove the topic from the change |
| `--xml` | Output as XML for LLM consumption |

**Output formats:**

Text (get):
```
my-feature
```

Text (set):
```
✓ Set topic on change 12345: my-feature
```

Text (delete):
```
✓ Removed topic from change 12345
```

XML:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<topic_result>
  <status>success</status>
  <action>get|set|deleted</action>
  <change_id><![CDATA[12345]]></change_id>
  <topic><![CDATA[my-feature]]></topic>
</topic_result>
```

**Use cases:**
- Group related changes under a common topic
- Filter changes by topic in Gerrit UI
- Organize work for releases or features

## Code Review

### comment

Post comments (overall or inline).

```bash
# Overall comment
ger comment <change-id> -m "LGTM"

# Inline comments via JSON
echo '[{"file":"src/index.ts","line":42,"message":"Consider null check"}]' | ger comment 12345

# From file
cat comments.json | ger comment 12345
```

| Option | Description |
|--------|-------------|
| `-m <message>` | Overall comment message |
| `--unresolved` | Mark inline comments as unresolved |

**JSON schema for inline comments:**
```json
[{
  "file": "path/to/file.ts",
  "line": 42,
  "message": "Comment text",
  "range": {
    "start_line": 40,
    "end_line": 45,
    "start_character": 0,
    "end_character": 80
  },
  "side": "REVISION",
  "unresolved": true
}]
```

### vote

Cast review votes.

```bash
ger vote <change-id> --code-review +1
ger vote <change-id> --code-review +2 --verified +1
ger vote <change-id> --label "Custom-Label" +1
```

| Option | Description |
|--------|-------------|
| `--code-review <score>` | Code-Review vote (-2 to +2) |
| `--verified <score>` | Verified vote (-1 to +1) |
| `--label <name> <score>` | Custom label vote |
| `-m <message>` | Optional message with vote |

### review

AI-powered code review (multi-stage).

```bash
ger review <change-id>
ger review <change-id> --tool claude  # Specific AI tool
ger review  # Auto-detect change from HEAD
```

| Option | Description |
|--------|-------------|
| `--tool <name>` | AI tool (claude, llm, opencode, gemini) |
| `--inline-only` | Only post inline comments |
| `--overall-only` | Only post overall review |

**Stages:**
1. **Inline**: Generate line-specific comments
2. **Overall**: Generate high-level assessment

### add-reviewer

Add reviewers or groups to a change.

```bash
ger add-reviewer <change-id> <user1> <user2>
ger add-reviewer <change-id> --group frontend-team
ger add-reviewer <change-id> user@example.com --cc
```

| Option | Description |
|--------|-------------|
| `--group <name>` | Add group as reviewer |
| `--cc` | Add as CC instead of reviewer |

### remove-reviewer

Remove reviewers from a change.

```bash
ger remove-reviewer user@example.com -c 12345
ger remove-reviewer user1@example.com user2@example.com -c 12345
ger remove-reviewer johndoe -c 12345 --notify none
```

Supports email addresses, usernames, or account IDs as reviewer identifiers.

| Option | Description |
|--------|-------------|
| `-c, --change <id>` | Change ID (required) |
| `--notify <level>` | Notification level (none, owner, owner_reviewers, all) |
| `--xml` | Output as XML |

## Git Operations

### checkout

Checkout a change locally.

```bash
ger checkout <change-id>
ger checkout <change-id> --patchset 3
ger checkout https://gerrit.example.com/c/project/+/12345
```

| Option | Description |
|--------|-------------|
| `--patchset <n>` | Specific patchset |
| `--branch <name>` | Custom branch name |

**Creates:** `review/12345` branch by default.

### push

Push changes for review.

```bash
ger push
ger push --reviewers alice bob
ger push --topic "feature-x"
ger push --wip
```

| Option | Description |
|--------|-------------|
| `--reviewers <users>` | Add reviewers |
| `--topic <name>` | Set topic |
| `--wip` | Push as work-in-progress |
| `--ready` | Mark ready for review |
| `--private` | Push as private |

**Auto-installs:** Gerrit commit-msg hook if missing.

### rebase

Rebase a change on target branch.

```bash
ger rebase [change-id]
ger rebase 12345
ger rebase If5a3ae8...  # Change-ID format
ger rebase              # Auto-detect from HEAD
ger rebase --base <ref> # Rebase onto specific ref
```

| Option | Description |
|--------|-------------|
| `--base <ref>` | Base revision to rebase onto |
| `--xml` | Output as XML for LLM consumption |

### submit

Submit a change for merge.

```bash
ger submit <change-id>
```

**Validates:** All submit requirements met.

## Group Management

### groups

List Gerrit groups.

```bash
ger groups
ger groups --pattern "team-*"
ger groups --owned
ger groups --project canvas-lms
ger groups --user john.doe
```

| Option | Description |
|--------|-------------|
| `--pattern <glob>` | Filter by name |
| `--owned` | Only groups you own |
| `--project <name>` | Groups with project access |
| `--user <name>` | Groups containing user |
| `--xml` | Output as XML |

### groups-show

Display group details.

```bash
ger groups-show <group-id>
ger groups-show frontend-team
```

**Output:** Name, description, owner, members, options.

### groups-members

List group members.

```bash
ger groups-members <group-id>
ger groups-members frontend-team --xml
```

## Utilities

### status

Check connection and authentication.

```bash
ger status
```

**Verifies:** API connectivity, credentials valid.

### setup / init

Configure credentials interactively.

```bash
ger setup
ger init  # Alias
```

**Creates:** `~/.ger/config.json` with secure permissions.

### install-hook

Install the Gerrit commit-msg hook for automatic Change-Id generation.

```bash
ger install-hook
ger install-hook --force  # Overwrite existing hook
```

| Option | Description |
|--------|-------------|
| `--force` | Overwrite existing hook |
| `--xml` | Output as XML |

**Downloads:** Hook from configured Gerrit server.
**Installs to:** `.git/hooks/commit-msg` (executable).

**Use cases:**
- Set up a new clone before first push
- Repair corrupted hook
- Update hook after Gerrit upgrade

### open

Open change in browser.

```bash
ger open <change-id>
ger open  # Auto-detect from HEAD
```

### extract-url

Extract URLs from change messages.

```bash
ger extract-url <change-id>
ger extract-url <change-id> --pattern "jenkins"
ger extract-url <change-id> --include-comments
```

| Option | Description |
|--------|-------------|
| `--pattern <regex>` | Filter URLs |
| `--include-comments` | Include comment URLs |
| `--json` | Output as JSON |

**Use case:** Get Jenkins build URL for `jk` integration.

### build-status

Check CI build status.

```bash
ger build-status <change-id>
ger build-status <change-id> --watch
ger build-status <change-id> --watch --interval 30 --timeout 1800
```

| Option | Description |
|--------|-------------|
| `--watch` | Poll until terminal state |
| `--interval <sec>` | Poll interval (default: 30) |
| `--timeout <sec>` | Max wait time |
| `--exit-status` | Exit 1 on failure |

**States:** `pending`, `running`, `success`, `failure`, `not_found`

**Exit codes:**
- 0: Completed (any state)
- 1: Failure (with `--exit-status`)
- 2: Timeout
- 3: API error

## Global Options

Available on most commands:

| Option | Description |
|--------|-------------|
| `--xml` | Output as XML for LLM consumption |
| `--help` | Show command help |
| `--version` | Show version |
