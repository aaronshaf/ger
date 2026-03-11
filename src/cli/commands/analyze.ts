import { Console, Effect } from 'effect'
import chalk from 'chalk'
import type { ChangeInfo } from '@/schemas/gerrit'
import { ConfigService, type ConfigError, type ConfigServiceImpl } from '@/services/config'
import { GerritApiService, type ApiError, type GerritApiServiceImpl } from '@/api/gerrit'
import { writeFileSync } from 'node:fs'
import { escapeXML } from '@/utils/shell-safety'

export interface AnalyzeOptions {
  startDate?: string
  endDate?: string
  repo?: string
  json?: boolean
  xml?: boolean
  markdown?: boolean
  csv?: boolean
  output?: string
}

export type AnalyzeErrors = ConfigError | ApiError | Error

interface RepoStats {
  name: string
  count: number
}

interface AuthorStats {
  name: string
  email: string
  count: number
}

interface MonthStats {
  month: string
  count: number
}

interface AnalyticsResult {
  totalMerged: number
  dateRange: { start: string; end: string }
  byRepo: readonly RepoStats[]
  byAuthor: readonly AuthorStats[]
  timeline: readonly MonthStats[]
}

const getDefaultStartDate = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-01-01`
}

const getDefaultEndDate = (): string => new Date().toISOString().slice(0, 10)

const getChangeMonth = (change: ChangeInfo): string => {
  const dateStr = change.submitted ?? change.updated ?? change.created ?? ''
  return dateStr.slice(0, 7) // YYYY-MM
}

const aggregateByRepo = (changes: readonly ChangeInfo[]): readonly RepoStats[] => {
  const counts = new Map<string, number>()
  for (const c of changes) {
    counts.set(c.project, (counts.get(c.project) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

const aggregateByAuthor = (changes: readonly ChangeInfo[]): readonly AuthorStats[] => {
  const counts = new Map<string, { name: string; email: string; count: number }>()
  for (const c of changes) {
    const owner = c.owner
    if (!owner) continue
    const key = owner.email ?? owner.name ?? String(owner._account_id)
    const existing = counts.get(key)
    if (existing) {
      existing.count++
    } else {
      counts.set(key, {
        name: owner.name ?? 'Unknown',
        email: owner.email ?? '',
        count: 1,
      })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}

const aggregateByMonth = (changes: readonly ChangeInfo[]): readonly MonthStats[] => {
  const counts = new Map<string, number>()
  for (const c of changes) {
    const month = getChangeMonth(c)
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

const BAR_WIDTH = 30

const renderBar = (count: number, max: number): string => {
  const filled = max > 0 ? Math.round((count / max) * BAR_WIDTH) : 0
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

const renderTerminal = (result: AnalyticsResult): string => {
  const lines: string[] = []

  lines.push('')
  lines.push(chalk.bold.cyan('  Contribution Analytics'))
  lines.push(chalk.dim(`  ${result.dateRange.start}  →  ${result.dateRange.end}`))
  lines.push('')
  lines.push(chalk.bold(`  Total merged: ${chalk.green(String(result.totalMerged))}`))
  lines.push('')

  // By Repo
  lines.push(chalk.bold.yellow('  ── Changes by Repository ──'))
  lines.push('')
  const maxRepo = result.byRepo[0]?.count ?? 1
  for (const r of result.byRepo.slice(0, 15)) {
    const bar = renderBar(r.count, maxRepo)
    const name = r.name.length > 35 ? `...${r.name.slice(-32)}` : r.name
    lines.push(
      `  ${chalk.cyan(name.padEnd(35))}  ${chalk.green(bar)}  ${chalk.bold(String(r.count))}`,
    )
  }
  lines.push('')

  // By Author
  lines.push(chalk.bold.yellow('  ── Changes by Author ──'))
  lines.push('')
  const maxAuthor = result.byAuthor[0]?.count ?? 1
  for (const a of result.byAuthor.slice(0, 10)) {
    const bar = renderBar(a.count, maxAuthor)
    const label = a.name.length > 25 ? `${a.name.slice(0, 22)}...` : a.name
    lines.push(
      `  ${chalk.magenta(label.padEnd(25))}  ${chalk.green(bar)}  ${chalk.bold(String(a.count))}`,
    )
  }
  lines.push('')

  // Timeline
  lines.push(chalk.bold.yellow('  ── Timeline ──'))
  lines.push('')
  const maxMonth = Math.max(...result.timeline.map((m) => m.count), 1)
  for (const m of result.timeline) {
    const bar = renderBar(m.count, maxMonth)
    lines.push(`  ${chalk.blue(m.month)}  ${chalk.green(bar)}  ${chalk.bold(String(m.count))}`)
  }
  lines.push('')

  return lines.join('\n')
}

const renderMarkdown = (result: AnalyticsResult): string => {
  const lines: string[] = []
  lines.push(`# Contribution Analytics`)
  lines.push(``)
  lines.push(`**Date range:** ${result.dateRange.start} → ${result.dateRange.end}`)
  lines.push(`**Total merged:** ${result.totalMerged}`)
  lines.push(``)

  lines.push(`## Changes by Repository`)
  lines.push(``)
  lines.push(`| Repository | Count |`)
  lines.push(`|---|---|`)
  for (const r of result.byRepo) lines.push(`| ${r.name} | ${r.count} |`)
  lines.push(``)

  lines.push(`## Changes by Author`)
  lines.push(``)
  lines.push(`| Author | Email | Count |`)
  lines.push(`|---|---|---|`)
  for (const a of result.byAuthor) lines.push(`| ${a.name} | ${a.email} | ${a.count} |`)
  lines.push(``)

  lines.push(`## Timeline`)
  lines.push(``)
  lines.push(`| Month | Count |`)
  lines.push(`|---|---|`)
  for (const m of result.timeline) lines.push(`| ${m.month} | ${m.count} |`)
  lines.push(``)

  return lines.join('\n')
}

const csvField = (v: string): string => `"${v.replace(/"/g, '""')}"`

const renderCsv = (result: AnalyticsResult): string => {
  const lines: string[] = []
  lines.push('section,key,count')
  for (const r of result.byRepo) lines.push(`repo,${csvField(r.name)},${r.count}`)
  for (const a of result.byAuthor)
    lines.push(`author,${csvField(`${a.name} <${a.email}>`)},${a.count}`)
  for (const m of result.timeline) lines.push(`timeline,${csvField(m.month)},${m.count}`)
  return lines.join('\n')
}

const renderXml = (result: AnalyticsResult): string => {
  const lines: string[] = []
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(`<analytics>`)
  lines.push(`  <total_merged>${result.totalMerged}</total_merged>`)
  lines.push(`  <date_range start="${result.dateRange.start}" end="${result.dateRange.end}"/>`)

  lines.push(`  <by_repo>`)
  for (const r of result.byRepo) {
    lines.push(`    <repo name="${escapeXML(r.name)}" count="${r.count}"/>`)
  }
  lines.push(`  </by_repo>`)

  lines.push(`  <by_author>`)
  for (const a of result.byAuthor) {
    const escaped = a.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    lines.push(`    <author name="${escaped}" email="${a.email}" count="${a.count}"/>`)
  }
  lines.push(`  </by_author>`)

  lines.push(`  <timeline>`)
  for (const m of result.timeline) {
    lines.push(`    <month value="${m.month}" count="${m.count}"/>`)
  }
  lines.push(`  </timeline>`)

  lines.push(`</analytics>`)
  return lines.join('\n')
}

export const analyzeCommand = (
  options: AnalyzeOptions,
): Effect.Effect<void, AnalyzeErrors, ConfigServiceImpl | GerritApiServiceImpl> =>
  Effect.gen(function* () {
    const startDate = options.startDate ?? getDefaultStartDate()
    const endDate = options.endDate ?? getDefaultEndDate()

    const _configService = yield* ConfigService
    const apiService = yield* GerritApiService

    const isMachineReadable =
      options.json || options.xml || options.markdown || options.csv || options.output
    if (!isMachineReadable) {
      yield* Console.log(chalk.dim(`Fetching merged changes from ${startDate} to ${endDate}...`))
    }

    const changes = yield* apiService.fetchMergedChanges({
      after: startDate,
      before: endDate,
      repo: options.repo,
    })

    const result: AnalyticsResult = {
      totalMerged: changes.length,
      dateRange: { start: startDate, end: endDate },
      byRepo: aggregateByRepo(changes),
      byAuthor: aggregateByAuthor(changes),
      timeline: aggregateByMonth(changes),
    }

    let output: string

    if (options.json) {
      output = JSON.stringify(result, null, 2)
    } else if (options.xml) {
      output = renderXml(result)
    } else if (options.markdown) {
      output = renderMarkdown(result)
    } else if (options.csv) {
      output = renderCsv(result)
    } else {
      output = renderTerminal(result)
    }

    if (options.output) {
      const outputPath = options.output
      yield* Effect.try({
        try: () => writeFileSync(outputPath, output, 'utf8'),
        catch: (e) =>
          new Error(`Failed to write output file: ${e instanceof Error ? e.message : String(e)}`),
      })
      yield* Console.log(chalk.green(`✓ Output written to ${options.output}`))
    } else {
      yield* Console.log(output)
    }
  })
