import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { ChangeInfo } from '@/schemas/gerrit'
import { colors } from '@/utils/formatters'

interface MineOptions {
  xml?: boolean
  json?: boolean
}

// ANSI color codes

export const mineCommand = (
  options: MineOptions,
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    const changes = yield* gerritApi.listChanges('owner:self status:open')

    if (options.json) {
      const jsonOutput = {
        status: 'success',
        count: changes.length,
        changes: changes.map((change) => ({
          number: change._number,
          subject: change.subject,
          project: change.project,
          branch: change.branch,
          status: change.status,
          change_id: change.change_id,
          ...(change.updated ? { updated: change.updated } : {}),
          ...(change.owner?.name ? { owner: change.owner.name } : {}),
        })),
      }
      console.log(JSON.stringify(jsonOutput, null, 2))
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<changes count="${changes.length}">`)

      for (const change of changes) {
        console.log(`  <change>`)
        console.log(`    <number>${change._number}</number>`)
        console.log(`    <subject><![CDATA[${change.subject}]]></subject>`)
        console.log(`    <project>${change.project}</project>`)
        console.log(`    <branch>${change.branch}</branch>`)
        console.log(`    <status>${change.status}</status>`)
        console.log(`    <change_id>${change.change_id}</change_id>`)
        if (change.updated) {
          console.log(`    <updated>${change.updated}</updated>`)
        }
        if (change.owner?.name) {
          console.log(`    <owner>${change.owner.name}</owner>`)
        }
        console.log(`  </change>`)
      }

      console.log(`</changes>`)
    } else {
      // Pretty output by default
      if (changes.length === 0) {
        return
      }

      // Group changes by project
      const changesByProject = changes.reduce(
        (acc, change) => {
          if (!acc[change.project]) {
            acc[change.project] = []
          }
          acc[change.project] = [...acc[change.project], change]
          return acc
        },
        {} as Record<string, ChangeInfo[]>,
      )

      // Sort projects alphabetically
      const sortedProjects = Object.keys(changesByProject).sort()

      for (const [index, project] of sortedProjects.entries()) {
        if (index > 0) {
          console.log('') // Add blank line between projects
        }
        console.log(`${colors.blue}${project}${colors.reset}`)

        const projectChanges = changesByProject[project]
        for (const change of projectChanges) {
          // Build status indicators
          const indicators: string[] = []
          const indicatorChars: string[] = [] // Track visual characters for padding

          if (change.labels?.['Code-Review']) {
            const cr = change.labels['Code-Review']
            if (cr.approved || cr.value === 2) {
              indicators.push(`${colors.green}✓${colors.reset}`)
              indicatorChars.push('✓')
            } else if (cr.rejected || cr.value === -2) {
              indicators.push(`${colors.red}✗${colors.reset}`)
              indicatorChars.push('✗')
            } else if (cr.recommended || cr.value === 1) {
              indicators.push(`${colors.cyan}↑${colors.reset}`)
              indicatorChars.push('↑')
            } else if (cr.disliked || cr.value === -1) {
              indicators.push(`${colors.yellow}↓${colors.reset}`)
              indicatorChars.push('↓')
            }
          }

          // Check for Verified label as well
          if (change.labels?.['Verified']) {
            const v = change.labels.Verified
            if (v.approved || v.value === 1) {
              if (!indicatorChars.includes('✓')) {
                indicators.push(`${colors.green}✓${colors.reset}`)
                indicatorChars.push('✓')
              }
            } else if (v.rejected || v.value === -1) {
              indicators.push(`${colors.red}✗${colors.reset}`)
              indicatorChars.push('✗')
            }
          }

          // Calculate padding based on visual characters, not color codes
          const visualWidth = indicatorChars.join('  ').length
          const padding = ' '.repeat(Math.max(0, 8 - visualWidth))
          const statusStr = indicators.length > 0 ? indicators.join('  ') + padding : '        '

          console.log(`${statusStr} ${change._number}  ${change.subject}`)
        }
      }
    }
  })
