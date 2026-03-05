import type { Command } from 'commander'
import { Effect } from 'effect'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigServiceLive } from '@/services/config'
import { abandonCommand } from './commands/abandon'
import { restoreCommand } from './commands/restore'
import { setReadyCommand } from './commands/set-ready'
import { setWipCommand } from './commands/set-wip'

type StateOptions = { message?: string; xml?: boolean; json?: boolean }

async function executeStateEffect(
  effect: Effect.Effect<void, unknown, never>,
  options: StateOptions,
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
    } else if (options.json) {
      console.log(JSON.stringify({ status: 'error', error: errorMessage }, null, 2))
    } else {
      console.error('✗ Error:', errorMessage)
    }
    process.exit(1)
  }
}

export function registerStateCommands(program: Command): void {
  program
    .command('abandon [change-id]')
    .description(
      'Abandon a change (interactive mode if no change-id provided; accepts change number or Change-ID)',
    )
    .option('-m, --message <message>', 'Abandon message')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .action(async (changeId, options) => {
      await executeStateEffect(
        abandonCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'abandon_result',
      )
    })

  program
    .command('restore <change-id>')
    .description('Restore an abandoned change (accepts change number or Change-ID)')
    .option('-m, --message <message>', 'Restoration message')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .action(async (changeId, options) => {
      await executeStateEffect(
        restoreCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'restore_result',
      )
    })

  program
    .command('set-ready <change-id>')
    .description('Mark a WIP change as ready for review (accepts change number or Change-ID)')
    .option('-m, --message <message>', 'Message to include with the status change')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .action(async (changeId, options) => {
      await executeStateEffect(
        setReadyCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'set_ready_result',
      )
    })

  program
    .command('set-wip <change-id>')
    .description('Mark a change as work-in-progress (accepts change number or Change-ID)')
    .option('-m, --message <message>', 'Message to include with the status change')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .action(async (changeId, options) => {
      await executeStateEffect(
        setWipCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'set_wip_result',
      )
    })
}
