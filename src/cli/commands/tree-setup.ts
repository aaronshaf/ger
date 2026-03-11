import { spawnSync, execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Effect } from 'effect'
import chalk from 'chalk'
import { type ApiError, GerritApiService, type GerritApiServiceImpl } from '@/api/gerrit'
import { type ConfigError, ConfigService, type ConfigServiceImpl } from '@/services/config'

export const TREE_SETUP_HELP_TEXT = `
Examples:
  # Set up worktree for latest patchset
  $ ger tree setup 12345

  # Set up worktree for specific patchset
  $ ger tree setup 12345:3

  # XML output (for LLM pipelines)
  $ ger tree setup 12345 --xml

Notes:
  - Worktree is created at <repo-root>/.ger/<change-number>/
  - If worktree already exists, prints the path and exits
  - Use 'ger trees' to list worktrees, 'ger tree cleanup' to remove them`

export interface TreeSetupOptions {
  xml?: boolean
  json?: boolean
}

const parseChangeSpec = (changeSpec: string): { changeId: string; patchset?: string } => {
  const parts = changeSpec.split(':')
  return { changeId: parts[0], patchset: parts[1] }
}

const getGitRemotes = (): Record<string, string> => {
  try {
    const output = execSync('git remote -v', { encoding: 'utf8' })
    const remotes: Record<string, string> = {}
    for (const line of output.split('\n')) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/)
      if (match) remotes[match[1]] = match[2]
    }
    return remotes
  } catch {
    return {}
  }
}

const findMatchingRemote = (gerritHost: string): string | null => {
  const remotes = getGitRemotes()
  const gerritUrl = new URL(gerritHost)
  const gerritHostname = gerritUrl.hostname
  for (const [name, url] of Object.entries(remotes)) {
    try {
      let remoteHostname: string
      if (url.startsWith('git@')) {
        remoteHostname = url.split('@')[1].split(':')[0]
      } else if (url.includes('://')) {
        remoteHostname = new URL(url).hostname
      } else {
        continue
      }
      if (remoteHostname === gerritHostname) return name
    } catch {
      // ignore malformed URLs
    }
  }
  return null
}

const isInGitRepo = (): boolean => {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

const getRepoRoot = (): string => {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('Not in a git repository')
  }
}

export const treeSetupCommand = (
  changeSpec: string,
  options: TreeSetupOptions,
): Effect.Effect<void, ApiError | ConfigError | Error, GerritApiServiceImpl | ConfigServiceImpl> =>
  Effect.gen(function* () {
    if (!isInGitRepo()) {
      throw new Error(
        'Not in a git repository. Please run this command from within a git repository.',
      )
    }

    const repoRoot = getRepoRoot()
    const { changeId, patchset } = parseChangeSpec(changeSpec)

    const configService = yield* ConfigService
    const credentials = yield* configService.getCredentials
    const matchingRemote = findMatchingRemote(credentials.host)

    if (!matchingRemote) {
      throw new Error(`No git remote found matching Gerrit host: ${credentials.host}`)
    }

    if (!options.xml && !options.json) {
      console.log(chalk.bold(`Setting up worktree for change ${chalk.cyan(changeId)}...`))
    }

    const gerritApi = yield* GerritApiService
    const change = yield* gerritApi.getChange(changeId)

    if (!options.xml && !options.json) {
      console.log(chalk.dim(`  ${change._number}: ${change.subject}`))
    }

    const targetPatchset = patchset ?? 'current'
    const revision = yield* gerritApi.getRevision(changeId, targetPatchset)

    const workspaceName = change._number.toString()
    if (!/^\d+$/.test(workspaceName)) {
      throw new Error(`Invalid change number: ${workspaceName}`)
    }
    const worktreeDir = path.join(repoRoot, '.ger', workspaceName)

    if (fs.existsSync(worktreeDir)) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'success', path: worktreeDir, exists: true }, null, 2))
      } else if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<tree_setup>`)
        console.log(`  <path>${worktreeDir}</path>`)
        console.log(`  <exists>true</exists>`)
        console.log(`</tree_setup>`)
      } else {
        console.log(chalk.yellow('  Worktree already exists'))
        console.log(`\n  ${chalk.bold('cd')} ${chalk.green(worktreeDir)}`)
      }
      return
    }

    const gerDir = path.join(repoRoot, '.ger')
    if (!fs.existsSync(gerDir)) {
      fs.mkdirSync(gerDir, { recursive: true })
    }

    const changeRef = revision.ref
    if (!options.xml && !options.json) {
      console.log(chalk.dim(`  Fetching ${changeRef}...`))
    }

    const fetchResult = spawnSync('git', ['fetch', matchingRemote, changeRef], {
      encoding: 'utf8',
      cwd: repoRoot,
    })
    if (fetchResult.status !== 0) {
      throw new Error(fetchResult.stderr ?? 'Git fetch failed')
    }

    if (!options.xml && !options.json) {
      console.log(chalk.dim(`  Creating worktree...`))
    }

    const worktreeResult = spawnSync('git', ['worktree', 'add', worktreeDir, 'FETCH_HEAD'], {
      encoding: 'utf8',
      cwd: repoRoot,
    })
    if (worktreeResult.status !== 0) {
      throw new Error(worktreeResult.stderr ?? 'Git worktree add failed')
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            path: worktreeDir,
            change_number: change._number,
            subject: change.subject,
            created: true,
          },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<tree_setup>`)
      console.log(`  <path>${worktreeDir}</path>`)
      console.log(`  <change_number>${change._number}</change_number>`)
      console.log(`  <subject><![CDATA[${change.subject}]]></subject>`)
      console.log(`  <created>true</created>`)
      console.log(`</tree_setup>`)
    } else {
      console.log(chalk.green('\n  ✓ Worktree ready'))
      console.log(`\n  ${chalk.bold('cd')} ${chalk.green(worktreeDir)}`)
    }
  })
