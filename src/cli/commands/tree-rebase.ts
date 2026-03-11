import { spawnSync, execSync } from 'node:child_process'
import * as path from 'node:path'
import { Effect } from 'effect'
import chalk from 'chalk'
import { ConfigService, type ConfigError, type ConfigServiceImpl } from '@/services/config'

export interface TreeRebaseOptions {
  onto?: string
  interactive?: boolean
  xml?: boolean
  json?: boolean
}

const isInGitRepo = (): boolean => {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

const getRepoRoot = (): string =>
  execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()

const getCwd = (): string => process.cwd()

/** Returns the remote name for the given Gerrit host, or null if not found. */
const findMatchingRemote = (repoRoot: string, gerritHost: string): string | null => {
  try {
    const output = execSync('git remote -v', { encoding: 'utf8', cwd: repoRoot })
    const gerritHostname = new URL(gerritHost).hostname
    for (const line of output.split('\n')) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/)
      if (!match) continue
      const url = match[2]
      try {
        let remoteHostname: string
        if (url.startsWith('git@')) {
          remoteHostname = url.split('@')[1].split(':')[0]
        } else {
          remoteHostname = new URL(url).hostname
        }
        if (remoteHostname === gerritHostname) return match[1]
      } catch {
        // ignore malformed URLs
      }
    }
  } catch {
    // ignore
  }
  return null
}

const detectBaseBranch = (remote: string): string => {
  // Prefer upstream tracking branch
  try {
    const upstream = execSync('git rev-parse --abbrev-ref HEAD@{u}', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (upstream && !upstream.includes('@{u}')) return upstream
  } catch {
    // no upstream set
  }

  // Fall back to <remote>/main, then <remote>/master
  for (const branch of [`${remote}/main`, `${remote}/master`]) {
    try {
      execSync(`git rev-parse --verify ${branch}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return branch
    } catch {
      // try next
    }
  }

  return `${remote}/main`
}

/** Verify the current directory is inside a ger-managed worktree (.ger/<number>). */
const assertInGerWorktree = (repoRoot: string): void => {
  const cwd = getCwd()
  const gerDir = path.join(repoRoot, '.ger') + path.sep
  if (!cwd.startsWith(gerDir)) {
    throw new Error(
      `Not inside a ger-managed worktree.\nRun "ger tree setup <change-id>" first, then cd into the worktree.`,
    )
  }
  // The segment after .ger/ should be a numeric change number
  const rel = cwd.slice(gerDir.length)
  const changeNum = rel.split(path.sep)[0]
  if (!/^\d+$/.test(changeNum)) {
    throw new Error(`Current directory does not look like a ger worktree: ${cwd}`)
  }
}

export const treeRebaseCommand = (
  options: TreeRebaseOptions,
  // Optional: override gerrit host for testing
  _gerritHostOverride?: string,
): Effect.Effect<void, Error | ConfigError, ConfigServiceImpl> =>
  Effect.gen(function* () {
    const configService = yield* ConfigService
    const credentials = yield* configService.getCredentials.pipe(Effect.mapError((e): Error => e))
    const gerritHost = _gerritHostOverride ?? credentials.host

    if (!isInGitRepo()) {
      throw new Error('Not in a git repository')
    }

    const repoRoot = getRepoRoot()

    // Only allow running from inside a ger-managed worktree
    assertInGerWorktree(repoRoot)

    // Resolve the correct remote matching the configured Gerrit host
    const remote = findMatchingRemote(repoRoot, gerritHost) ?? 'origin'

    yield* Effect.try({
      try: () => {
        const baseBranch = options.onto ?? detectBaseBranch(remote)

        if (!options.xml && !options.json) {
          console.log(chalk.bold(`Rebasing onto ${chalk.cyan(baseBranch)}...`))
          console.log(chalk.dim(`  Fetching ${remote}...`))
        }

        const fetchResult = spawnSync('git', ['fetch', remote], { encoding: 'utf8', cwd: repoRoot })
        if (fetchResult.status !== 0) {
          throw new Error(`Failed to fetch ${remote}: ${fetchResult.stderr}`)
        }

        if (!options.xml && !options.json) {
          console.log(chalk.dim(`  Running git rebase ${baseBranch}...`))
        }

        const rebaseArgs = options.interactive
          ? ['rebase', '-i', baseBranch]
          : ['rebase', baseBranch]
        const rebaseResult = spawnSync('git', rebaseArgs, {
          encoding: 'utf8',
          stdio: 'inherit',
        })

        if (rebaseResult.status !== 0) {
          throw new Error(
            `Rebase failed. Resolve conflicts then run:\n  git rebase --continue\nor abort with:\n  git rebase --abort`,
          )
        }

        if (options.json) {
          console.log(JSON.stringify({ status: 'success', base: baseBranch }, null, 2))
        } else if (options.xml) {
          console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
          console.log(`<tree_rebase>`)
          console.log(`  <status>success</status>`)
          console.log(`  <base><![CDATA[${baseBranch}]]></base>`)
          console.log(`</tree_rebase>`)
        } else {
          console.log(chalk.green('\n  ✓ Rebase complete'))
        }
      },
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
  })
