#!/usr/bin/env bun

// Check Bun version requirement
const MIN_BUN_VERSION = '1.2.0'
const bunVersion = Bun.version

function compareSemver(a: string, b: string): number {
  const parseVersion = (v: string) => v.split('.').map((n) => parseInt(n, 10))
  const [aMajor, aMinor = 0, aPatch = 0] = parseVersion(a)
  const [bMajor, bMinor = 0, bPatch = 0] = parseVersion(b)

  if (aMajor !== bMajor) return aMajor - bMajor
  if (aMinor !== bMinor) return aMinor - bMinor
  return aPatch - bPatch
}

if (compareSemver(bunVersion, MIN_BUN_VERSION) < 0) {
  console.error(`✗ Error: Bun version ${MIN_BUN_VERSION} or higher is required`)
  console.error(`  Current version: ${bunVersion}`)
  console.error(`  Please upgrade Bun: bun upgrade`)
  process.exit(1)
}

import { Command } from 'commander'
import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigServiceLive } from '@/services/config'
import { ReviewStrategyServiceLive } from '@/services/review-strategy'
import { GitWorktreeServiceLive } from '@/services/git-worktree'
import { abandonCommand } from './commands/abandon'
import { addReviewerCommand } from './commands/add-reviewer'
import { buildStatusCommand } from './commands/build-status'
import { commentCommand } from './commands/comment'
import { commentsCommand } from './commands/comments'
import { diffCommand } from './commands/diff'
import { extractUrlCommand } from './commands/extract-url'
import { incomingCommand } from './commands/incoming'
import { mineCommand } from './commands/mine'
import { openCommand } from './commands/open'
import { reviewCommand } from './commands/review'
import { setup } from './commands/setup'
import { showCommand } from './commands/show'
import { statusCommand } from './commands/status'
import { workspaceCommand } from './commands/workspace'
import { sanitizeCDATA } from '@/utils/shell-safety'

// Read version from package.json
function getVersion(): string {
  try {
    // Get the directory of the current module
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)

    // Navigate up to the project root and read package.json
    const packageJsonPath = join(__dirname, '..', '..', 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    return packageJson.version || '0.0.0'
  } catch {
    // Fallback version if package.json can't be read
    return '0.0.0'
  }
}

const program = new Command()

program.name('gi').description('LLM-centric Gerrit CLI tool').version(getVersion())

// setup command (new primary command)
program
  .command('setup')
  .description('Configure Gerrit credentials and AI tools')
  .action(async () => {
    await setup()
  })

// init command (kept for backward compatibility, redirects to setup)
program
  .command('init')
  .description('Initialize Gerrit credentials (alias for setup)')
  .action(async () => {
    await setup()
  })

// status command
program
  .command('status')
  .description('Check connection status')
  .option('--xml', 'XML output for LLM consumption')
  .action(async (options) => {
    try {
      const effect = statusCommand(options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

// comment command
program
  .command('comment <change-id>')
  .description('Post a comment on a change (accepts change number or Change-ID)')
  .option('-m, --message <message>', 'Comment message')
  .option('--file <file>', 'File path for line-specific comment (relative to repo root)')
  .option(
    '--line <line>',
    'Line number in the NEW version of the file (not diff line numbers)',
    parseInt,
  )
  .option('--unresolved', 'Mark comment as unresolved (requires human attention)')
  .option('--batch', 'Read batch comments from stdin as JSON (see examples below)')
  .option('--xml', 'XML output for LLM consumption')
  .addHelpText(
    'after',
    `
Examples:
  # Post a general comment on a change (using change number)
  $ ger comment 12345 -m "Looks good to me!"

  # Post a comment using Change-ID
  $ ger comment If5a3ae8cb5a107e187447802358417f311d0c4b1 -m "LGTM"

  # Post a comment using piped input (useful for multi-line comments or scripts)
  $ echo "This is a comment from stdin!" | ger comment 12345
  $ cat review-notes.txt | ger comment 12345

  # Post a line-specific comment (line number from NEW file version)
  $ ger comment 12345 --file src/main.js --line 42 -m "Consider using const here"

  # Post an unresolved comment requiring human attention
  $ ger comment 12345 --file src/api.js --line 15 -m "Security concern" --unresolved

  # Post multiple comments using batch mode
  $ echo '{"message": "Review complete", "comments": [
      {"file": "src/main.js", "line": 10, "message": "Good refactor"},
      {"file": "src/api.js", "line": 25, "message": "Check error handling", "unresolved": true}
    ]}' | ger comment 12345 --batch

Note:
  - Both change number (e.g., 12345) and Change-ID (e.g., If5a3ae8...) formats are accepted
  - Line numbers refer to the actual line numbers in the NEW version of the file,
    NOT the line numbers shown in the diff view. To find the correct line number,
    look at the file after all changes have been applied.`,
  )
  .action(async (changeId, options) => {
    try {
      const effect = commentCommand(changeId, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<comment_result>`)
        console.log(`  <status>error</status>`)
        console.log(
          `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
        )
        console.log(`</comment_result>`)
      } else {
        console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      }
      process.exit(1)
    }
  })

// diff command
program
  .command('diff <change-id>')
  .description('Get diff for a change (accepts change number or Change-ID)')
  .option('--xml', 'XML output for LLM consumption')
  .option('--file <file>', 'Specific file to diff')
  .option('--files-only', 'List changed files only')
  .option('--format <format>', 'Output format (unified, json, files)')
  .action(async (changeId, options) => {
    try {
      const effect = diffCommand(changeId, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<diff_result>`)
        console.log(`  <status>error</status>`)
        console.log(
          `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
        )
        console.log(`</diff_result>`)
      } else {
        console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      }
      process.exit(1)
    }
  })

// mine command
program
  .command('mine')
  .description('Show your open changes')
  .option('--xml', 'XML output for LLM consumption')
  .action(async (options) => {
    try {
      const effect = mineCommand(options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<mine_result>`)
        console.log(`  <status>error</status>`)
        console.log(
          `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
        )
        console.log(`</mine_result>`)
      } else {
        console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      }
      process.exit(1)
    }
  })

// workspace command
program
  .command('workspace <change-id>')
  .description(
    'Create or switch to a git worktree for a Gerrit change (accepts change number or Change-ID)',
  )
  .option('--xml', 'XML output for LLM consumption')
  .action(async (changeId, options) => {
    try {
      const effect = workspaceCommand(changeId, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<workspace_result>`)
        console.log(`  <status>error</status>`)
        console.log(
          `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
        )
        console.log(`</workspace_result>`)
      } else {
        console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      }
      process.exit(1)
    }
  })

// incoming command
program
  .command('incoming')
  .description('Show incoming changes for review (where you are a reviewer)')
  .option('--xml', 'XML output for LLM consumption')
  .option('-i, --interactive', 'Interactive mode with detailed view and diff')
  .action(async (options) => {
    try {
      const effect = incomingCommand(options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<incoming_result>`)
        console.log(`  <status>error</status>`)
        console.log(
          `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
        )
        console.log(`</incoming_result>`)
      } else {
        console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      }
      process.exit(1)
    }
  })

// abandon command
program
  .command('abandon [change-id]')
  .description(
    'Abandon a change (interactive mode if no change-id provided; accepts change number or Change-ID)',
  )
  .option('-m, --message <message>', 'Abandon message')
  .option('--xml', 'XML output for LLM consumption')
  .action(async (changeId, options) => {
    try {
      const effect = abandonCommand(changeId, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<abandon_result>`)
        console.log(`  <status>error</status>`)
        console.log(
          `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
        )
        console.log(`</abandon_result>`)
      } else {
        console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      }
      process.exit(1)
    }
  })

// add-reviewer command
program
  .command('add-reviewer <reviewers...>')
  .description('Add reviewers to a change')
  .option('-c, --change <change-id>', 'Change ID (required until auto-detection is implemented)')
  .option('--cc', 'Add as CC instead of reviewer')
  .option(
    '--notify <level>',
    'Notification level: none, owner, owner_reviewers, all (default: all)',
  )
  .option('--xml', 'XML output for LLM consumption')
  .addHelpText(
    'after',
    `
Examples:
  $ ger add-reviewer user@example.com -c 12345          # Add a reviewer
  $ ger add-reviewer user1@example.com user2@example.com -c 12345  # Multiple
  $ ger add-reviewer --cc user@example.com -c 12345     # Add as CC
  $ ger add-reviewer --notify none user@example.com -c 12345  # No email`,
  )
  .action(async (reviewers, options) => {
    try {
      const effect = addReviewerCommand(reviewers, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<add_reviewer_result>`)
        console.log(`  <status>error</status>`)
        console.log(
          `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
        )
        console.log(`</add_reviewer_result>`)
      } else {
        console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      }
      process.exit(1)
    }
  })

// comments command
program
  .command('comments <change-id>')
  .description(
    'Show all comments on a change with diff context (accepts change number or Change-ID)',
  )
  .option('--xml', 'XML output for LLM consumption')
  .action(async (changeId, options) => {
    try {
      const effect = commentsCommand(changeId, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<comments_result>`)
        console.log(`  <status>error</status>`)
        console.log(
          `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
        )
        console.log(`</comments_result>`)
      } else {
        console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      }
      process.exit(1)
    }
  })

// open command
program
  .command('open <change-id>')
  .description('Open a change in the browser (accepts change number or Change-ID)')
  .action(async (changeId, options) => {
    try {
      const effect = openCommand(changeId, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

// show command
program
  .command('show [change-id]')
  .description(
    'Show comprehensive change information (auto-detects from HEAD commit if not specified)',
  )
  .option('--xml', 'XML output for LLM consumption')
  .option('--json', 'JSON output for programmatic consumption')
  .addHelpText(
    'after',
    `
Examples:
  # Show specific change (using change number)
  $ ger show 392385

  # Show specific change (using Change-ID)
  $ ger show If5a3ae8cb5a107e187447802358417f311d0c4b1

  # Auto-detect Change-ID from HEAD commit
  $ ger show
  $ ger show --xml
  $ ger show --json

  # Extract build failure URL with jq
  $ ger show 392090 --json | jq -r '.messages[] | select(.message | contains("Build Failed")) | .message' | grep -oP 'https://[^\\s]+'

Note: When no change-id is provided, it will be automatically extracted from the
      Change-ID footer in your HEAD commit. You must be in a git repository with
      a commit that has a Change-ID.`,
  )
  .action(async (changeId, options) => {
    try {
      const effect = showCommand(changeId, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', error: errorMessage }, null, 2))
      } else if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<show_result>`)
        console.log(`  <status>error</status>`)
        console.log(`  <error><![CDATA[${sanitizeCDATA(errorMessage)}]]></error>`)
        console.log(`</show_result>`)
      } else {
        console.error('✗ Error:', errorMessage)
      }
      process.exit(1)
    }
  })

// build-status command
program
  .command('build-status [change-id]')
  .description(
    'Check build status from Gerrit messages (auto-detects from HEAD commit if not specified)',
  )
  .option('--watch', 'Watch build status until completion (mimics gh run watch)')
  .option('-i, --interval <seconds>', 'Refresh interval in seconds (default: 10)', '10')
  .option('--timeout <seconds>', 'Maximum wait time in seconds (default: 1800 / 30min)', '1800')
  .option('--exit-status', 'Exit with non-zero status if build fails')
  .addHelpText(
    'after',
    `
This command parses Gerrit change messages to determine build status.
It looks for "Build Started" messages and subsequent verification labels.

Output is JSON with a "state" field that can be:
  - pending: No build has started yet
  - running: Build started but no verification yet
  - success: Build completed with Verified+1
  - failure: Build completed with Verified-1
  - not_found: Change does not exist

Exit codes:
  - 0: Default for all states (like gh run watch)
  - 1: Only when --exit-status is used AND build fails
  - 2: Timeout reached in watch mode
  - 3: API/network errors

Examples:
  # Single check (current behavior)
  $ ger build-status 392385
  {"state":"success"}

  # Watch until completion (outputs JSON on each poll)
  $ ger build-status 392385 --watch
  {"state":"pending"}
  {"state":"running"}
  {"state":"running"}
  {"state":"success"}

  # Watch with custom interval (check every 5 seconds)
  $ ger build-status --watch --interval 5

  # Watch with custom timeout (60 minutes)
  $ ger build-status --watch --timeout 3600

  # Exit with code 1 on failure (for CI/CD pipelines)
  $ ger build-status --watch --exit-status && deploy.sh

  # Trigger notification when done (like gh run watch pattern)
  $ ger build-status --watch && notify-send 'Build is done!'

  # Parse final state in scripts
  $ ger build-status --watch | tail -1 | jq -r '.state'
  success

Note: When no change-id is provided, it will be automatically extracted from the
      Change-ID footer in your HEAD commit.`,
  )
  .action(async (changeId, cmdOptions) => {
    try {
      const effect = buildStatusCommand(changeId, {
        watch: cmdOptions.watch,
        interval: Number.parseInt(cmdOptions.interval, 10),
        timeout: Number.parseInt(cmdOptions.timeout, 10),
        exitStatus: cmdOptions.exitStatus,
      }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(ConfigServiceLive))
      await Effect.runPromise(effect)
    } catch (error) {
      // Errors are handled within the command itself
      // This catch is just for any unexpected errors
      if (error instanceof Error && error.message !== 'Process exited') {
        console.error('✗ Unexpected error:', error.message)
        process.exit(3)
      }
    }
  })

// extract-url command
program
  .command('extract-url <pattern> [change-id]')
  .description(
    'Extract URLs from change messages and comments (auto-detects from HEAD commit if not specified)',
  )
  .option('--include-comments', 'Also search inline comments (default: messages only)')
  .option('--regex', 'Treat pattern as regex instead of substring match')
  .option('--xml', 'XML output for LLM consumption')
  .option('--json', 'JSON output for programmatic consumption')
  .addHelpText(
    'after',
    `
Examples:
  # Extract all Jenkins build-summary-report URLs (substring match)
  $ ger extract-url "build-summary-report"

  # Get the latest build URL using tail
  $ ger extract-url "build-summary-report" | tail -1

  # Get the first build URL using head
  $ ger extract-url "jenkins.inst-ci.net" | head -1

  # For a specific change (using change number)
  $ ger extract-url "build-summary" 391831

  # For a specific change (using Change-ID)
  $ ger extract-url "jenkins" If5a3ae8cb5a107e187447802358417f311d0c4b1

  # Use regex for precise matching
  $ ger extract-url "job/Canvas/job/main/\\d+/" --regex

  # Search both messages and inline comments
  $ ger extract-url "github.com" --include-comments

  # JSON output for scripting
  $ ger extract-url "jenkins" --json | jq -r '.urls[-1]'

  # XML output
  $ ger extract-url "jenkins" --xml

Note:
  - URLs are output in chronological order (oldest first)
  - Use tail -1 to get the latest URL, head -1 for the oldest
  - When no change-id is provided, it will be automatically extracted from the
    Change-ID footer in your HEAD commit`,
  )
  .action(async (pattern, changeId, options) => {
    try {
      const effect = extractUrlCommand(pattern, changeId, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', error: errorMessage }, null, 2))
      } else if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<extract_url_result>`)
        console.log(`  <status>error</status>`)
        console.log(`  <error><![CDATA[${sanitizeCDATA(errorMessage)}]]></error>`)
        console.log(`</extract_url_result>`)
      } else {
        console.error('✗ Error:', errorMessage)
      }
      process.exit(1)
    }
  })

// review command
program
  .command('review <change-id>')
  .description(
    'AI-powered code review that analyzes changes and optionally posts comments (accepts change number or Change-ID)',
  )
  .option('--comment', 'Post the review as comments (prompts for confirmation)')
  .option('-y, --yes', 'Skip confirmation prompts when posting comments')
  .option('--debug', 'Show debug output including AI responses')
  .option('--prompt <file>', 'Path to custom review prompt file (e.g., ~/prompts/review.md)')
  .option('--tool <tool>', 'Preferred AI tool (claude, gemini, opencode)')
  .option('--system-prompt <prompt>', 'Custom system prompt for the AI')
  .addHelpText(
    'after',
    `
This command uses AI (claude CLI, gemini CLI, or opencode CLI) to review a Gerrit change.
It performs a two-stage review process:

1. Generates inline comments for specific code issues
2. Generates an overall review comment

By default, the review is only displayed in the terminal.
Use --comment to post the review to Gerrit (with confirmation prompts).
Use --comment --yes to post without confirmation.

Requirements:
  - One of these AI tools must be available: claude CLI, gemini CLI, or opencode CLI
  - Gerrit credentials must be configured (run 'ger setup' first)

Examples:
  # Review a change using change number (display only)
  $ ger review 12345

  # Review using Change-ID
  $ ger review If5a3ae8cb5a107e187447802358417f311d0c4b1

  # Review and prompt to post comments
  $ ger review 12345 --comment

  # Review and auto-post comments without prompting
  $ ger review 12345 --comment --yes

  # Use specific AI tool
  $ ger review 12345 --tool gemini

  # Show debug output to troubleshoot issues
  $ ger review 12345 --debug

Note: Both change number (e.g., 12345) and Change-ID (e.g., If5a3ae8...) formats are accepted
`,
  )
  .action(async (changeId, options) => {
    try {
      const effect = reviewCommand(changeId, {
        comment: options.comment,
        yes: options.yes,
        debug: options.debug,
        prompt: options.prompt,
        tool: options.tool,
        systemPrompt: options.systemPrompt,
      }).pipe(
        Effect.provide(ReviewStrategyServiceLive),
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
        Effect.provide(GitWorktreeServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  })

program.parse(process.argv)
