# ger CLI Usage Examples

Real-world examples and workflows using the ger CLI tool.

## Daily Review Workflow

### Morning Review Routine

Start your day by checking incoming review requests:

```bash
# Check what needs your review (reviewer:self OR cc:self)
ger team
# or equivalently:
ger incoming

# Show detailed info for each change
ger show 12345
ger diff 12345

# Post reviews
ger comment 12345 -m "LGTM! Nice refactoring."
ger vote 12345 --code-review 1
ger comment 12346 -m "Please add tests for the new method" --unresolved
```

### Checking Your Own Changes

Monitor the status of your submitted changes:

```bash
# List your open changes
ger mine
# or:
ger list

# Check build status for each
ger build-status 12350 --watch

# View any comments received
ger comments 12350

# Address feedback with new patchset
git add .
git commit --amend
ger push
```

### Work-in-Progress Changes

```bash
# Push as WIP (won't notify reviewers)
ger push --wip

# Continue working and updating
git add .
git commit --amend
ger push --wip

# When ready for review
ger push --ready
# or:
ger set-ready -m "Ready for review"

# Find WIP changes
ger search "owner:self is:wip"
```

## Reviewing Changes with Worktrees

Use worktrees to review a change in isolation without disturbing your current work:

```bash
# Create a worktree for the change
ger tree setup 12345

# Navigate into it
cd .ger/12345

# Review the code
ger show 12345
ger diff 12345

# Make suggested fixes and push
git add .
git commit --amend
ger push

# Rebase onto latest main if needed
ger tree rebase

# Or interactive rebase
ger tree rebase --interactive

# When done, go back and clean up
cd -
ger tree cleanup 12345
```

## Cherry-Picking Changes

Grab a specific change into your current branch:

```bash
# Cherry-pick latest patchset
ger cherry 12345

# Cherry-pick specific patchset
ger cherry 12345/3

# Stage only (review before committing)
ger cherry 12345 --no-commit
git diff --staged   # review changes
git commit

# Skip pre-commit hooks (use with care)
ger cherry 12345 --no-verify

# From a Gerrit URL
ger cherry https://gerrit.instructure.com/c/canvas-lms/+/12345
```

## CI/CD Workflows

### Wait for build, then get failures

```bash
# Full workflow: wait, then get failures
ger build-status --watch --interval 20 --timeout 1800 && \
  ger extract-url "build-summary-report" | tail -1 | jk failures --smart --xml

# Just check status and exit non-zero on failure
ger build-status --exit-status
```

### Retrigger CI

```bash
# Retrigger for the change in HEAD (auto-detected)
ger retrigger

# Retrigger a specific change
ger retrigger 12345
```

### Rebase a stale change

```bash
# Server-side rebase (Gerrit does the rebase)
ger rebase

# Rebase even with conflicts
ger rebase --allow-conflicts

# Rebase onto a specific base
ger rebase --base origin/main
```

## Analytics and Reporting

```bash
# Year-to-date analytics (default: Jan 1 to today)
ger analyze

# Specific date range
ger analyze --start-date 2025-01-01 --end-date 2025-06-30

# Filter by repo
ger analyze --repo canvas-lms

# Export to different formats
ger analyze --markdown --output report.md
ger analyze --csv --output report.csv
ger analyze --json > analytics.json

# Update local cache first
ger analyze
```

## Multi-File Review with Context

When reviewing large changes, examine each file individually:

```bash
# Get overview
ger show 12345 --xml

# List changed files first
ger files 12345

# Review file by file
ger diff 12345 --file src/api/client.ts
ger diff 12345 --file src/api/types.ts

# Post inline comments
ger comment 12345 --file src/api/client.ts --line 42 \
  -m "Consider adding error handling for network failures"
```

## Managing Teams / Reviewers

```bash
# Find groups for your project
ger groups --project canvas-lms

# View who's in a group before adding
ger groups-show canvas-frontend-reviewers
ger groups-members canvas-frontend-reviewers

# Add entire team as reviewers
ger add-reviewer --group canvas-frontend-reviewers -c 12345

# Add manager as CC
ger add-reviewer --cc manager@example.com -c 12345

# Remove reviewer
ger remove-reviewer user@example.com -c 12345

# Suppress notifications when adding
ger add-reviewer --notify none user@example.com -c 12345
```

## Batch Operations

### Check all changes in your review queue

```bash
#!/bin/bash
# Review incoming changes with filter
ger incoming --filter "project:canvas-lms" --xml | \
  # process with your tool of choice
  xq '.list_result.changes.change[]' -r '.change_number'
```

### Abandon stale changes

```bash
# Find your open changes as JSON
ger mine --json | jq -r '.[] | select(.updated < "2024-01-01") | .id' | \
  xargs -I{} ger abandon {} -m "Abandoning stale change"
```

## Output Format Examples

```bash
# JSON — good for scripting with jq
ger show 12345 --json | jq '.subject'
ger mine --json | jq '.[].change_number'

# XML — preferred for LLM/AI consumption
ger show 12345 --xml
ger incoming --xml
ger diff 12345 --xml

# Plain text — human-readable colored output
ger team
ger mine
ger show 12345
```

## Shell Aliases

Add to your shell config for quick access:

```bash
alias gm='ger mine'
alias gi='ger incoming'
alias gt='ger team'
alias gs='ger show'
alias gd='ger diff'
alias gc='ger comment'
alias gp='ger push'

# Quick CI wait
gbuild() {
  ger build-status --watch --interval 20 --timeout 1800 && \
    ger extract-url "build-summary-report" | tail -1
}
```
