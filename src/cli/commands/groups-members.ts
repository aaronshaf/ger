import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { sanitizeCDATA } from '@/utils/shell-safety'

interface GroupsMembersOptions {
  xml?: boolean
  json?: boolean
}

/**
 * Lists all members of a Gerrit group.
 *
 * @param groupId - The group ID (numeric), UUID, or group name
 * @param options - Configuration options
 * @param options.xml - Whether to output in XML format for LLM consumption
 * @returns Effect that completes when members are listed
 */
export const groupsMembersCommand = (
  groupId: string,
  options: GroupsMembersOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Fetch group members
    const members = yield* gerritApi.getGroupMembers(groupId).pipe(
      Effect.catchTag('ApiError', (error) =>
        Effect.gen(function* () {
          if (options.json) {
            console.log(JSON.stringify({ status: 'error', error: error.message }, null, 2))
          } else if (options.xml) {
            console.log('<?xml version="1.0" encoding="UTF-8"?>')
            console.log('<group_members_result>')
            console.log('  <status>error</status>')
            console.log(`  <error><![CDATA[${sanitizeCDATA(error.message)}]]></error>`)
            console.log('</group_members_result>')
          } else {
            if (error.status === 404) {
              console.error(`✗ Group "${groupId}" not found`)
            } else if (error.status === 403) {
              console.error(`✗ Permission denied to view members of group "${groupId}"`)
            } else {
              console.error(`✗ Failed to get group members: ${error.message}`)
            }
          }
          return yield* Effect.fail(error)
        }),
      ),
    )

    // Handle empty results
    if (members.length === 0) {
      if (options.json) {
        console.log(
          JSON.stringify({ status: 'success', group_id: groupId, count: 0, members: [] }, null, 2),
        )
      } else if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<group_members_result>`)
        console.log(`  <status>success</status>`)
        console.log(`  <group_id><![CDATA[${sanitizeCDATA(groupId)}]]></group_id>`)
        console.log(`  <count>0</count>`)
        console.log(`  <members />`)
        console.log(`</group_members_result>`)
      } else {
        console.log(`Group "${groupId}" has no members`)
      }
      return
    }

    // Output results
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            group_id: groupId,
            count: members.length,
            members: members.map((member) => ({
              account_id: member._account_id,
              ...(member.name ? { name: member.name } : {}),
              ...(member.email ? { email: member.email } : {}),
              ...(member.username ? { username: member.username } : {}),
            })),
          },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<group_members_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <group_id><![CDATA[${sanitizeCDATA(groupId)}]]></group_id>`)
      console.log(`  <count>${members.length}</count>`)
      console.log(`  <members>`)
      for (const member of members) {
        console.log(`    <member>`)
        console.log(`      <account_id>${member._account_id}</account_id>`)
        if (member.name) {
          console.log(`      <name><![CDATA[${sanitizeCDATA(member.name)}]]></name>`)
        }
        if (member.email) {
          console.log(`      <email><![CDATA[${sanitizeCDATA(member.email)}]]></email>`)
        }
        if (member.username) {
          console.log(`      <username><![CDATA[${sanitizeCDATA(member.username)}]]></username>`)
        }
        console.log(`    </member>`)
      }
      console.log(`  </members>`)
      console.log(`</group_members_result>`)
    } else {
      // Plain text output
      console.log(`Members of "${groupId}" (${members.length}):\n`)
      for (const member of members) {
        const name = member.name || member.username || `Account ${member._account_id}`
        console.log(name)
        if (member.email) {
          console.log(`  Email: ${member.email}`)
        }
        if (member.username && member.username !== member.name) {
          console.log(`  Username: ${member.username}`)
        }
        console.log(`  Account ID: ${member._account_id}`)
        console.log('')
      }
    }
  })
