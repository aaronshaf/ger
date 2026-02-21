# ger

Gerrit CLI built with Bun.

## Features

- **LLM-Friendly**: XML output for AI/automation pipelines
- **Interactive UI**: Terminal UI for change selection and navigation
- **Effect-based**: Robust error handling and functional architecture

## Installation

```bash
# Install Bun runtime
curl -fsSL https://bun.sh/install | bash

# Install ger
bun install -g @aaronshaf/ger
```

## Upgrading

To upgrade ger to the latest version:

```bash
bun update -g @aaronshaf/ger
```

## Getting Started

```bash
ger setup
```

This will prompt for your Gerrit credentials:
- Gerrit host URL
- Username
- HTTP password (from Gerrit settings)

## Common Commands

### Daily Workflow

```bash
# Check your connection status
ger status

# View your changes
ger mine

# View incoming reviews
ger incoming

# View a specific change
ger show 12345

# Checkout a change for local testing
ger checkout 12345

# Add a comment
ger comment 12345 -m "LGTM"

# Vote on a change
ger vote 12345 --code-review 2 -m "LGTM"

# Add reviewers to a change
ger add-reviewer user@example.com -c 12345

# Get diff for review
ger diff 12345

# Push your changes for review
ger push
ger push -r alice@example.com -t my-feature --wip

# Search for changes using Gerrit query syntax
ger search "owner:self status:open"
ger search "project:my-project" -n 10

# Extract URLs from messages (e.g., Jenkins build links)
ger extract-url "build-summary-report" | tail -1

# Check CI build status (parses build messages)
ger build-status 12345  # Returns: pending, running, success, failure, or not_found
ger build-status        # Auto-detects from HEAD commit

# Watch build status until completion (like gh run watch)
ger build-status 12345 --watch
ger build-status --watch --exit-status && deploy.sh

# Rebase, submit, restore changes
ger rebase 12345
ger submit 12345
ger restore 12345

# AI-powered code review (requires claude, llm, or opencode CLI)
ger review 12345
ger review 12345 --dry-run  # Preview without posting
```

## Commands

### Connection Status
```bash
ger status
ger status --pretty
```

### Show Change Details
```bash
# Complete change info with metadata, diff, inline comments, and review activity
ger show 12345
ger show 12345 --pretty
```

### List Changes
```bash
# Your changes
ger mine
ger mine --pretty

# Incoming reviews
ger incoming
ger incoming --pretty

# Workspace changes (local branch tracking)
ger workspace
ger workspace --pretty
```

### Search Changes

Search for changes across your Gerrit instance using native query syntax:

```bash
# Search for all open changes (default)
ger search

# Search for your open changes
ger search "owner:self status:open"

# Search for changes by a specific user
ger search "owner:john@example.com"

# Search by project
ger search "project:my-project status:open"

# Search with date filters
ger search "owner:self after:2025-01-01"
ger search "status:merged age:7d"

# Combine filters
ger search "owner:self status:merged before:2025-06-01"

# Limit results (default: 25)
ger search "project:my-project" -n 10

# XML output for automation
ger search "owner:self" --xml
```

#### Common query operators:
| Operator | Description |
|----------|-------------|
| `owner:USER` | Changes owned by USER (use 'self' for yourself) |
| `status:STATE` | open, merged, abandoned, closed |
| `project:NAME` | Changes in a specific project |
| `branch:NAME` | Changes targeting a branch |
| `age:TIME` | Time since last update (e.g., 1d, 2w, 1mon) |
| `before:DATE` | Changes modified before date (YYYY-MM-DD) |
| `after:DATE` | Changes modified after date (YYYY-MM-DD) |
| `is:wip` | Work-in-progress changes |
| `is:submittable` | Changes ready to submit |
| `reviewer:USER` | Changes where USER is a reviewer |
| `label:NAME=VALUE` | Filter by label (e.g., label:Code-Review+2) |

See the [full query syntax documentation](https://gerrit-review.googlesource.com/Documentation/user-search.html).

### Comments

#### Overall Comments
```bash
# Using -m flag
ger comment 12345 -m "LGTM"

# Piping plain text (becomes overall comment message)
echo "Review text" | ger comment 12345
cat review.txt | ger comment 12345
```

#### Line-Specific Comments
```bash
# Single line comment (line numbers refer to post-merge view)
ger comment 12345 --file src/main.ts --line 42 -m "Consider error handling"

# Mark as unresolved
ger comment 12345 --file src/main.ts --line 42 -m "Fix this" --unresolved
```

#### Batch Line Comments (JSON Array)

The batch comment feature accepts a JSON array of comment objects. Each comment can target specific lines, ranges, or sides of the diff.

##### Basic Structure
```javascript
[
  {
    "file": "path/to/file.js",       // Required: File path
    "line": 42,                       // Optional: Line number (omit when using range)
    "message": "Your comment",        // Required: Comment text
    "side": "REVISION",               // Optional: "PARENT" or "REVISION" (default: REVISION)
    "range": {                        // Optional: Comment on multiple lines or characters
      "start_line": 10,
      "end_line": 20,
      "start_character": 0,           // Optional: Character position (0-indexed)
      "end_character": 80
    },
    "unresolved": true                // Optional: Mark as unresolved (default: false)
  }
]
```

##### Examples

```bash
# Basic batch comments
echo '[
  {"file": "src/main.ts", "line": 10, "message": "Add type annotation"},
  {"file": "src/utils.ts", "line": 25, "message": "Extract to constant"},
  {"file": "src/api.ts", "line": 100, "message": "Handle error", "unresolved": true}
]' | ger comment 12345 --batch

# Comment on different sides of the diff
# PARENT: The original code before changes
# REVISION: The new code after changes
echo '[
  {"file": "src/Calculator.java", "line": 5, "side": "PARENT", "message": "Why was this removed?"},
  {"file": "src/Calculator.java", "line": 5, "side": "REVISION", "message": "Good improvement"}
]' | ger comment 12345 --batch

# Range comments for blocks of code
echo '[
  {
    "file": "src/Service.java",
    "range": {"start_line": 50, "end_line": 55},
    "message": "This entire method needs refactoring"
  },
  {
    "file": "src/Service.java",
    "range": {"start_line": 10, "start_character": 8, "end_line": 10, "end_character": 25},
    "message": "This variable name is confusing"
  }
]' | ger comment 12345 --batch

# Combined features: range + side + unresolved
echo '[
  {
    "file": "src/UserService.java",
    "range": {"start_line": 20, "end_line": 35},
    "side": "PARENT",
    "message": "Why was this error handling removed?",
    "unresolved": true
  },
  {
    "file": "src/UserService.java",
    "range": {"start_line": 20, "end_line": 35},
    "side": "REVISION",
    "message": "New error handling looks good, but consider extracting to a method"
  }
]' | ger comment 12345 --batch

# Load comments from a file
cat comments.json | ger comment 12345 --batch
```

#### View Comments
```bash
# View all comments with diff context
ger comments 12345
ger comments 12345 --pretty
```

### Extract URLs

Extract URLs from change messages and comments for automation and scripting:

```bash
# Extract URLs from current HEAD commit's change (auto-detect)
ger extract-url "build-summary-report"

# Get the latest build URL (using tail)
ger extract-url "build-summary-report" | tail -1

# Get the first/oldest build URL (using head)
ger extract-url "jenkins" | head -1

# For a specific change (using change number)
ger extract-url "build-summary" 12345

# For a specific change (using Change-ID)
ger extract-url "build-summary" If5a3ae8cb5a107e187447802358417f311d0c4b1

# Chain with other tools for specific change
ger extract-url "build-summary-report" 12345 | tail -1 | jk failures --smart --xml

# Use regex for precise matching
ger extract-url "job/MyProject/job/main/\d+/" --regex

# Search both messages and inline comments
ger extract-url "github.com" --include-comments

# JSON output for scripting
ger extract-url "jenkins" --json | jq -r '.urls[-1]'

# XML output
ger extract-url "jenkins" --xml
```

#### How it works:
- **Change detection**: Auto-detects Change-ID from HEAD commit if not specified, or accepts explicit change number/Change-ID
- **Pattern matching**: Substring match by default, regex with `--regex`
- **Sources**: Searches messages by default, add `--include-comments` to include inline comments
- **Ordering**: URLs are output in chronological order (oldest first)
- **Composable**: Pipe to `tail -1` for latest, `head -1` for oldest

#### Common use cases:
```bash
# Get latest Jenkins build URL for a change
ger extract-url "jenkins.inst-ci.net" | tail -1

# Find all GitHub PR references
ger extract-url "github.com" --include-comments

# Extract specific build job URLs with regex
ger extract-url "job/[^/]+/job/[^/]+/\d+/$" --regex
```

### Build Status

Check the CI build status of a change by parsing Gerrit messages for build events and verification results:

#### Single Check (Snapshot)
```bash
# Check build status for a specific change
ger build-status 12345
# Output: {"state":"success"}

# Auto-detect change from HEAD commit
ger build-status

# Use in scripts with jq
ger build-status | jq -r '.state'
```

#### Watch Mode (Poll Until Completion)
Like `gh run watch`, you can poll the build status until it reaches a terminal state:

```bash
# Watch until completion (outputs JSON on each poll)
ger build-status 12345 --watch
# Output:
# {"state":"pending"}
# {"state":"running"}
# {"state":"running"}
# {"state":"success"}

# Auto-detect from HEAD commit
ger build-status --watch

# Custom polling interval (check every 5 seconds, default: 10)
ger build-status --watch --interval 5

# Custom timeout (60 minutes, default: 30 minutes)
ger build-status --watch --timeout 3600

# Exit with code 1 on build failure (for CI/CD pipelines)
ger build-status --watch --exit-status && deploy.sh

# Trigger notification when done (like gh run watch pattern)
ger build-status --watch && notify-send 'Build is done!'

# Extract final state in scripts
ger build-status --watch | tail -1 | jq -r '.state'
```

#### Output format (JSON):
```json
{"state": "success"}
```

#### Build states:
- **`pending`**: No "Build Started" message found yet
- **`running`**: "Build Started" found, but no verification result yet
- **`success`**: Verified +1 after most recent "Build Started"
- **`failure`**: Verified -1 after most recent "Build Started"
- **`not_found`**: Change does not exist

#### Exit codes:
- **`0`**: Default for all states (like `gh run watch`)
- **`1`**: Only when `--exit-status` flag is used AND build fails
- **`2`**: Timeout reached in watch mode
- **`3`**: API/network errors

#### How it works:
1. Fetches all messages for the change
2. Finds the most recent "Build Started" message
3. Checks for "Verified +1" or "Verified -1" messages after the build started
4. Returns the appropriate state
5. In watch mode: polls every N seconds until terminal state or timeout

#### Use cases:
- **CI/CD integration**: Wait for builds before proceeding with deployment
- **Automation**: Trigger actions based on build results
- **Scripting**: Check build status in shell scripts
- **Monitoring**: Poll build status for long-running builds with watch mode

### Diff
```bash
# Full diff
ger diff 12345
ger diff 12345 --pretty

# List changed files
ger diff 12345 --files-only

# Specific file
ger diff 12345 --file src/main.ts
```

### Change Management

#### Install Commit-Msg Hook
```bash
# Install the Gerrit commit-msg hook
ger install-hook

# Force reinstall (overwrite existing)
ger install-hook --force
```

**What it does:**
- Downloads the commit-msg hook from your configured Gerrit server
- Installs to `.git/hooks/commit-msg` with executable permissions
- Required for commits to have Change-Id footers

**Note:** The `push` command auto-installs the hook if missing, but you can use this command to manually install or update it.

#### Checkout Changes
```bash
# Checkout latest patchset
ger checkout 12345

# Checkout specific patchset
ger checkout 12345/3

# Checkout by Change-ID
ger checkout If5a3ae8cb5a107e187447802358417f311d0c4b1

# Checkout from URL
ger checkout https://gerrit.example.com/c/my-project/+/392385

# Detached HEAD mode (for quick review)
ger checkout 12345 --detach

# Use specific remote
ger checkout 12345 --remote upstream
```

**How it works:**
- Creates/updates branch named `review/<change-number>`
- Sets upstream tracking to target branch
- Updates existing review branch if it exists
- Auto-detects Gerrit remote matching your configured host

#### Push Changes to Gerrit
```bash
# Basic push to auto-detected target branch
ger push

# Push to specific branch
ger push -b master
ger push --branch feature/foo

# With topic
ger push -t my-feature

# With reviewers (can be repeated)
ger push -r alice@example.com -r bob@example.com

# With CC
ger push --cc manager@example.com

# Work in progress
ger push --wip

# Mark ready for review
ger push --ready

# Add hashtag
ger push --hashtag bugfix

# Combine options
ger push -b master -t refactor-auth -r alice@example.com --wip

# Dry run (show what would be pushed)
ger push --dry-run
```

**Features:**
- Auto-installs commit-msg hook if missing
- Auto-detects target branch from tracking branch or defaults to main/master
- Supports all standard Gerrit push options
- Validates reviewer email addresses
- Returns change URL on successful push

#### Vote on Changes
```bash
# Cast Code-Review vote
ger vote 12345 --code-review 2

# Cast Verified vote
ger vote 12345 --verified 1

# Combine votes with message
ger vote 12345 --code-review 2 --verified 1 -m "LGTM"

# Custom labels
ger vote 12345 --label "API-Review" 1

# XML output for automation
ger vote 12345 --code-review 1 --xml
```

**Common votes:**
- Code-Review: -2, -1, 0, +1, +2
- Verified: -1, 0, +1
- Custom labels vary by project configuration

#### Rebase Changes
```bash
# Rebase onto target branch HEAD
ger rebase 12345

# Rebase onto specific base
ger rebase 12345 --base refs/heads/main

# XML output
ger rebase 12345 --xml
```

#### Submit Changes
```bash
# Submit change for merging
ger submit 12345

# XML output
ger submit 12345 --xml
```

**Pre-submission checks:**
- Verifies change status is NEW
- Checks for required approvals (Code-Review+2, Verified+1)
- Ensures change is not work-in-progress
- Validates all submit requirements are met

#### Restore Abandoned Changes
```bash
# Restore an abandoned change
ger restore 12345

# Restore with message
ger restore 12345 -m "Reopening after discussion"

# XML output
ger restore 12345 --xml
```

#### Abandon Changes
```bash
# Abandon interactively (prompts for selection)
ger abandon

# Abandon specific change
ger abandon 12345

# Abandon with reason
ger abandon 12345 -m "Duplicate of #12346"
```

#### Open in Browser
```bash
# Open change in browser
ger open 12345
```

### Projects

List and filter Gerrit projects:

```bash
# List all projects
ger projects

# Filter by pattern (regex)
ger projects --pattern "^canvas-.*"

# XML output for automation
ger projects --xml
```

**Output:**
- Plain text: One project name per line (default)
- XML: Structured output with project details (id, name, parent, state)

### Add Reviewers

Add reviewers, groups, or CCs to a change:

```bash
# Add a single reviewer
ger add-reviewer user@example.com -c 12345

# Add multiple reviewers
ger add-reviewer user1@example.com user2@example.com -c 12345

# Add a group as reviewer
ger add-reviewer --group project-reviewers -c 12345

# Add a group as CC
ger add-reviewer --group administrators --cc -c 12345

# Add as CC instead of reviewer
ger add-reviewer --cc user@example.com -c 12345

# Suppress email notifications
ger add-reviewer --notify none user@example.com -c 12345

# XML output for automation
ger add-reviewer user@example.com -c 12345 --xml
```

#### Options:
- `-c, --change <id>` - Change ID (required)
- `--group` - Add as group instead of individual reviewer
- `--cc` - Add as CC instead of reviewer
- `--notify <level>` - Notification level: `none`, `owner`, `owner_reviewers`, `all` (default: `all`)
- `--xml` - XML output for LLM/automation consumption

#### Notes:
- Both email addresses and usernames are accepted for individual reviewers
- Group names/IDs can be used with the `--group` flag
- Multiple reviewers or groups can be added in a single command
- Use `--cc` for carbon copy (notified but not required to review)

### Groups

List, view, and query Gerrit groups:

```bash
# List all groups
ger groups

# Filter by pattern (regex)
ger groups --pattern "^project-.*"

# Show only groups you own
ger groups --owned

# Show groups for a specific project
ger groups --project my-project

# Limit results
ger groups --limit 50

# Show detailed group information
ger groups-show administrators

# Show group by numeric ID or UUID
ger groups-show 1
ger groups-show uuid-123456

# List all members of a group
ger groups-members project-reviewers

# XML output for automation
ger groups --xml
ger groups-show administrators --xml
ger groups-members project-reviewers --xml
```

#### Commands:
- `ger groups` - List and search groups
  - `--pattern <regex>` - Filter groups by name pattern
  - `--owned` - Show only groups you own
  - `--project <name>` - Show groups for a specific project
  - `--user <account>` - Show groups a user belongs to
  - `--limit <n>` - Limit results (default: 25)
  - `--xml` - XML output

- `ger groups-show <group-id>` - Show detailed group information
  - Accepts group name, numeric ID, or UUID
  - Shows members, subgroups, owner, and metadata
  - `--xml` - XML output

- `ger groups-members <group-id>` - List all members of a group
  - Shows member names, emails, usernames, and account IDs
  - `--xml` - XML output

#### Notes:
- All group commands provide read-only access
- Group IDs can be names, numeric IDs, or UUIDs
- Use groups with `ger add-reviewer --group` to add entire teams as reviewers

### AI-Powered Review

The `ger review` command provides automated code review using AI tools (claude, llm, or opencode CLI).

```bash
# Full AI review with inline and overall comments
ger review 12345

# Preview what would be posted without actually posting
ger review 12345 --dry-run

# Show debug output including AI responses
ger review 12345 --debug
```

The review command performs a two-stage review process:
1. **Inline comments**: Specific code issues with line-by-line feedback
2. **Overall review**: High-level assessment and recommendations

Requirements:
- One of these AI tools must be installed: `claude`, `llm`, or `opencode`
- Gerrit credentials must be configured (`ger setup`)

## Claude Code Skill

This repository includes a Claude Code Agent Skill that teaches Claude how to work effectively with Gerrit using the ger CLI. The skill provides Claude with expertise in Gerrit workflows, command usage, and best practices.

### Installation

Install the skill globally using Claude Code's plugin system:

```bash
# Add ger as a plugin marketplace
/plugin marketplace add aaronshaf/ger

# Install the gerrit-workflow skill
/plugin install gerrit-workflow@ger
```

The skill will be available across all your projects, ready to assist with Gerrit operations whenever you need it.

### What's Included

The skill provides Claude with knowledge about:
- Common Gerrit workflows (reviewing changes, posting comments)
- All ger CLI commands and their options
- Integration with Jenkins builds and AI tools
- Best practices for code review
- Real-world usage examples and scripting patterns

### Using the Skill

Once installed, simply ask Claude to help with Gerrit tasks:

```
"Review the incoming changes"
"Show me the diff for change 12345"
"Post a comment on this change"
"Help me set up an AI review workflow"
```

Claude will automatically use the skill and guide you through Gerrit operations using ger commands.

### Skill Contents

```
skills/gerrit-workflow/
├── SKILL.md         # Main skill instructions
├── reference.md     # Complete command reference
└── examples.md      # Real-world usage examples
```

## LLM Integration

```bash
# Review with AI
ger diff 12345 | llm "Review this code"

# AI-generated comment
llm "Review change 12345" | ger comment 12345

# Complete change analysis
ger show 12345 | llm "Summarize this change and its review status"

# Automated approvals
echo "LGTM" | ger comment 12345
```

## Output Formats

### XML (Default)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<comment_result>
  <status>success</status>
  <change_id>12345</change_id>
  <message><![CDATA[LGTM]]></message>
</comment_result>
```

### Pretty (--pretty flag)
```
Comment posted successfully
Change: Fix authentication bug (NEW)
Message: LGTM
```

## Upgrading

To upgrade gi to the latest version:

```bash
bun update -g @aaronshaf/ger
```

After upgrading, you may want to review new configuration options:

```bash
ger setup  # Review and update your configuration
```

## Development

For local development:

```bash
git clone https://github.com/aaronshaf/ger
cd ger
bun install

# Run locally
bun run dev

# Run tests
bun test
bun run test:coverage

# Type checking
bun run typecheck

# Linting
bun run lint
```

### Stack
- **Bun** - Runtime and package manager
- **Effect** - Type-safe error handling and functional architecture
- **TypeScript** - With isolatedDeclarations
- **Ink** - Terminal UI components
- **Commander** - CLI argument parsing

## License

MIT
