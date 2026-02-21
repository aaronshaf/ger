import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { ChangeInfo } from '@/schemas/gerrit'
import { colors, formatDate } from '@/utils/formatters'
import { escapeXML, sanitizeCDATA } from '@/utils/shell-safety'
import { getStatusIndicators } from '@/utils/status-indicators'

export const SEARCH_HELP_TEXT = `
Examples:
  # Search for all open changes (default)
  $ ger search

  # Search for your open changes
  $ ger search "owner:self status:open"

  # Search for changes by a specific user
  $ ger search "owner:john@example.com"

  # Search by project
  $ ger search "project:my-project status:open"

  # Search with date filters
  $ ger search "owner:self after:2025-01-01"
  $ ger search "status:merged age:7d"

  # Combine filters
  $ ger search "owner:self status:merged before:2025-06-01"

  # Limit results
  $ ger search "project:my-project" -n 10

Common query operators:
  owner:USER        Changes owned by USER (use 'self' for yourself)
  status:STATE      open, merged, abandoned, closed
  project:NAME      Changes in a specific project
  branch:NAME       Changes targeting a branch
  age:TIME          Time since last update (e.g., 1d, 2w, 1mon)
  before:DATE       Changes modified before date (YYYY-MM-DD)
  after:DATE        Changes modified after date (YYYY-MM-DD)
  is:wip            Work-in-progress changes
  is:submittable    Changes ready to submit
  reviewer:USER     Changes where USER is a reviewer
  label:NAME=VALUE  Filter by label (e.g., label:Code-Review+2)

Full query syntax: https://gerrit-review.googlesource.com/Documentation/user-search.html`

interface SearchOptions {
  xml?: boolean
  json?: boolean
  limit?: string
}

// Group changes by project for better organization
const groupChangesByProject = (changes: readonly ChangeInfo[]) => {
  const grouped = new Map<string, ChangeInfo[]>()

  for (const change of changes) {
    const project = change.project
    const existing = grouped.get(project) ?? []
    existing.push(change)
    grouped.set(project, existing)
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

export const searchCommand = (
  query: string | undefined,
  options: SearchOptions,
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Build the final query with limit if specified
    let finalQuery = query || 'is:open'
    const parsedLimit = options.limit ? parseInt(options.limit, 10) : 25
    const limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 25 : parsedLimit
    if (!finalQuery.includes('limit:')) {
      finalQuery = `${finalQuery} limit:${limit}`
    }

    const changes = yield* gerritApi.listChanges(finalQuery)

    // Group changes by project (used by both output formats)
    const groupedChanges = changes.length > 0 ? groupChangesByProject(changes) : []

    if (options.json) {
      // JSON output
      const jsonOutput = {
        status: 'success',
        query: finalQuery,
        count: changes.length,
        changes: groupedChanges.flatMap(({ project, changes: projectChanges }) =>
          projectChanges.map((change) => ({
            number: change._number,
            id: change.id,
            change_id: change.change_id,
            subject: change.subject,
            status: change.status,
            project,
            branch: change.branch,
            owner: change.owner?.name ?? 'Unknown',
            ...(change.owner?._account_id !== undefined
              ? { owner_account_id: change.owner._account_id }
              : {}),
            ...(change.owner?.email ? { owner_email: change.owner.email } : {}),
            ...(change.owner?.username ? { owner_username: change.owner.username } : {}),
            ...(change.created ? { created: change.created } : {}),
            ...(change.updated ? { updated: change.updated } : {}),
            ...(change.insertions !== undefined ? { insertions: change.insertions } : {}),
            ...(change.deletions !== undefined ? { deletions: change.deletions } : {}),
            ...(change.current_revision ? { current_revision: change.current_revision } : {}),
            ...(change.submittable !== undefined ? { submittable: change.submittable } : {}),
            ...(change.work_in_progress !== undefined
              ? { work_in_progress: change.work_in_progress }
              : {}),
            ...(change.topic ? { topic: change.topic } : {}),
            ...(change.labels && Object.keys(change.labels).length > 0
              ? { labels: change.labels }
              : {}),
            ...(change.reviewers?.REVIEWER && change.reviewers.REVIEWER.length > 0
              ? {
                  reviewers: change.reviewers.REVIEWER.map((r) => ({
                    ...(r._account_id !== undefined ? { account_id: r._account_id } : {}),
                    ...(r.name ? { name: r.name } : {}),
                    ...(r.email ? { email: r.email } : {}),
                    ...(r.username ? { username: r.username } : {}),
                  })),
                }
              : {}),
            ...(change.reviewers?.CC && change.reviewers.CC.length > 0
              ? {
                  cc: change.reviewers.CC.map((r) => ({
                    ...(r._account_id !== undefined ? { account_id: r._account_id } : {}),
                    ...(r.name ? { name: r.name } : {}),
                    ...(r.email ? { email: r.email } : {}),
                    ...(r.username ? { username: r.username } : {}),
                  })),
                }
              : {}),
          })),
        ),
      }
      console.log(JSON.stringify(jsonOutput, null, 2))
    } else if (options.xml) {
      // XML output
      const xmlOutput = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<search_results>',
        `  <query><![CDATA[${sanitizeCDATA(finalQuery)}]]></query>`,
        `  <count>${changes.length}</count>`,
      ]

      if (changes.length > 0) {
        xmlOutput.push('  <changes>')

        for (const { project, changes: projectChanges } of groupedChanges) {
          xmlOutput.push(`    <project name="${escapeXML(project)}">`)
          for (const change of projectChanges) {
            xmlOutput.push('      <change>')
            xmlOutput.push(`        <number>${change._number}</number>`)
            xmlOutput.push(
              `        <subject><![CDATA[${sanitizeCDATA(change.subject)}]]></subject>`,
            )
            xmlOutput.push(`        <status>${escapeXML(change.status)}</status>`)
            xmlOutput.push(`        <owner>${escapeXML(change.owner?.name ?? 'Unknown')}</owner>`)
            xmlOutput.push(`        <branch>${escapeXML(change.branch)}</branch>`)
            if (change.updated && change.updated.trim() !== '') {
              xmlOutput.push(`        <updated>${escapeXML(change.updated)}</updated>`)
            }
            if (change.owner?.email) {
              xmlOutput.push(`        <owner_email>${escapeXML(change.owner.email)}</owner_email>`)
            }
            xmlOutput.push('      </change>')
          }
          xmlOutput.push('    </project>')
        }

        xmlOutput.push('  </changes>')
      }

      xmlOutput.push('</search_results>')
      console.log(xmlOutput.join('\n'))
    } else {
      // Pretty output (default)
      if (changes.length === 0) {
        console.log(`${colors.yellow}No changes found${colors.reset}`)
        return
      }

      console.log(`${colors.blue}Search results (${changes.length})${colors.reset}\n`)

      for (const { project, changes: projectChanges } of groupedChanges) {
        console.log(`${colors.gray}${project}${colors.reset}`)

        for (const change of projectChanges) {
          const indicators = getStatusIndicators(change)
          const statusPart = indicators.length > 0 ? `${indicators.join(' ')} ` : ''
          const dateStr = change.updated ? ` • ${formatDate(change.updated)}` : ''

          console.log(
            `  ${statusPart}${colors.yellow}#${change._number}${colors.reset} ${change.subject}`,
          )
          console.log(
            `    ${colors.gray}by ${change.owner?.name ?? 'Unknown'} • ${change.status}${dateStr}${colors.reset}`,
          )
        }
        console.log() // Empty line between projects
      }
    }
  })
