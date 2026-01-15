import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { sanitizeCDATA } from '@/utils/shell-safety'

interface GroupsOptions {
  pattern?: string
  owned?: boolean
  project?: string
  user?: string
  limit?: string
  xml?: boolean
}

/**
 * Lists Gerrit groups with optional filtering.
 *
 * @param options - Configuration options
 * @param options.pattern - Optional regex pattern to filter groups by name
 * @param options.owned - Show only groups owned by the current user
 * @param options.project - Show groups with permissions on specific project
 * @param options.user - Show groups a specific user belongs to
 * @param options.limit - Maximum number of results (default: 25)
 * @param options.xml - Whether to output in XML format for LLM consumption
 * @returns Effect that completes when groups are listed
 */
export const groupsCommand = (
  options: GroupsOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Parse limit option
    const limit = options.limit ? Number.parseInt(options.limit, 10) : 25

    // Fetch groups
    const groups = yield* gerritApi
      .listGroups({
        pattern: options.pattern,
        owned: options.owned,
        project: options.project,
        user: options.user,
        limit: Number.isNaN(limit) || limit < 1 ? 25 : limit,
      })
      .pipe(
        Effect.catchTag('ApiError', (error) =>
          Effect.gen(function* () {
            if (options.xml) {
              console.log('<?xml version="1.0" encoding="UTF-8"?>')
              console.log('<groups_result>')
              console.log('  <status>error</status>')
              console.log(`  <error><![CDATA[${sanitizeCDATA(error.message)}]]></error>`)
              console.log('</groups_result>')
            } else {
              if (error.status === 403) {
                console.error('✗ Permission denied to list groups')
              } else {
                console.error(`✗ Failed to list groups: ${error.message}`)
              }
            }
            return yield* Effect.fail(error)
          }),
        ),
      )

    // Handle empty results
    if (groups.length === 0) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<groups_result>`)
        console.log(`  <status>success</status>`)
        console.log(`  <count>0</count>`)
        console.log(`  <groups />`)
        console.log(`</groups_result>`)
      } else {
        console.log('No groups found')
      }
      return
    }

    // Output results
    if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<groups_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <count>${groups.length}</count>`)
      console.log(`  <groups>`)
      for (const group of groups) {
        console.log(`    <group>`)
        console.log(`      <id><![CDATA[${sanitizeCDATA(group.id)}]]></id>`)
        if (group.name) {
          console.log(`      <name><![CDATA[${sanitizeCDATA(group.name)}]]></name>`)
        }
        if (group.description) {
          console.log(
            `      <description><![CDATA[${sanitizeCDATA(group.description)}]]></description>`,
          )
        }
        if (group.owner) {
          console.log(`      <owner><![CDATA[${sanitizeCDATA(group.owner)}]]></owner>`)
        }
        if (group.owner_id) {
          console.log(`      <owner_id><![CDATA[${sanitizeCDATA(group.owner_id)}]]></owner_id>`)
        }
        if (group.group_id !== undefined) {
          console.log(`      <group_id>${group.group_id}</group_id>`)
        }
        if (group.options?.visible_to_all !== undefined) {
          console.log(`      <visible_to_all>${group.options.visible_to_all}</visible_to_all>`)
        }
        if (group.created_on) {
          console.log(
            `      <created_on><![CDATA[${sanitizeCDATA(group.created_on)}]]></created_on>`,
          )
        }
        if (group.url) {
          console.log(`      <url><![CDATA[${sanitizeCDATA(group.url)}]]></url>`)
        }
        console.log(`    </group>`)
      }
      console.log(`  </groups>`)
      console.log(`</groups_result>`)
    } else {
      // Plain text output - more detailed than projects
      console.log(`Available groups (${groups.length}):\n`)
      for (const group of groups) {
        const name = group.name || group.id
        console.log(name)
        if (group.description) {
          console.log(`  Description: ${group.description}`)
        }
        if (group.owner) {
          console.log(`  Owner: ${group.owner}`)
        }
        console.log('')
      }
    }
  })
