---
name: gerrit-workflow
description: Work with Gerrit code reviews using the ger CLI tool. Use when reviewing changes, posting comments, managing patches, or interacting with Gerrit. Covers common workflows like fetching changes, viewing diffs, adding comments, and managing change status.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Gerrit Workflow with ger CLI

This skill helps you work effectively with Gerrit code reviews using the `ger` CLI tool.

## Prerequisites

The `ger` CLI tool must be installed and accessible in your PATH. It's available globally if installed from `~/github/ger`.

## Core Commands

### Viewing Changes

**Show comprehensive change information:**
```bash
ger show [change-id]
```
Displays metadata, diff, and all comments for a change. If no change-id is provided, uses the current branch.

**View specific diff:**
```bash
ger diff [change-id]
```
Get diffs with various formatting options.

**View all comments:**
```bash
ger comments [change-id]
```
View all comments on a change with context.

### Managing Changes

**View your changes:**
```bash
ger mine
```
List all changes owned by you.

**View incoming changes (review requests):**
```bash
ger incoming
```
List changes that need your review.

**View open changes:**
```bash
ger open
```
List all open changes in the project.

**Abandon a change:**
```bash
ger abandon [change-id]
```
Mark a change as abandoned.

### Commenting on Changes

**Post a comment:**
```bash
ger comment [change-id] -m "Your comment"
```

**Post comment with piped input (useful for AI integration):**
```bash
echo "Review feedback" | ger comment [change-id]
```

**Post inline comments:**
```bash
ger comment [change-id] --file path/to/file --line 42 -m "Comment on specific line"
```

## Common Workflows

### Reviewing a Change

1. **Fetch the change details:**
   ```bash
   ger show [change-id]
   ```

2. **Review the diff:**
   ```bash
   ger diff [change-id]
   ```

3. **Post your review:**
   ```bash
   ger comment [change-id] -m "LGTM! Great work on the refactoring."
   ```

### AI-Assisted Code Review

Use the ger CLI with AI tools for enhanced code review:

1. **Get the diff:**
   ```bash
   ger diff [change-id] > /tmp/review.diff
   ```

2. **Analyze with AI and post comments:**
   ```bash
   # AI analyzes the diff and generates feedback
   ai-tool analyze /tmp/review.diff | ger comment [change-id]
   ```

## Best Practices

### When Reviewing Code

1. **Always read the full change context** using `ger show` before commenting
2. **Check all comments** with `ger comments` to avoid duplicate feedback
3. **Be specific** in your comments - reference file paths and line numbers
4. **Use constructive language** - focus on improvements, not criticism

### When Managing Changes

1. **Keep changes focused** - one logical change per Gerrit change
2. **Respond to comments promptly** - address reviewer feedback
3. **Use meaningful commit messages** - follow conventional commit format
4. **Test before submitting** - ensure builds pass before requesting review

## Troubleshooting

**Change not found:**
- Ensure you're in the correct repository
- Verify the change-id is correct
- Check your Gerrit authentication

**Permission denied:**
- Verify your Gerrit credentials are configured
- Check you have access to the project
- Ensure you're added as a reviewer (for private changes)

**Build failures:**
- Use `ger build-status` to monitor build progress
- Extract build URLs with `ger extract-url`
- Check build logs for detailed failure information

## Additional Resources

For more detailed information, see [reference.md](reference.md) for complete command documentation and [examples.md](examples.md) for real-world usage examples.

## Notes

- Commands assume you're running from within a Gerrit repository
- Most commands accept an optional change-id; if omitted, they use the current branch
- The tool uses local SQLite caching for offline-first functionality
- All output supports internationalization via i18next
