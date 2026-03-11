import type { Command } from 'commander'
import { Effect } from 'effect'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigServiceLive } from '@/services/config'
import { analyzeCommand } from './commands/analyze'
import { failuresCommand } from './commands/failures'
import { updateCommand } from './commands/update'

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

export function registerAnalyticsCommands(program: Command): void {
  // update command
  program
    .command('update')
    .description('Update ger to the latest version')
    .option('--skip-pull', 'Skip version check and install directly')
    .action(async (options) => {
      await executeEffect(updateCommand({ skipPull: options.skipPull }), options, 'update_result')
    })

  // failures command
  program
    .command('failures <change-id>')
    .description('Get the most recent build failure link from Service Cloud Jenkins')
    .option('--xml', 'XML output for LLM consumption')
    .option('--json', 'JSON output for programmatic consumption')
    .action(async (changeId, options) => {
      await executeEffect(
        failuresCommand(changeId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'failures_result',
      )
    })

  // analyze command
  program
    .command('analyze')
    .description('Show contribution analytics for merged changes')
    .option('--start-date <date>', 'Start date (YYYY-MM-DD, default: Jan 1 of current year)')
    .option('--end-date <date>', 'End date (YYYY-MM-DD, default: today)')
    .option('--repo <project>', 'Filter by Gerrit project name')
    .option('--json', 'JSON output')
    .option('--xml', 'XML output')
    .option('--markdown', 'Markdown output')
    .option('--csv', 'CSV output')
    .option('--output <file>', 'Write output to file')
    .action(async (options) => {
      await executeEffect(
        analyzeCommand({
          startDate: options.startDate,
          endDate: options.endDate,
          repo: options.repo,
          json: options.json,
          xml: options.xml,
          markdown: options.markdown,
          csv: options.csv,
          output: options.output,
        }).pipe(Effect.provide(GerritApiServiceLive), Effect.provide(ConfigServiceLive)),
        options,
        'analyze_result',
      )
    })
}
