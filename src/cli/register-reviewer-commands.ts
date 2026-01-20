import type { Command } from 'commander'
import { Effect } from 'effect'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigServiceLive } from '@/services/config'
import { addReviewerCommand } from './commands/add-reviewer'
import { removeReviewerCommand } from './commands/remove-reviewer'

// Helper function to execute Effect with standard error handling
async function executeEffect<E>(
  effect: Effect.Effect<void, E, never>,
  options: { xml?: boolean },
  resultTag: string,
): Promise<void> {
  try {
    await Effect.runPromise(effect)
  } catch (error) {
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
    process.exit(1)
  }
}

/**
 * Register all reviewer-related commands (add-reviewer, remove-reviewer)
 */
export function registerReviewerCommands(program: Command): void {
  // add-reviewer command
  program
    .command('add-reviewer <reviewers...>')
    .description('Add reviewers or groups to a change')
    .option('-c, --change <change-id>', 'Change ID (required until auto-detection is implemented)')
    .option('--cc', 'Add as CC instead of reviewer')
    .option('--group', 'Add as group instead of individual reviewer')
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
  $ ger add-reviewer --group project-reviewers -c 12345 # Add a group
  $ ger add-reviewer --group admins --cc -c 12345       # Add group as CC
  $ ger add-reviewer --notify none user@example.com -c 12345  # No email`,
    )
    .action(async (reviewers, options) => {
      await executeEffect(
        addReviewerCommand(reviewers, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'add_reviewer_result',
      )
    })

  // remove-reviewer command
  program
    .command('remove-reviewer <reviewers...>')
    .description('Remove reviewers from a change')
    .option('-c, --change <change-id>', 'Change ID (required until auto-detection is implemented)')
    .option(
      '--notify <level>',
      'Notification level: none, owner, owner_reviewers, all (default: all)',
    )
    .option('--xml', 'XML output for LLM consumption')
    .addHelpText(
      'after',
      `
Examples:
  $ ger remove-reviewer user@example.com -c 12345          # Remove a reviewer
  $ ger remove-reviewer user1@example.com user2@example.com -c 12345  # Multiple
  $ ger remove-reviewer --notify none user@example.com -c 12345  # No email`,
    )
    .action(async (reviewers, options) => {
      await executeEffect(
        removeReviewerCommand(reviewers, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'remove_reviewer_result',
      )
    })
}
