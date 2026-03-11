---
name: gerrit-workflow
description: Work with Gerrit code reviews using the ger CLI tool. Use when reviewing changes, posting comments, managing patches, or interacting with Gerrit. Covers common workflows like fetching changes, viewing diffs, adding comments, voting, managing change status, cherry-picking, and tree worktrees.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Gerrit Workflow with ger CLI

This skill helps you work effectively with Gerrit code reviews using the `ger` CLI tool.

## Prerequisites

The `ger` CLI tool must be installed and accessible in your PATH. It's available globally if installed from `~/github/ger`.

## Output Formats

Most commands support `--json` and `--xml` flags:
- `--json` — Structured JSON for programmatic consumption
- `--xml` — XML with CDATA-wrapped content, optimized for LLM/AI consumption
- (default) — Plain text / colored terminal output for humans

These are mutually exclusive; using both is an error.

## Core Commands

### Viewing Changes

**Show comprehensive change information:**
```bash
ger show [change-id]
```
Displays metadata, diff, and all comments. Auto-detects from HEAD commit if omitted.

**View specific diff:**
```bash
ger diff [change-id]
ger diff [change-id] --file src/api/client.ts   # specific file
```

**View all comments:**
```bash
ger comments [change-id]
ger comments [change-id] --unresolved-only
```

**List changed files:**
```bash
ger files [change-id]
ger files [change-id] --json
```

**List reviewers:**
```bash
ger reviewers [change-id]
ger reviewers [change-id] --xml
```

### Listing Changes

**Your open changes:**
```bash
ger mine
ger list
```

**Changes needing your review (reviewer OR cc'd):**
```bash
ger incoming
ger team
```
Both query `reviewer:self OR cc:self status:open`. Options:
- `--all-verified` — Include all verification states (default: open only)
- `-f, --filter <query>` — Append custom Gerrit query syntax
- `--status <status>` — Filter by status: open, merged, abandoned
- `-n, --limit <n>` — Limit number of results (default: 25)
- `--detailed` — Show detailed info for each change
- `--json` / `--xml`

**General list with options:**
```bash
ger list --status merged
ger list --reviewer          # same as incoming
ger list -n 10 --json
```

**Search with custom query:**
```bash
ger search "owner:self is:wip"
ger search "project:my-project status:open" -n 10 --xml
```

### Posting Comments and Votes

**Post a comment:**
```bash
ger comment [change-id] -m "Your comment"
echo "Review feedback" | ger comment [change-id]   # from stdin
ger comment [change-id] --file src/api/client.ts --line 42 -m "Inline comment"
```

**Vote on a change:**
```bash
ger vote [change-id] Code-Review +2
ger vote [change-id] Verified -1
```

### Managing Changes

**Abandon / restore:**
```bash
ger abandon [change-id] -m "No longer needed"
ger restore [change-id]
```

**Submit a change:**
```bash
ger submit [change-id]
```

**Set WIP / Ready:**
```bash
ger set-wip [change-id]
ger set-wip [change-id] -m "Still working on tests"
ger set-ready [change-id]
ger set-ready [change-id] -m "Ready for review"
```

**Topic:**
```bash
ger topic [change-id]            # get current topic
ger topic [change-id] my-topic   # set topic
ger topic [change-id] --delete   # delete topic
```

### Pushing Changes

**Push changes to Gerrit:**
```bash
ger push
ger push -b main -t my-feature -r alice@example.com --wip
```
Options: `-b`, `-t`, `-r`, `--cc`, `--wip`, `--ready`, `--hashtag`, `--private`, `--dry-run`

### Checkout and Cherry-Pick

**Checkout a change locally:**
```bash
ger checkout 12345
ger checkout 12345 --revision 3   # specific patchset
```

**Cherry-pick a change into current branch:**
```bash
ger cherry 12345
ger cherry 12345/3                # specific patchset
ger cherry 12345 --no-commit      # stage without committing
ger cherry 12345 --no-verify      # skip pre-commit hooks
ger cherry https://gerrit.example.com/c/my-project/+/12345
```

### Rebase

**Rebase a change on Gerrit (server-side):**
```bash
ger rebase [change-id]
ger rebase [change-id] --base <sha-or-change>
ger rebase [change-id] --allow-conflicts   # rebase even with conflicts
ger rebase [change-id] --json
```
Auto-detects from HEAD commit if no change-id provided.

### Retrigger CI

**Post a CI retrigger comment:**
```bash
ger retrigger [change-id]
```
Auto-detects from HEAD. Saves the retrigger comment to config on first use (or configure via `ger setup`).

### Build Status

**Check Jenkins build status:**
```bash
ger build-status [change-id]
ger build-status --watch --interval 20 --timeout 1800
ger build-status --exit-status   # non-zero exit on failure (for scripting)
```

**Extract build URLs:**
```bash
ger extract-url "build-summary-report"
ger extract-url "build-summary-report" | tail -1
```

**Canonical CI workflow:**
```bash
ger build-status --watch --interval 20 --timeout 1800 && \
  ger extract-url "build-summary-report" | tail -1 | jk failures --smart --xml
```

### Analytics

**View merged change analytics (year-to-date by default):**
```bash
ger analyze
ger analyze --start-date 2025-01-01 --end-date 2025-12-31
ger analyze --repo canvas-lms
ger analyze --json
ger analyze --xml
ger analyze --markdown
ger analyze --csv
ger analyze --output report.md   # write to file
```
Default start date: January 1 of current year.

**Update local cache of merged changes:**
```bash
ger update
ger update --since 2025-01-01
```

**View recent failures summary:**
```bash
ger failures
ger failures --xml
```

### Worktree (tree) Commands

Manage git worktrees for reviewing changes in isolation.

**Setup a worktree for a change:**
```bash
ger tree setup 12345
ger tree setup 12345:3     # specific patchset
ger tree setup 12345 --xml
```
Creates worktree at `<repo-root>/.ger/<change-number>/`.

**List ger-managed worktrees:**
```bash
ger trees
ger trees --json
```

**Rebase a worktree (run from inside the worktree):**
```bash
cd .ger/12345
ger tree rebase
ger tree rebase --onto origin/main
ger tree rebase --interactive   # interactive rebase (-i)
```

**Remove a worktree:**
```bash
ger tree cleanup 12345
```

### Groups and Reviewers

**Add reviewers:**
```bash
ger add-reviewer user@example.com -c 12345
ger add-reviewer --group project-reviewers -c 12345
ger add-reviewer --cc user@example.com -c 12345
ger add-reviewer --notify none user@example.com -c 12345
```

**Remove reviewers:**
```bash
ger remove-reviewer user@example.com -c 12345
```

**List groups:**
```bash
ger groups
ger groups --pattern "^team-.*"
ger groups --project canvas-lms
ger groups --owned
```

**Show group details / members:**
```bash
ger groups-show administrators
ger groups-members project-reviewers
```

### Configuration and Setup

```bash
ger setup          # interactive first-time setup
ger config list    # list all config
ger config get gerrit.url
ger config set gerrit.url https://gerrit.example.com
```

## Auto-Detection

These commands auto-detect the change from the HEAD commit's `Change-Id` footer when no change-id is provided:
`show`, `build-status`, `topic`, `rebase`, `extract-url`, `diff`, `comments`, `vote`, `retrigger`, `files`, `reviewers`

## Common LLM Workflows

```bash
# Review a change
ger show <id> --xml
ger diff <id> --xml
ger comments <id> --xml

# Post a review
ger comment <id> -m "..."
ger vote <id> Code-Review +1

# Manage changes
ger push
ger checkout <id>
ger abandon <id>
ger submit <id>

# WIP toggle
ger set-wip <id>
ger set-ready <id> -m "message"

# Check CI
ger build-status <id> --exit-status
```

## Notes

- Commands run from within a Gerrit repository
- Most commands accept an optional change-id; if omitted, they use the current branch's HEAD `Change-Id`
- The tool uses local SQLite caching for offline-first functionality
- `--xml` is preferred over `--json` for LLM/AI consumption (easier to parse)
- Numeric change numbers (12345) and full Change-IDs (I1234abc...) are both accepted
