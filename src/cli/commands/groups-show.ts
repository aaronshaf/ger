import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { sanitizeCDATA } from '@/utils/shell-safety'

interface GroupsShowOptions {
  xml?: boolean
  json?: boolean
}

/**
 * Shows detailed information about a specific Gerrit group.
 *
 * @param groupId - The group ID (numeric), UUID, or group name
 * @param options - Configuration options
 * @param options.xml - Whether to output in XML format for LLM consumption
 * @returns Effect that completes when group details are displayed
 */
export const groupsShowCommand = (
  groupId: string,
  options: GroupsShowOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Fetch group details (includes members and subgroups)
    const group = yield* gerritApi.getGroupDetail(groupId).pipe(
      Effect.catchTag('ApiError', (error) =>
        Effect.gen(function* () {
          if (options.json) {
            console.log(JSON.stringify({ status: 'error', error: error.message }, null, 2))
          } else if (options.xml) {
            console.log('<?xml version="1.0" encoding="UTF-8"?>')
            console.log('<group_detail_result>')
            console.log('  <status>error</status>')
            console.log(`  <error><![CDATA[${sanitizeCDATA(error.message)}]]></error>`)
            console.log('</group_detail_result>')
          } else {
            if (error.status === 404) {
              console.error(`✗ Group "${groupId}" not found`)
            } else if (error.status === 403) {
              console.error(`✗ Permission denied to view group "${groupId}"`)
            } else {
              console.error(`✗ Failed to get group details: ${error.message}`)
            }
          }
          return yield* Effect.fail(error)
        }),
      ),
    )

    // Output results
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            group: {
              id: group.id,
              ...(group.name ? { name: group.name } : {}),
              ...(group.description ? { description: group.description } : {}),
              ...(group.owner ? { owner: group.owner } : {}),
              ...(group.owner_id ? { owner_id: group.owner_id } : {}),
              ...(group.group_id !== undefined ? { group_id: group.group_id } : {}),
              ...(group.options?.visible_to_all !== undefined
                ? { visible_to_all: group.options.visible_to_all }
                : {}),
              ...(group.created_on ? { created_on: group.created_on } : {}),
              ...(group.url ? { url: group.url } : {}),
              members: (group.members ?? []).map((member) => ({
                account_id: member._account_id,
                ...(member.name ? { name: member.name } : {}),
                ...(member.email ? { email: member.email } : {}),
                ...(member.username ? { username: member.username } : {}),
              })),
              subgroups: (group.includes ?? []).map((subgroup) => ({
                id: subgroup.id,
                ...(subgroup.name ? { name: subgroup.name } : {}),
              })),
            },
          },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<group_detail_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <group>`)
      console.log(`    <id><![CDATA[${sanitizeCDATA(group.id)}]]></id>`)
      if (group.name) {
        console.log(`    <name><![CDATA[${sanitizeCDATA(group.name)}]]></name>`)
      }
      if (group.description) {
        console.log(
          `    <description><![CDATA[${sanitizeCDATA(group.description)}]]></description>`,
        )
      }
      if (group.owner) {
        console.log(`    <owner><![CDATA[${sanitizeCDATA(group.owner)}]]></owner>`)
      }
      if (group.owner_id) {
        console.log(`    <owner_id><![CDATA[${sanitizeCDATA(group.owner_id)}]]></owner_id>`)
      }
      if (group.group_id !== undefined) {
        console.log(`    <group_id>${group.group_id}</group_id>`)
      }
      if (group.options?.visible_to_all !== undefined) {
        console.log(`    <visible_to_all>${group.options.visible_to_all}</visible_to_all>`)
      }
      if (group.created_on) {
        console.log(`    <created_on><![CDATA[${sanitizeCDATA(group.created_on)}]]></created_on>`)
      }
      if (group.url) {
        console.log(`    <url><![CDATA[${sanitizeCDATA(group.url)}]]></url>`)
      }

      // Members
      if (group.members && group.members.length > 0) {
        console.log(`    <members>`)
        for (const member of group.members) {
          console.log(`      <member>`)
          console.log(`        <account_id>${member._account_id}</account_id>`)
          if (member.name) {
            console.log(`        <name><![CDATA[${sanitizeCDATA(member.name)}]]></name>`)
          }
          if (member.email) {
            console.log(`        <email><![CDATA[${sanitizeCDATA(member.email)}]]></email>`)
          }
          if (member.username) {
            console.log(
              `        <username><![CDATA[${sanitizeCDATA(member.username)}]]></username>`,
            )
          }
          console.log(`      </member>`)
        }
        console.log(`    </members>`)
      }

      // Subgroups
      if (group.includes && group.includes.length > 0) {
        console.log(`    <subgroups>`)
        for (const subgroup of group.includes) {
          console.log(`      <subgroup>`)
          console.log(`        <id><![CDATA[${sanitizeCDATA(subgroup.id)}]]></id>`)
          if (subgroup.name) {
            console.log(`        <name><![CDATA[${sanitizeCDATA(subgroup.name)}]]></name>`)
          }
          console.log(`      </subgroup>`)
        }
        console.log(`    </subgroups>`)
      }

      console.log(`  </group>`)
      console.log(`</group_detail_result>`)
    } else {
      // Plain text output
      const name = group.name || group.id
      console.log(`Group: ${name}`)
      console.log(`ID: ${group.id}`)
      if (group.group_id !== undefined) {
        console.log(`Numeric ID: ${group.group_id}`)
      }
      if (group.owner) {
        console.log(`Owner: ${group.owner}`)
      }
      if (group.description) {
        console.log(`Description: ${group.description}`)
      }
      if (group.options?.visible_to_all !== undefined) {
        console.log(`Visible to all: ${group.options.visible_to_all ? 'Yes' : 'No'}`)
      }
      if (group.created_on) {
        console.log(`Created: ${group.created_on}`)
      }

      // Members
      if (group.members && group.members.length > 0) {
        console.log(`\nMembers (${group.members.length}):`)
        for (const member of group.members) {
          const memberName = member.name || member.username || `Account ${member._account_id}`
          console.log(`  • ${memberName}`)
          if (member.email) {
            console.log(`    Email: ${member.email}`)
          }
          if (member.username && member.username !== memberName) {
            console.log(`    Username: ${member.username}`)
          }
        }
      } else {
        console.log(`\nMembers: None`)
      }

      // Subgroups
      if (group.includes && group.includes.length > 0) {
        console.log(`\nSubgroups (${group.includes.length}):`)
        for (const subgroup of group.includes) {
          const subgroupName = subgroup.name || subgroup.id
          console.log(`  • ${subgroupName}`)
        }
      } else {
        console.log(`\nSubgroups: None`)
      }
    }
  })
