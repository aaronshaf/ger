import type { Command } from 'commander'
import { Effect } from 'effect'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigServiceLive } from '@/services/config'
import { ReviewStrategyServiceLive } from '@/services/review-strategy'
import { GitWorktreeServiceLive } from '@/services/git-worktree'
import { CommitHookServiceLive } from '@/services/commit-hook'
import { abandonCommand } from './commands/abandon'
import { restoreCommand } from './commands/restore'
import { rebaseCommand } from './commands/rebase'
import { submitCommand } from './commands/submit'
import { voteCommand } from './commands/vote'
import { projectsCommand } from './commands/projects'
import { buildStatusCommand, BUILD_STATUS_HELP_TEXT } from './commands/build-status'
import { checkoutCommand, CHECKOUT_HELP_TEXT } from './commands/checkout'
import { commentCommand } from './commands/comment'
import { commentsCommand } from './commands/comments'
import { diffCommand } from './commands/diff'
import { extractUrlCommand } from './commands/extract-url'
import { incomingCommand } from './commands/incoming'
import { mineCommand } from './commands/mine'
import { openCommand } from './commands/open'
import { pushCommand, PUSH_HELP_TEXT } from './commands/push'
import { reviewCommand } from './commands/review'
import { searchCommand, SEARCH_HELP_TEXT } from './commands/search'
import { setup } from './commands/setup'
import { showCommand, SHOW_HELP_TEXT } from './commands/show'
import { statusCommand } from './commands/status'
import { workspaceCommand } from './commands/workspace'
import { sanitizeCDATA } from '@/utils/shell-safety'
import { registerGroupCommands } from './register-group-commands'
import { registerReviewerCommands } from './register-reviewer-commands'

// Helper function to output error in plain text or XML format
function outputError(error: unknown, options: { xml?: boolean }, resultTag: string): void {
  const errorMessage = error instanceof Error ? error.message : String(error)
  if (options.xml) {
    console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
    console.log(`<${resultTag}>`)
    console.log(`  <status>error</status>`)
    console.log(`  <error><![CDATA[${errorMessage}]]></error>`)
    console.log(`</${resultTag}>`)
  } else {
    console.error('✗ Error:', errorMessage)
  }
}

// Helper function to execute Effect with standard error handling
async function executeEffect<E>(
  effect: Effect.Effect<void, E, never>,
  options: { xml?: boolean },
  resultTag: string,
): Promise<void> {
  try {
    await Effect.runPromise(effect)
  } catch (error) {
    outputError(error, options, resultTag)
    process.exit(1)
  }
}

export function registerCommands(program: Command): void {
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
      await executeEffect(
        statusCommand(options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'status_result',
      )
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
      await executeEffect(
        commentCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'comment_result',
      )
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
      await executeEffect(
        diffCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'diff_result',
      )
    })

  // mine command
  program
    .command('mine')
    .description('Show your open changes')
    .option('--xml', 'XML output for LLM consumption')
    .action(async (options) => {
      await executeEffect(
        mineCommand(options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'mine_result',
      )
    })

  // search command
  program
    .command('search [query]')
    .description('Search changes using Gerrit query syntax')
    .option('--xml', 'XML output for LLM consumption')
    .option('-n, --limit <number>', 'Limit results (default: 25)')
    .addHelpText('after', SEARCH_HELP_TEXT)
    .action(async (query, options) => {
      const effect = searchCommand(query, options).pipe(
        Effect.provide(GerritApiServiceLive),
        Effect.provide(ConfigServiceLive),
      )
      await Effect.runPromise(effect).catch((error: unknown) => {
        if (options.xml) {
          console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
          console.log(`<search_result>`)
          console.log(`  <status>error</status>`)
          console.log(
            `  <error><![CDATA[${error instanceof Error ? error.message : String(error)}]]></error>`,
          )
          console.log(`</search_result>`)
        } else {
          console.error('✗ Error:', error instanceof Error ? error.message : String(error))
        }
        process.exit(1)
      })
    })

  // workspace command
  program
    .command('workspace <change-id>')
    .description(
      'Create or switch to a git worktree for a Gerrit change (accepts change number or Change-ID)',
    )
    .option('--xml', 'XML output for LLM consumption')
    .action(async (changeId, options) => {
      await executeEffect(
        workspaceCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'workspace_result',
      )
    })

  // incoming command
  program
    .command('incoming')
    .description('Show incoming changes for review (where you are a reviewer)')
    .option('--xml', 'XML output for LLM consumption')
    .option('-i, --interactive', 'Interactive mode with detailed view and diff')
    .action(async (options) => {
      await executeEffect(
        incomingCommand(options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'incoming_result',
      )
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
      await executeEffect(
        abandonCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'abandon_result',
      )
    })

  // restore command
  program
    .command('restore <change-id>')
    .description('Restore an abandoned change (accepts change number or Change-ID)')
    .option('-m, --message <message>', 'Restoration message')
    .option('--xml', 'XML output for LLM consumption')
    .action(async (changeId, options) => {
      await executeEffect(
        restoreCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'restore_result',
      )
    })

  // rebase command
  program
    .command('rebase [change-id]')
    .description('Rebase a change onto target branch (auto-detects from HEAD if not provided)')
    .option('--base <ref>', 'Base revision to rebase onto (default: target branch HEAD)')
    .option('--xml', 'XML output for LLM consumption')
    .action(async (changeId, options) => {
      await executeEffect(
        rebaseCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'rebase_result',
      )
    })

  // submit command
  program
    .command('submit <change-id>')
    .description('Submit a change for merging (accepts change number or Change-ID)')
    .option('--xml', 'XML output for LLM consumption')
    .action(async (changeId, options) => {
      await executeEffect(
        submitCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'submit_result',
      )
    })

  // vote command
  program
    .command('vote <change-id>')
    .description('Cast votes on a change (accepts change number or Change-ID)')
    .option('--code-review <value>', 'Code-Review vote (-2 to +2)', parseInt)
    .option('--verified <value>', 'Verified vote (-1 to +1)', parseInt)
    .option('--label <name> <value>', 'Custom label vote (can be used multiple times)')
    .option('-m, --message <message>', 'Comment with vote')
    .option('--xml', 'XML output for LLM consumption')
    .action(async (changeId, options) => {
      await executeEffect(
        voteCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'vote_result',
      )
    })

  // Register all reviewer-related commands
  registerReviewerCommands(program)

  // projects command
  program
    .command('projects')
    .description('List Gerrit projects')
    .option('--pattern <regex>', 'Filter projects by name pattern')
    .option('--xml', 'XML output for LLM consumption')
    .action(async (options) => {
      await executeEffect(
        projectsCommand(options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'projects_result',
      )
    })

  // Register all group-related commands
  registerGroupCommands(program)

  // comments command
  program
    .command('comments <change-id>')
    .description(
      'Show all comments on a change with diff context (accepts change number or Change-ID)',
    )
    .option('--xml', 'XML output for LLM consumption')
    .action(async (changeId, options) => {
      await executeEffect(
        commentsCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'comments_result',
      )
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
    .addHelpText('after', SHOW_HELP_TEXT)
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
    .addHelpText('after', BUILD_STATUS_HELP_TEXT)
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
  $ ger extract-url "job/MyProject/job/main/\\d+/" --regex

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

  // push command
  program
    .command('push')
    .description('Push commits to Gerrit for code review')
    .option('-b, --branch <branch>', 'Target branch (default: auto-detect)')
    .option('-t, --topic <topic>', 'Set change topic')
    .option('-r, --reviewer <email...>', 'Add reviewer(s)')
    .option('--cc <email...>', 'Add CC recipient(s)')
    .option('--wip', 'Mark as work-in-progress')
    .option('--ready', 'Mark as ready for review')
    .option('--hashtag <tag...>', 'Add hashtag(s)')
    .option('--private', 'Mark change as private')
    .option('--draft', 'Alias for --wip')
    .option('--dry-run', 'Show what would be pushed without pushing')
    .addHelpText('after', PUSH_HELP_TEXT)
    .action(async (options) => {
      try {
        const effect = pushCommand({
          branch: options.branch,
          topic: options.topic,
          reviewer: options.reviewer,
          cc: options.cc,
          wip: options.wip,
          ready: options.ready,
          hashtag: options.hashtag,
          private: options.private,
          draft: options.draft,
          dryRun: options.dryRun,
        }).pipe(Effect.provide(CommitHookServiceLive), Effect.provide(ConfigServiceLive))
        await Effect.runPromise(effect)
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })

  // checkout command
  program
    .command('checkout <change-id>')
    .description('Fetch and checkout a Gerrit change')
    .option('--detach', 'Checkout as detached HEAD without creating branch')
    .option('--remote <name>', 'Use specific git remote (default: auto-detect)')
    .addHelpText('after', CHECKOUT_HELP_TEXT)
    .action(async (changeId, options) => {
      try {
        const effect = checkoutCommand(changeId, {
          detach: options.detach,
          remote: options.remote,
        }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(ConfigServiceLive))
        await Effect.runPromise(effect)
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error))
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
}
