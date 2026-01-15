import type { Command } from 'commander'
import { Effect } from 'effect'
import { GerritApiServiceLive } from '@/api/gerrit'
import { ConfigServiceLive } from '@/services/config'
import { groupsCommand } from './commands/groups'
import { groupsShowCommand } from './commands/groups-show'
import { groupsMembersCommand } from './commands/groups-members'

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
 * Register all group-related commands (groups, groups-show, groups-members)
 */
export function registerGroupCommands(program: Command): void {
  // groups command
  program
    .command('groups')
    .description('List Gerrit groups')
    .option('--pattern <regex>', 'Filter groups by name pattern')
    .option('--owned', 'Show only groups owned by you')
    .option('--project <name>', 'Show groups for specific project')
    .option('--user <account>', 'Show groups a user belongs to')
    .option('--limit <n>', 'Maximum number of results (default: 25)')
    .option('--xml', 'XML output for LLM consumption')
    .action(async (options) => {
      await executeEffect(
        groupsCommand(options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'groups_result',
      )
    })

  // groups-show command
  program
    .command('groups-show <group-id>')
    .description('Show detailed information about a Gerrit group')
    .option('--xml', 'XML output for LLM consumption')
    .action(async (groupId, options) => {
      await executeEffect(
        groupsShowCommand(groupId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'group_detail_result',
      )
    })

  // groups-members command
  program
    .command('groups-members <group-id>')
    .description('List all members of a Gerrit group')
    .option('--xml', 'XML output for LLM consumption')
    .action(async (groupId, options) => {
      await executeEffect(
        groupsMembersCommand(groupId, options).pipe(
          Effect.provide(GerritApiServiceLive),
          Effect.provide(ConfigServiceLive),
        ),
        options,
        'group_members_result',
      )
    })
}
