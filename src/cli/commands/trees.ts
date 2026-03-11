import { execSync } from 'node:child_process'
import { Effect } from 'effect'
import chalk from 'chalk'

export interface TreesOptions {
  xml?: boolean
  json?: boolean
  all?: boolean
}

interface WorktreeEntry {
  path: string
  head: string
  branch: string | null
  isDetached: boolean
  isGerManaged: boolean
}

const parseWorktreeList = (output: string): WorktreeEntry[] => {
  const entries: WorktreeEntry[] = []
  const blocks = output.trim().split('\n\n')

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    const pathLine = lines.find((l) => l.startsWith('worktree '))
    const headLine = lines.find((l) => l.startsWith('HEAD '))
    const branchLine = lines.find((l) => l.startsWith('branch '))
    const isDetached = lines.some((l) => l === 'detached')

    if (!pathLine) continue

    const worktreePath = pathLine.slice('worktree '.length)
    const head = headLine ? headLine.slice('HEAD '.length) : ''
    const rawBranch = branchLine ? branchLine.slice('branch '.length) : null
    const branch = rawBranch ? rawBranch.replace('refs/heads/', '') : null

    entries.push({
      path: worktreePath,
      head: head.slice(0, 7),
      branch,
      isDetached,
      isGerManaged: worktreePath.includes('/.ger/'),
    })
  }

  return entries
}

const isInGitRepo = (): boolean => {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

export const treesCommand = (options: TreesOptions): Effect.Effect<void, Error, never> =>
  Effect.sync(() => {
    if (!isInGitRepo()) {
      throw new Error('Not in a git repository')
    }

    let output: string
    try {
      output = execSync('git worktree list --porcelain', { encoding: 'utf8' })
    } catch {
      throw new Error('Failed to list worktrees')
    }

    const all = parseWorktreeList(output)
    const entries = options.all ? all : all.filter((e) => e.isGerManaged)

    if (options.json) {
      console.log(JSON.stringify({ status: 'success', worktrees: entries }, null, 2))
      return
    }

    if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<worktrees>`)
      for (const entry of entries) {
        console.log(`  <worktree>`)
        console.log(`    <path><![CDATA[${entry.path}]]></path>`)
        console.log(`    <head>${entry.head}</head>`)
        if (entry.branch) console.log(`    <branch><![CDATA[${entry.branch}]]></branch>`)
        console.log(`    <detached>${entry.isDetached}</detached>`)
        console.log(`    <ger_managed>${entry.isGerManaged}</ger_managed>`)
        console.log(`  </worktree>`)
      }
      console.log(`</worktrees>`)
      return
    }

    if (entries.length === 0) {
      console.log(chalk.dim('  No ger-managed worktrees found'))
      console.log(chalk.dim(`  Use ${chalk.white('ger tree setup <change-id>')} to create one`))
      return
    }

    console.log(chalk.bold('Worktrees:'))
    for (const entry of entries) {
      const branchInfo = entry.branch ? chalk.yellow(entry.branch) : chalk.dim('detached HEAD')
      console.log(`  ${chalk.green(entry.path)}`)
      console.log(`    ${chalk.dim(entry.head)} ${branchInfo}`)
    }
  })
