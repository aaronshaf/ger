import type { Command } from 'commander'
import { Effect } from 'effect'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigServiceLive } from '@/services/config'
import { listCommand } from './commands/list'

function executeEffect<E>(
  effect: Effect.Effect<void, E, never>,
  options: { xml?: boolean; json?: boolean },
  resultTag: string,
): Promise<void> {
  if (options.xml && options.json) {
    console.error('✗ Error: --xml and --json are mutually exclusive')
    process.exit(1)
  }
  return Effect.runPromise(effect).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error)
    if (options.json) {
      console.log(JSON.stringify({ status: 'error', error: msg }, null, 2))
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<${resultTag}>`)
      console.log(`  <status>error</status>`)
      console.log(`  <error><![CDATA[${msg}]]></error>`)
      console.log(`</${resultTag}>`)
    } else {
      console.error('✗ Error:', msg)
    }
    process.exit(1)
  })
}

export function registerListCommands(program: Command): void {
  // list command (primary)
  program
    .command('list')
    .description('List your changes or changes needing your review')
    .option('--status <status>', 'Filter by status: open, merged, abandoned (default: open)')
    .option('-n, --limit <number>', 'Maximum number of changes to show (default: 25)', parseInt)
    .option('--detailed', 'Show detailed information for each change')
    .option('--reviewer', 'Show changes where you are a reviewer')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .action(async (options) => {
      await executeEffect(
        listCommand(options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'list_result',
      )
    })

  // mine command (alias for list)
  program
    .command('mine')
    .description('Show your open changes (alias for "ger list")')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .action(async (options) => {
      await executeEffect(
        listCommand(options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'list_result',
      )
    })

  const registerReviewerListCommand = (name: string, description: string): void => {
    program
      .command(name)
      .description(description)
      .option('--status <status>', 'Filter by status: open, merged, abandoned (default: open)')
      .option('-n, --limit <number>', 'Maximum number of changes to show (default: 25)', parseInt)
      .option('--detailed', 'Show detailed information for each change')
      .option('--all-verified', 'Include all verification states (default: open only)')
      .option('-f, --filter <query>', 'Append custom Gerrit query syntax')
      .option('--xml', 'XML output for LLM consumption')
      .option('--json', 'JSON output for programmatic consumption')
      .action(async (options) => {
        await executeEffect(
          listCommand({
            ...options,
            reviewer: true,
            allVerified: options.allVerified,
            filter: options.filter,
          }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(ConfigServiceLive)),
          options,
          'list_result',
        )
      })
  }

  registerReviewerListCommand(
    'incoming',
    'Show changes where you are a reviewer or CC\'d (alias for "ger list --reviewer")',
  )
  registerReviewerListCommand(
    'team',
    'Show changes where you are a reviewer or CC\'d (alias for "ger list --reviewer")',
  )
}
