import type { Command } from 'commander'
import { Effect } from 'effect'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigServiceLive } from '@/services/config'
import { treeSetupCommand, TREE_SETUP_HELP_TEXT } from './commands/tree-setup'
import { treesCommand } from './commands/trees'
import { treeCleanupCommand } from './commands/tree-cleanup'
import { treeRebaseCommand } from './commands/tree-rebase'

async function executeEffect<E>(
  effect: Effect.Effect<void, E, never>,
  options: { xml?: boolean; json?: boolean },
  resultTag: string,
): Promise<void> {
  if (options.xml && options.json) {
    console.error('--xml and --json are mutually exclusive')
    process.exit(1)
  }
  try {
    await Effect.runPromise(effect)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', error: errorMessage }, null, 2))
    } else if (options.xml) {
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

export function registerTreeCommands(program: Command): void {
  const tree = program
    .command('tree')
    .description('Manage git worktrees for reviewing Gerrit changes')

  tree
    .command('setup <change-id>')
    .description('Create a git worktree for reviewing a change')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .addHelpText('after', TREE_SETUP_HELP_TEXT)
    .action(async (changeId: string, options: { xml?: boolean; json?: boolean }) => {
      await executeEffect(
        treeSetupCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'tree_setup_result',
      )
    })

  tree
    .command('cleanup [change-id]')
    .description('Remove ger-managed worktrees (all, or a specific one by change number)')
    .option('--force', 'Force removal even with uncommitted changes')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .addHelpText(
      'after',
      `
Examples:
  # Remove all ger-managed worktrees
  $ ger tree cleanup

  # Remove worktree for a specific change
  $ ger tree cleanup 12345

  # Force removal (discards uncommitted changes)
  $ ger tree cleanup 12345 --force`,
    )
    .action(
      async (
        changeId: string | undefined,
        options: { force?: boolean; xml?: boolean; json?: boolean },
      ) => {
        await executeEffect(treeCleanupCommand(changeId, options), options, 'tree_cleanup_result')
      },
    )

  tree
    .command('rebase')
    .description('Fetch origin and rebase the current worktree')
    .option('--onto <branch>', 'Branch to rebase onto (default: auto-detect)')
    .option('-i, --interactive', 'Interactive rebase')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .addHelpText(
      'after',
      `
Examples:
  # Rebase onto auto-detected upstream
  $ ger tree rebase

  # Rebase onto a specific branch
  $ ger tree rebase --onto origin/main

  # Interactive rebase
  $ ger tree rebase -i`,
    )
    .action(
      async (options: { onto?: string; interactive?: boolean; xml?: boolean; json?: boolean }) => {
        await executeEffect(
          treeRebaseCommand(options).pipe(Effect.provide(ConfigServiceLive)),
          options,
          'tree_rebase_result',
        )
      },
    )

  // 'trees' is a top-level command (matches gerry's naming)
  program
    .command('trees')
    .description('List ger-managed git worktrees in the current repository')
    .option('--all', 'Show all worktrees including the main checkout')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .action(async (options: { all?: boolean; xml?: boolean; json?: boolean }) => {
      await executeEffect(treesCommand(options), options, 'trees_result')
    })
}
