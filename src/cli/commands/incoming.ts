import { Effect } from 'effect'
import { select } from '@inquirer/prompts'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { type ConfigError, ConfigService } from '@/services/config'
import { colors } from '@/utils/formatters'
import { getStatusIndicators } from '@/utils/status-indicators'
import type { ChangeInfo } from '@/schemas/gerrit'
import { sanitizeUrlSync, getOpenCommand } from '@/utils/shell-safety'

const execAsync = promisify(exec)

interface IncomingOptions {
  xml?: boolean
  json?: boolean
  interactive?: boolean
}

// Group changes by project for better organization
const groupChangesByProject = (changes: readonly ChangeInfo[]) => {
  const grouped = new Map<string, ChangeInfo[]>()

  for (const change of changes) {
    const project = change.project
    if (!grouped.has(project)) {
      grouped.set(project, [])
    }
    grouped.get(project)!.push(change)
  }

  // Sort projects alphabetically and changes by updated date
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, projectChanges]) => ({
      project,
      changes: projectChanges.sort((a, b) => {
        const dateA = a.updated ? new Date(a.updated).getTime() : 0
        const dateB = b.updated ? new Date(b.updated).getTime() : 0
        return dateB - dateA
      }),
    }))
}

// Format change for display in inquirer
const formatChangeChoice = (change: ChangeInfo) => {
  const indicators = getStatusIndicators(change)
  const statusPart = indicators ? `${indicators} ` : ''
  const subject =
    change.subject.length > 60 ? `${change.subject.substring(0, 57)}...` : change.subject

  return {
    name: `${statusPart}${subject} (${change._number})`,
    value: change,
    description: `By ${change.owner?.name || 'Unknown'} • ${change.status}`,
  }
}

// Open change in browser
const openInBrowser = async (gerritHost: string, changeNumber: number) => {
  const url = `${gerritHost}/c/${changeNumber}`
  const sanitizedUrl = sanitizeUrlSync(url)

  if (!sanitizedUrl) {
    console.error(`${colors.red}✗ Invalid URL: ${url}${colors.reset}`)
    return
  }

  const openCmd = getOpenCommand()
  try {
    await execAsync(`${openCmd} "${sanitizedUrl}"`)
    console.log(`${colors.green}✓ Opened ${changeNumber} in browser${colors.reset}`)
  } catch (error) {
    console.error(`${colors.red}✗ Failed to open browser: ${error}${colors.reset}`)
  }
}

export const incomingCommand = (
  options: IncomingOptions,
): Effect.Effect<void, ApiError | ConfigError, GerritApiService | ConfigService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Query for changes where user is a reviewer but not the owner
    const changes = yield* gerritApi.listChanges(
      'is:open -owner:self -is:wip -is:ignored reviewer:self',
    )

    if (options.interactive) {
      if (changes.length === 0) {
        console.log(`${colors.yellow}No incoming reviews found${colors.reset}`)
        return
      }

      // Get Gerrit host for opening changes in browser
      const configService = yield* ConfigService
      const credentials = yield* configService.getCredentials

      // Group changes by project
      const groupedChanges = groupChangesByProject(changes)

      // Create choices for inquirer with project sections
      const choices: Array<{ name: string; value: ChangeInfo | string }> = []

      for (const { project, changes: projectChanges } of groupedChanges) {
        // Add project header as separator
        choices.push({
          name: `\n${colors.blue}━━━ ${project} ━━━${colors.reset}`,
          value: 'separator',
        })

        // Add changes for this project
        for (const change of projectChanges) {
          const formatted = formatChangeChoice(change)
          choices.push({
            name: formatted.name,
            value: change,
          })
        }
      }

      // Add exit option
      choices.push({
        name: `\n${colors.gray}Exit${colors.reset}`,
        value: 'exit',
      })

      // Interactive selection loop
      let continueSelecting = true
      while (continueSelecting) {
        const selected = yield* Effect.promise(async () => {
          return await select({
            message: 'Select a change to open in browser:',
            choices: choices.filter((c) => c.value !== 'separator'),
            pageSize: 15,
          })
        })

        if (selected === 'exit' || !selected) {
          continueSelecting = false
        } else if (typeof selected !== 'string') {
          // Open the selected change
          yield* Effect.promise(() => openInBrowser(credentials.host, selected._number))

          // Ask if user wants to continue
          const continueChoice = yield* Effect.promise(async () => {
            return await select({
              message: 'Continue?',
              choices: [
                { name: 'Select another change', value: 'continue' },
                { name: 'Exit', value: 'exit' },
              ],
            })
          })

          if (continueChoice === 'exit') {
            continueSelecting = false
          }
        }
      }

      return
    }

    if (options.json) {
      // JSON output
      const groupedChanges = groupChangesByProject(changes)
      const jsonOutput = {
        status: 'success',
        count: changes.length,
        changes: groupedChanges.flatMap(({ project, changes: projectChanges }) =>
          projectChanges.map((change) => ({
            number: change._number,
            subject: change.subject,
            status: change.status,
            project,
            owner: change.owner?.name ?? 'Unknown',
            ...(change.owner?.email ? { owner_email: change.owner.email } : {}),
            ...(change.updated ? { updated: change.updated } : {}),
          })),
        ),
      }
      console.log(JSON.stringify(jsonOutput, null, 2))
    } else if (options.xml) {
      // XML output
      const xmlOutput = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<incoming_reviews>',
        `  <count>${changes.length}</count>`,
      ]

      if (changes.length > 0) {
        xmlOutput.push('  <changes>')

        // Group by project for XML output too
        const groupedChanges = groupChangesByProject(changes)

        for (const { project, changes: projectChanges } of groupedChanges) {
          xmlOutput.push(`    <project name="${project}">`)
          for (const change of projectChanges) {
            xmlOutput.push('      <change>')
            xmlOutput.push(`        <number>${change._number}</number>`)
            xmlOutput.push(`        <subject><![CDATA[${change.subject}]]></subject>`)
            xmlOutput.push(`        <status>${change.status}</status>`)
            xmlOutput.push(`        <owner>${change.owner?.name || 'Unknown'}</owner>`)
            xmlOutput.push(`        <updated>${change.updated}</updated>`)
            xmlOutput.push('      </change>')
          }
          xmlOutput.push('    </project>')
        }

        xmlOutput.push('  </changes>')
      }

      xmlOutput.push('</incoming_reviews>')
      console.log(xmlOutput.join('\n'))
    } else {
      // Pretty output (default)
      if (changes.length === 0) {
        console.log(`${colors.green}✓ No incoming reviews${colors.reset}`)
        return
      }

      console.log(`${colors.blue}Incoming Reviews (${changes.length})${colors.reset}\n`)

      // Group by project for display
      const groupedChanges = groupChangesByProject(changes)

      for (const { project, changes: projectChanges } of groupedChanges) {
        console.log(`${colors.gray}${project}${colors.reset}`)

        for (const change of projectChanges) {
          const indicators = getStatusIndicators(change)
          const statusPart = indicators ? `${indicators} ` : ''

          console.log(
            `  ${statusPart}${colors.yellow}#${change._number}${colors.reset} ${change.subject}`,
          )
          console.log(
            `    ${colors.gray}by ${change.owner?.name || 'Unknown'} • ${change.status}${colors.reset}`,
          )
        }
        console.log() // Empty line between projects
      }
    }
  })
