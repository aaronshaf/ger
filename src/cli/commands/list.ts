import { Effect } from 'effect'
import chalk from 'chalk'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { ChangeInfo } from '@/schemas/gerrit'
import { ConfigService, type ConfigError, type ConfigServiceImpl } from '@/services/config'

export interface ListOptions {
  status?: string
  limit?: number
  detailed?: boolean
  reviewer?: boolean
  allVerified?: boolean
  filter?: string
  json?: boolean
  xml?: boolean
}

type LabelInfo = NonNullable<ChangeInfo['labels']>[string]

// ── Label score helpers ────────────────────────────────────────────────────

const getLabelScore = (label: LabelInfo): number | null => {
  if (label.approved) return 2
  if (label.rejected) return -2
  if (label.recommended) return 1
  if (label.disliked) return -1
  if (label.value !== undefined && label.value !== 0) return label.value
  return null
}

const fmtCR = (label: LabelInfo | undefined): string => {
  if (!label) return chalk.gray('—')
  const s = getLabelScore(label)
  if (s === null || s === 0) return chalk.gray('0')
  if (s >= 2) return chalk.bold.green('+2')
  if (s === 1) return chalk.cyan('+1')
  if (s === -1) return chalk.yellow('-1')
  return chalk.bold.red('-2')
}

const fmtVerified = (label: LabelInfo | undefined): string => {
  if (!label) return chalk.gray('—')
  const s = getLabelScore(label)
  if (s === null || s === 0) return chalk.gray('—')
  if (s > 0) return chalk.green('V+')
  return chalk.red('V-')
}

const fmtLabel = (label: LabelInfo | undefined): string => {
  if (!label) return chalk.gray('—')
  const s = getLabelScore(label)
  if (s === null || s === 0) return chalk.gray('—')
  if (s > 0) return chalk.green(`+${s}`)
  return chalk.red(String(s))
}

// ── Time-ago ───────────────────────────────────────────────────────────────

const timeAgo = (dateStr: string): string => {
  const ms = Date.now() - new Date(dateStr.replace(' ', 'T').split('.')[0] + 'Z').getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 14) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 8) return `${weeks}w ago`
  return dateStr.slice(0, 10)
}

// ── Table rendering ────────────────────────────────────────────────────────

const COL_CHANGE = 8
const COL_SUBJECT_MINE = 58
const COL_SUBJECT_TEAM = 45
const COL_OWNER = 20
const COL_SCORE = 4
const COL_UPDATED = 10

const pad = (s: string, width: number): string => {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '')
  const extra = s.length - visible.length
  return s.padEnd(width + extra)
}

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s

const getOwnerLabel = (change: ChangeInfo): string =>
  change.owner?.name ?? change.owner?.email ?? String(change.owner?._account_id ?? '—')

const renderTableHeader = (showOwner: boolean): void => {
  const h = chalk.bold
  const colSubject = showOwner ? COL_SUBJECT_TEAM : COL_SUBJECT_MINE
  const ownerCol = showOwner ? `  ${h(pad('Owner', COL_OWNER))}` : ''
  console.log(
    `  ${h(pad('Change', COL_CHANGE))}  ${h(pad('Subject', colSubject))}${ownerCol}  ` +
      `${h(pad('CR', COL_SCORE))}  ${h(pad('QR', COL_SCORE))}  ` +
      `${h(pad('LR', COL_SCORE))}  ${h(pad('Verified', 8))}  ${h('Updated')}`,
  )
  const d = '─'
  const ownerDiv = showOwner ? `  ${d.repeat(COL_OWNER)}` : ''
  console.log(
    `  ${d.repeat(COL_CHANGE)}  ${d.repeat(colSubject)}${ownerDiv}  ` +
      `${d.repeat(COL_SCORE)}  ${d.repeat(COL_SCORE)}  ` +
      `${d.repeat(COL_SCORE)}  ${d.repeat(8)}  ${d.repeat(COL_UPDATED)}`,
  )
}

const renderTableRow = (change: ChangeInfo, showOwner: boolean): void => {
  const colSubject = showOwner ? COL_SUBJECT_TEAM : COL_SUBJECT_MINE
  const num = chalk.cyan(pad(String(change._number), COL_CHANGE))
  const subject = pad(truncate(change.subject, colSubject), colSubject)
  const ownerCol = showOwner
    ? `  ${pad(truncate(getOwnerLabel(change), COL_OWNER), COL_OWNER)}`
    : ''
  const cr = pad(fmtCR(change.labels?.['Code-Review']), COL_SCORE)
  const qr = pad(fmtLabel(change.labels?.['QA-Review']), COL_SCORE)
  const lr = pad(fmtLabel(change.labels?.['Lint-Review']), COL_SCORE)
  const verified = pad(fmtVerified(change.labels?.['Verified']), 8)
  const updated = timeAgo(change.updated ?? change.created ?? '')
  console.log(`  ${num}  ${subject}${ownerCol}  ${cr}  ${qr}  ${lr}  ${verified}  ${updated}`)
}

const renderDetailed = (change: ChangeInfo): void => {
  console.log(`${chalk.bold.cyan('Change:')}   ${chalk.bold(String(change._number))}`)
  console.log(`${chalk.bold.cyan('Subject:')}  ${change.subject}`)
  console.log(`${chalk.bold.cyan('Status:')}   ${change.status}`)
  console.log(`${chalk.bold.cyan('Project:')}  ${change.project}`)
  console.log(`${chalk.bold.cyan('Branch:')}   ${change.branch}`)
  if (change.owner?.name) console.log(`${chalk.bold.cyan('Owner:')}    ${change.owner.name}`)
  if (change.updated) console.log(`${chalk.bold.cyan('Updated:')}  ${timeAgo(change.updated)}`)

  const labels = change.labels
  if (labels && Object.keys(labels).length > 0) {
    const scores = Object.entries(labels)
      .map(([name, info]) => {
        const s = getLabelScore(info)
        if (s === null) return null
        const formatted = s > 0 ? chalk.green(`+${s}`) : chalk.red(String(s))
        return `${name}:${formatted}`
      })
      .filter((x): x is string => x !== null)
    if (scores.length > 0) {
      console.log(`${chalk.bold.cyan('Reviews:')}  ${scores.join('  ')}`)
    }
  }
}

// ── Command ────────────────────────────────────────────────────────────────

export const listCommand = (
  options: ListOptions,
): Effect.Effect<void, ApiError | ConfigError, ConfigServiceImpl | GerritApiService> =>
  Effect.gen(function* () {
    const configService = yield* ConfigService
    const credentials = yield* configService.getCredentials
    const gerritApi = yield* GerritApiService

    const status = options.status ?? 'open'
    const limit = options.limit ?? 25
    const user = credentials.username

    const baseQuery = options.reviewer
      ? `(reviewer:${user} OR cc:${user}) status:${status}`
      : `owner:${user} status:${status}`
    const query = options.filter ? `${baseQuery} ${options.filter}` : baseQuery

    const changes = yield* gerritApi.listChanges(query)
    const limited = changes.slice(0, limit)

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            count: limited.length,
            changes: limited.map((c) => ({
              number: c._number,
              subject: c.subject,
              project: c.project,
              branch: c.branch,
              status: c.status,
              change_id: c.change_id,
              ...(c.updated ? { updated: c.updated } : {}),
              ...(c.owner?.name ? { owner: c.owner.name } : {}),
              ...(c.labels ? { labels: c.labels } : {}),
            })),
          },
          null,
          2,
        ),
      )
      return
    }

    if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<changes count="${limited.length}">`)
      for (const c of limited) {
        console.log(`  <change>`)
        console.log(`    <number>${c._number}</number>`)
        console.log(`    <subject><![CDATA[${c.subject}]]></subject>`)
        console.log(`    <project>${c.project}</project>`)
        console.log(`    <branch>${c.branch}</branch>`)
        console.log(`    <status>${c.status}</status>`)
        console.log(`    <change_id>${c.change_id}</change_id>`)
        if (c.updated) console.log(`    <updated>${c.updated}</updated>`)
        if (c.owner?.name) console.log(`    <owner>${c.owner.name}</owner>`)
        console.log(`  </change>`)
      }
      console.log(`</changes>`)
      return
    }

    if (limited.length === 0) {
      console.log(
        chalk.dim(options.reviewer ? 'No changes need your review.' : 'No changes found.'),
      )
      return
    }

    if (options.detailed) {
      for (const [i, change] of limited.entries()) {
        if (i > 0) console.log('')
        renderDetailed(change)
      }
      return
    }

    const showOwner = options.reviewer === true
    console.log('')
    renderTableHeader(showOwner)
    for (const change of limited) {
      renderTableRow(change, showOwner)
    }
    console.log('')
  })
