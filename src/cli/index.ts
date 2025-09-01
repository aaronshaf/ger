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
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigServiceLive } from '@/services/config'
import { AiServiceLive } from '@/services/ai-enhanced'
import { GitWorktreeServiceLive } from '@/services/git-worktree'
import { abandonCommand } from './commands/abandon'
import { commentCommand } from './commands/comment'
import { commentsCommand } from './commands/comments'
import { diffCommand } from './commands/diff'
import { incomingCommand } from './commands/incoming'
import { mineCommand } from './commands/mine'
import { openCommand } from './commands/open'
import { reviewCommand } from './commands/review'
import { setup } from './commands/setup'
import { showCommand } from './commands/show'
import { statusCommand } from './commands/status'
import { workspaceCommand } from './commands/workspace'

const program = new Command()

program.name('gi').description('LLM-centric Gerrit CLI tool').version('0.1.0')

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
  .description('Post a comment on a change')
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
  # Post a general comment on a change
  $ ger comment 12345 -m "Looks good to me!"

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

Note: Line numbers refer to the actual line numbers in the NEW version of the file,
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
  .description('Get diff for a change')
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
  .description('Create or switch to a git worktree for a Gerrit change')
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
  .description('Abandon a change (interactive mode if no change-id provided)')
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

// comments command
program
  .command('comments <change-id>')
  .description('Show all comments on a change with diff context')
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
  .description('Open a change in the browser')
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
  .command('show <change-id>')
  .description('Show comprehensive change information including metadata, diff, and all comments')
  .option('--xml', 'XML output for LLM consumption')
  .action(async (changeId, options) => {
    try {
      const effect = showCommand(changeId, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect)
    } catch (error) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<show_result>`)
        console.log(`  <status>error</status>`)
        console.log(
          `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
        )
        console.log(`</show_result>`)
      } else {
        console.error('✗ Error:', error instanceof Error ? error.message : String(error))
      }
      process.exit(1)
    }
  })

// review command
program
  .command('review <change-id>')
  .description('AI-powered code review that analyzes changes and optionally posts comments')
  .option('--comment', 'Post the review as comments (prompts for confirmation)')
  .option('-y, --yes', 'Skip confirmation prompts when posting comments')
  .option('--debug', 'Show debug output including AI responses')
  .option('--prompt <file>', 'Path to custom review prompt file (e.g., ~/prompts/review.md)')
  .addHelpText(
    'after',
    `
This command uses AI (claude, llm, or opencode CLI) to review a Gerrit change.
It performs a two-stage review process:

1. Generates inline comments for specific code issues
2. Generates an overall review comment

By default, the review is only displayed in the terminal.
Use --comment to post the review to Gerrit (with confirmation prompts).
Use --comment --yes to post without confirmation.

Requirements:
  - One of these AI tools must be installed: claude, llm, or opencode
  - Gerrit credentials must be configured (run 'ger setup' first)

Examples:
  # Review a change (display only)
  $ ger review 12345
  
  # Review and prompt to post comments
  $ ger review 12345 --comment
  
  # Review and auto-post comments without prompting
  $ ger review 12345 --comment --yes
  
  # Show debug output to troubleshoot issues
  $ ger review 12345 --debug
`,
  )
  .action(async (changeId, options) => {
    try {
      const effect = reviewCommand(changeId, {
        comment: options.comment,
        yes: options.yes,
        debug: options.debug,
        prompt: options.prompt,
      }).pipe(
        Effect.provide(AiServiceLive),
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
