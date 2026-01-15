# ger CLI Usage Examples

Real-world examples and workflows using the ger CLI tool.

## Daily Review Workflow

### Morning Review Routine

Start your day by checking incoming review requests:

```bash
# Check what needs your review
ger incoming

# Show detailed info for each change
ger show 12345
ger show 12346
ger show 12347

# Post reviews
ger comment 12345 -m "LGTM! Nice refactoring."
ger comment 12346 -m "Please add tests for the new method" --unresolved
ger comment 12347 -m "+1"
```

### Checking Your Own Changes

Monitor the status of your submitted changes:

```bash
# List your open changes
ger mine

# Check build status for each
ger build-status 12350 --watch

# View any comments received
ger comments 12350

# Address feedback with new patchset
# (make local changes, commit, push)
git add .
git commit --amend
git push origin HEAD:refs/for/main
```

## Advanced Review Workflows

### Multi-File Review with Context

When reviewing large changes, examine each file individually:

```bash
# Get overview
ger show 12345

# Review file by file
ger diff 12345 --file src/api/client.ts
ger diff 12345 --file src/api/types.ts
ger diff 12345 --file tests/api/client.test.ts

# Post inline comments
ger comment 12345 --file src/api/client.ts --line 42 \
  -m "Consider adding error handling for network failures"

ger comment 12345 --file src/api/types.ts --line 15 \
  -m "This type should extend BaseResponse" --unresolved
```

### Team Review Session

Coordinate reviews during team sync:

```bash
# List all open changes
ger open --limit 20

# Filter by team member
ger open --owner alice@example.com
ger open --owner bob@example.com

# Quick status check
for id in 12345 12346 12347; do
  echo "Change $id:"
  ger build-status $id
  ger comments $id --unresolved-only
  echo "---"
done
```

## AI-Assisted Code Review

### Using AI for Automated Review

Integrate with AI tools for comprehensive code analysis:

```bash
# Get the diff
ger diff 12345 > /tmp/change.diff

# Run AI analysis
cat /tmp/change.diff | ai-code-review --model gpt-4 > /tmp/review.txt

# Post AI-generated feedback
cat /tmp/review.txt | ger comment 12345

# Or do it all in one pipeline
ger diff 12345 | ai-code-review --model gpt-4 | ger comment 12345
```

### Custom AI Review Script

Create a wrapper script for consistent AI reviews:

```bash
#!/bin/bash
# ai-gerrit-review.sh

CHANGE_ID=$1

# Get change details
INFO=$(ger show $CHANGE_ID --format json)
DIFF=$(ger diff $CHANGE_ID)

# Create prompt for AI
PROMPT="Review this code change:

Change Info:
$INFO

Diff:
$DIFF

Please provide:
1. Overall assessment
2. Potential bugs or issues
3. Performance concerns
4. Security considerations
5. Suggestions for improvement
"

# Get AI review
REVIEW=$(echo "$PROMPT" | ai-tool analyze)

# Post review
echo "$REVIEW" | ger comment $CHANGE_ID

echo "AI review posted to change $CHANGE_ID"
```

Usage:
```bash
./ai-gerrit-review.sh 12345
```

## CI/CD Integration

### Jenkins Build Monitoring

Monitor Jenkins builds for Gerrit changes:

```bash
# Check build status
ger build-status 12345

# Wait for build to complete
ger build-status 12345 --watch --timeout 1800

# Extract build URL
ger extract-url "build-summary-report" 12345 | tail -1

# Complete workflow: wait for build, then extract URL
ger build-status 12345 --watch --interval 20 --timeout 1800 && \
  ger extract-url "build-summary-report" 12345 | tail -1
```

### Automated Build Status Notifications

Create a script to monitor builds and notify on completion:

```bash
#!/bin/bash
# watch-build.sh

CHANGE_ID=$1
SLACK_WEBHOOK=$2

echo "Monitoring build for change $CHANGE_ID..."

# Wait for build
if ger build-status $CHANGE_ID --watch --timeout 3600; then
  STATUS="SUCCESS"
  MESSAGE="Build passed for change $CHANGE_ID"
else
  STATUS="FAILURE"
  BUILD_URL=$(ger extract-url "build-summary-report" $CHANGE_ID | tail -1)
  MESSAGE="Build failed for change $CHANGE_ID. See: $BUILD_URL"
fi

# Send notification
curl -X POST -H 'Content-type: application/json' \
  --data "{\"text\":\"$MESSAGE\"}" \
  $SLACK_WEBHOOK

echo "$STATUS"
```

## Batch Operations

### Review Multiple Changes

Process multiple changes efficiently:

```bash
#!/bin/bash
# batch-review.sh

CHANGES=(12345 12346 12347 12348)

for CHANGE in "${CHANGES[@]}"; do
  echo "Reviewing change $CHANGE..."

  # Show change
  ger show $CHANGE

  # Wait for user input
  read -p "Review comment (or 'skip'): " COMMENT

  if [ "$COMMENT" != "skip" ]; then
    ger comment $CHANGE -m "$COMMENT"
    echo "Comment posted to $CHANGE"
  fi

  echo "---"
done

echo "Batch review complete"
```

### Abandon Stale Changes

Clean up old changes:

```bash
#!/bin/bash
# abandon-stale.sh

# Get your changes (assuming ger mine outputs change IDs)
CHANGES=$(ger mine --format json | jq -r '.[] | select(.updated < "2024-01-01") | .id')

for CHANGE in $CHANGES; do
  echo "Change $CHANGE is stale"
  read -p "Abandon? (y/n): " CONFIRM

  if [ "$CONFIRM" = "y" ]; then
    ger abandon $CHANGE --message "Abandoning stale change"
    echo "Abandoned $CHANGE"
  fi
done
```

## Troubleshooting Scenarios

### Debugging Failed Builds

When a build fails, investigate systematically:

```bash
# Get build status
ger build-status 12345

# Get build summary URL
BUILD_URL=$(ger extract-url "build-summary-report" 12345 | tail -1)

# Post build URL as comment
ger comment 12345 -m "Build failed. See: $BUILD_URL"
```

### Resolving Merge Conflicts

When a change has merge conflicts:

```bash
# Checkout the change
ger checkout 12345

# Rebase onto latest main
git fetch origin
git rebase origin/main

# Resolve conflicts
# (edit files, git add, git rebase --continue)

# Push updated patchset
git push origin HEAD:refs/for/main

# Notify reviewers
ger comment 12345 -m "Rebased onto latest main and resolved merge conflicts. Ready for re-review."
```

### Recovery from Accidental Abandon

If you accidentally abandoned a change:

```bash
# Note: ger doesn't have restore command yet, use Gerrit UI or API directly
# This is a placeholder for future functionality

# For now, use git to create new change from same commits
ger checkout 12345
git push origin HEAD:refs/for/main

# Add comment explaining
ger comment <new-change-id> -m "Re-uploaded change that was accidentally abandoned (was #12345)"
```

## Performance Optimization

### Caching Strategies

Optimize performance with smart caching:

```bash
# Pre-cache frequently accessed changes
for id in 12345 12346 12347; do
  ger show $id > /dev/null 2>&1 &
done
wait

# Now access them quickly (from cache)
ger show 12345
ger show 12346
ger show 12347

# Force fresh data when needed
ger show 12345 --no-cache
```

### Parallel Operations

Speed up batch operations with parallelization:

```bash
# Sequential (slow)
for id in 12345 12346 12347 12348 12349; do
  ger show $id
done

# Parallel (fast)
for id in 12345 12346 12347 12348 12349; do
  ger show $id &
done
wait
```

## Scripting Best Practices

### Error Handling

Always handle errors in scripts:

```bash
#!/bin/bash
set -e  # Exit on error

CHANGE_ID=$1

if [ -z "$CHANGE_ID" ]; then
  echo "Error: Change ID required"
  echo "Usage: $0 <change-id>"
  exit 1
fi

# Check if change exists
if ! ger show $CHANGE_ID > /dev/null 2>&1; then
  echo "Error: Change $CHANGE_ID not found"
  exit 1
fi

# Proceed with operation
ger diff $CHANGE_ID
```

### JSON Processing

Use jq for parsing JSON output:

```bash
# Extract specific fields
ger show 12345 --format json | jq '.subject'
ger show 12345 --format json | jq '.owner.email'

# Filter comments
ger comments 12345 --format json | jq '.[] | select(.unresolved == true)'

# Get list of changed files
ger show 12345 --format json | jq -r '.files[].path'
```

### Integration Functions

Create reusable functions:

```bash
# Add to ~/.bashrc or ~/.zshrc

# Quick review function
grev() {
  local change_id=$1
  ger show $change_id
  echo ""
  read -p "Comment: " comment
  [ -n "$comment" ] && ger comment $change_id -m "$comment"
}

# Check build and extract URL
gbuild() {
  local change_id=$1
  ger build-status $change_id --watch && \
    ger extract-url "build-summary-report" $change_id | tail -1
}

# AI review shortcut
gaireview() {
  local change_id=$1
  ger diff $change_id | ai-review-tool | ger comment $change_id
}
```

Usage:
```bash
grev 12345          # Quick review
gbuild 12345        # Monitor build
gaireview 12345     # AI review
```

## Tips and Tricks

### Quick Change Navigation

```bash
# Checkout latest incoming change
ger incoming --format json | jq -r '.[0].id' | xargs ger checkout

# Review oldest unreviewed change
ger incoming --format json | jq -r '.[-1].id' | xargs ger show
```

### Custom Aliases

Add to your shell config:

```bash
alias gm='ger mine'
alias gi='ger incoming'
alias go='ger open'
alias gs='ger show'
alias gd='ger diff'
alias gc='ger comment'
```

### Output Formatting

```bash
# Compact view
ger mine --format list | head -5

# Detailed table
ger open --format table

# Machine-readable
ger mine --format json | jq '.'
```
