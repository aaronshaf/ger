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

# Add a comment
ger comment 12345 -m "LGTM"

# Get diff for review
ger diff 12345

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
```bash
# Open in browser
ger open 12345

# Abandon
ger abandon 12345
ger abandon 12345 -m "Reason"
```

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
