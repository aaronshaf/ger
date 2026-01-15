# ger CLI Command Reference

Complete reference documentation for all ger CLI commands.

## Change Viewing Commands

### show

Display comprehensive information about a Gerrit change.

**Syntax:**
```bash
ger show [change-id] [options]
```

**Options:**
- `--format <format>` - Output format: `text`, `json`, `markdown`
- `--no-comments` - Exclude comments from output
- `--no-diff` - Exclude diff from output

**Examples:**
```bash
# Show current change
ger show

# Show specific change
ger show 12345

# Show as JSON
ger show 12345 --format json

# Show without comments
ger show --no-comments
```

**Output includes:**
- Change metadata (owner, status, subject)
- Commit message
- File diffs
- All comments and inline feedback
- Jenkins build status (if available)

### diff

Get the diff for a Gerrit change.

**Syntax:**
```bash
ger diff [change-id] [options]
```

**Options:**
- `--format <format>` - Output format: `unified`, `context`, `json`
- `--file <path>` - Show diff for specific file only
- `--base <revision>` - Compare against specific base revision

**Examples:**
```bash
# Get unified diff
ger diff 12345

# Get diff for specific file
ger diff 12345 --file src/api/client.ts

# Get diff as JSON
ger diff 12345 --format json
```

### comments

View all comments on a change.

**Syntax:**
```bash
ger comments [change-id] [options]
```

**Options:**
- `--format <format>` - Output format: `text`, `json`, `markdown`
- `--unresolved-only` - Show only unresolved comments
- `--file <path>` - Show comments for specific file only

**Examples:**
```bash
# View all comments
ger comments 12345

# View unresolved comments only
ger comments 12345 --unresolved-only

# View comments for specific file
ger comments 12345 --file src/api/client.ts
```

## Change Management Commands

### mine

List all changes owned by you.

**Syntax:**
```bash
ger mine [options]
```

**Options:**
- `--status <status>` - Filter by status: `open`, `merged`, `abandoned`
- `--format <format>` - Output format: `table`, `json`, `list`
- `--limit <n>` - Limit number of results

**Examples:**
```bash
# List all your open changes
ger mine

# List merged changes
ger mine --status merged

# List as JSON
ger mine --format json
```

### incoming

List changes that need your review.

**Syntax:**
```bash
ger incoming [options]
```

**Options:**
- `--format <format>` - Output format: `table`, `json`, `list`
- `--limit <n>` - Limit number of results

**Examples:**
```bash
# List incoming review requests
ger incoming

# Get as JSON
ger incoming --format json
```

### open

List all open changes in the project.

**Syntax:**
```bash
ger open [options]
```

**Options:**
- `--owner <email>` - Filter by change owner
- `--format <format>` - Output format: `table`, `json`, `list`
- `--limit <n>` - Limit number of results

**Examples:**
```bash
# List all open changes
ger open

# Filter by owner
ger open --owner user@example.com
```

### abandon

Mark a change as abandoned.

**Syntax:**
```bash
ger abandon [change-id] [options]
```

**Options:**
- `--message <text>` - Abandonment message

**Examples:**
```bash
# Abandon with message
ger abandon 12345 --message "No longer needed"

# Abandon current change
ger abandon
```

### checkout

Checkout a specific change revision locally.

**Syntax:**
```bash
ger checkout <change-id> [options]
```

**Options:**
- `--revision <n>` - Checkout specific patchset revision (default: latest)

**Examples:**
```bash
# Checkout latest revision
ger checkout 12345

# Checkout specific revision
ger checkout 12345 --revision 3
```

## Commenting Commands

### comment

Post a comment on a Gerrit change.

**Syntax:**
```bash
ger comment [change-id] [options]
```

**Options:**
- `-m, --message <text>` - Comment message
- `--file <path>` - File for inline comment
- `--line <n>` - Line number for inline comment
- `--unresolved` - Mark comment as unresolved (requiring action)

**Examples:**
```bash
# Post general comment
ger comment 12345 -m "Looks good!"

# Post inline comment
ger comment 12345 --file src/api/client.ts --line 42 -m "Consider error handling here"

# Mark as unresolved
ger comment 12345 -m "Please fix the type error" --unresolved

# Pipe input from stdin
echo "Review feedback from AI" | ger comment 12345
```

**Piped Input:**
The comment command accepts piped input, making it easy to integrate with AI tools:
```bash
# AI-generated review
cat diff.txt | ai-review-tool | ger comment 12345

# GPT-4 review
ger diff 12345 | gpt-4-review | ger comment 12345
```

## Build Integration Commands

### build-status

Check the build status for a change.

**Syntax:**
```bash
ger build-status [change-id] [options]
```

**Options:**
- `--watch` - Watch build status and wait for completion
- `--interval <seconds>` - Polling interval for watch mode (default: 30)
- `--timeout <seconds>` - Maximum wait time for watch mode

**Examples:**
```bash
# Check current status
ger build-status 12345

# Watch until build completes
ger build-status 12345 --watch

# Watch with custom interval and timeout
ger build-status 12345 --watch --interval 20 --timeout 1800
```

### extract-url

Extract URLs from change metadata (e.g., build reports, Jenkins links).

**Syntax:**
```bash
ger extract-url <url-type> [change-id]
```

**URL Types:**
- `build-summary-report` - Jenkins build summary report
- `jenkins` - Main Jenkins build URL
- `test-results` - Test results URL

**Examples:**
```bash
# Extract build summary report URL
ger extract-url "build-summary-report"

# Extract for specific change
ger extract-url "jenkins" 12345

# Get the latest URL
ger extract-url "build-summary-report" | tail -1
```

## Configuration Commands

### config

Manage ger CLI configuration.

**Syntax:**
```bash
ger config <action> [key] [value]
```

**Actions:**
- `get <key>` - Get configuration value
- `set <key> <value>` - Set configuration value
- `list` - List all configuration
- `reset` - Reset to defaults

**Examples:**
```bash
# Set Gerrit URL
ger config set gerrit.url https://gerrit.example.com

# Get current URL
ger config get gerrit.url

# List all config
ger config list
```

## Global Options

These options work with all commands:

- `--help` - Show help for command
- `--version` - Show ger version
- `--no-cache` - Skip cache and fetch fresh data
- `--debug` - Enable debug logging
- `--quiet` - Suppress non-essential output

**Examples:**
```bash
# Show help for a command
ger show --help

# Skip cache
ger mine --no-cache

# Enable debug mode
ger show 12345 --debug
```

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Invalid arguments
- `3` - API error
- `4` - Authentication error
- `5` - Not found error

## Environment Variables

- `GER_URL` - Gerrit server URL
- `GER_USERNAME` - Gerrit username
- `GER_PASSWORD` - Gerrit password/token
- `GER_CACHE_DIR` - Cache directory path (default: `~/.ger/cache`)
- `GER_LOG_LEVEL` - Log level: `debug`, `info`, `warn`, `error`

**Example:**
```bash
export GER_URL=https://gerrit.example.com
export GER_LOG_LEVEL=debug
ger mine
```

## Cache Behavior

The ger CLI uses SQLite for local-first caching:

- **Changes** - Cached for 5 minutes
- **Comments** - Cached for 2 minutes
- **Diffs** - Cached for 10 minutes
- **User data** - Cached for 1 hour

Use `--no-cache` to bypass cache and fetch fresh data.

## API Rate Limiting

The ger CLI respects Gerrit API rate limits:

- Maximum 100 requests per minute
- Automatic retry with exponential backoff
- Rate limit status shown in debug mode

## Error Handling

All commands use Effect Schema for validation and provide clear error messages:

```bash
# Invalid change ID
$ ger show invalid
Error: Invalid change ID format. Expected number or Change-Id string.

# Network error
$ ger mine
Error: Failed to connect to Gerrit server. Check your network connection.

# Permission error
$ ger abandon 12345
Error: Permission denied. You must be the change owner to abandon it.
```

## Internationalization

The ger CLI supports multiple languages via i18next. Set your locale:

```bash
export LANG=es_ES.UTF-8
ger mine
```

Supported languages:
- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Japanese (ja)
- Chinese (zh)
