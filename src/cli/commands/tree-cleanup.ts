import { spawnSync, execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Effect } from 'effect'
import chalk from 'chalk'

export interface TreeCleanupOptions {
  xml?: boolean
  json?: boolean
  force?: boolean
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

const getGerWorktrees = (repoRoot: string): string[] => {
  const gerDir = path.join(repoRoot, '.ger')
  if (!fs.existsSync(gerDir)) return []
  try {
    return fs
      .readdirSync(gerDir)
      .filter((name) => /^\d+$/.test(name))
      .map((name) => path.join(gerDir, name))
      .filter((p) => fs.statSync(p).isDirectory())
  } catch {
    return []
  }
}

const removeWorktree = (worktreePath: string, repoRoot: string, force: boolean): boolean => {
  const args = force
    ? ['worktree', 'remove', '--force', worktreePath]
    : ['worktree', 'remove', worktreePath]

  const result = spawnSync('git', args, { encoding: 'utf8', cwd: repoRoot })
  return result.status === 0
}

export const treeCleanupCommand = (
  changeId: string | undefined,
  options: TreeCleanupOptions,
): Effect.Effect<void, Error, never> =>
  Effect.sync(() => {
    if (!isInGitRepo()) {
      throw new Error('Not in a git repository')
    }

    const repoRoot = getRepoRoot()

    let targets: string[]

    if (changeId !== undefined) {
      if (!/^\d+$/.test(changeId))
        throw new Error(`Invalid change ID: ${changeId} (must be a numeric change number)`)
      const worktreePath = path.join(repoRoot, '.ger', changeId)
      if (!fs.existsSync(worktreePath)) {
        throw new Error(`No worktree found for change ${changeId}`)
      }
      targets = [worktreePath]
    } else {
      targets = getGerWorktrees(repoRoot)
      if (targets.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ status: 'success', removed: [] }, null, 2))
        } else if (options.xml) {
          console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
          console.log(`<tree_cleanup>`)
          console.log(`  <status>success</status>`)
          console.log(`  <removed></removed>`)
          console.log(`</tree_cleanup>`)
        } else {
          console.log(chalk.dim('  No ger-managed worktrees to clean up'))
        }
        return
      }
    }

    const removed: string[] = []
    const failed: string[] = []

    for (const worktreePath of targets) {
      if (!options.xml && !options.json) {
        console.log(chalk.dim(`  Removing ${worktreePath}...`))
      }

      const ok = removeWorktree(worktreePath, repoRoot, options.force ?? false)
      if (ok) {
        removed.push(worktreePath)
      } else {
        failed.push(worktreePath)
        if (!options.xml && !options.json) {
          console.log(
            chalk.yellow(
              `  Warning: Could not remove ${worktreePath} (uncommitted changes? use --force)`,
            ),
          )
        }
      }
    }

    // Clean up stale worktree metadata
    spawnSync('git', ['worktree', 'prune'], { encoding: 'utf8', cwd: repoRoot })

    if (options.json) {
      console.log(JSON.stringify({ status: 'success', removed, failed }, null, 2))
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<tree_cleanup>`)
      console.log(`  <status>success</status>`)
      console.log(`  <removed>`)
      for (const p of removed) {
        console.log(`    <path><![CDATA[${p}]]></path>`)
      }
      console.log(`  </removed>`)
      console.log(`  <failed>`)
      for (const p of failed) {
        console.log(`    <path><![CDATA[${p}]]></path>`)
      }
      console.log(`  </failed>`)
      console.log(`</tree_cleanup>`)
    } else {
      if (removed.length > 0) {
        console.log(
          chalk.green(`\n  ✓ Removed ${removed.length} worktree${removed.length !== 1 ? 's' : ''}`),
        )
      } else {
        console.log(chalk.yellow('  No worktrees were removed'))
      }
    }
  })
