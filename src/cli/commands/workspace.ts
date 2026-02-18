import { execSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { type ConfigError, ConfigService } from '@/services/config'

interface WorkspaceOptions {
  xml?: boolean
  json?: boolean
}

const parseChangeSpec = (changeSpec: string): { changeId: string; patchset?: string } => {
  const parts = changeSpec.split(':')
  return {
    changeId: parts[0],
    patchset: parts[1],
  }
}

const getGitRemotes = (): Record<string, string> => {
  try {
    const output = execSync('git remote -v', { encoding: 'utf8' })
    const remotes: Record<string, string> = {}

    for (const line of output.split('\n')) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/)
      if (match) {
        remotes[match[1]] = match[2]
      }
    }

    return remotes
  } catch {
    return {}
  }
}

const findMatchingRemote = (gerritHost: string): string | null => {
  const remotes = getGitRemotes()

  // Parse gerrit host
  const gerritUrl = new URL(gerritHost)
  const gerritHostname = gerritUrl.hostname

  // Check each remote
  for (const [name, url] of Object.entries(remotes)) {
    try {
      // Handle both HTTP and SSH URLs
      let remoteHostname: string

      if (url.startsWith('git@') || url.includes('://')) {
        if (url.startsWith('git@')) {
          // SSH format: git@hostname:project
          remoteHostname = url.split('@')[1].split(':')[0]
        } else {
          // HTTP format
          const remoteUrl = new URL(url)
          remoteHostname = remoteUrl.hostname
        }

        if (remoteHostname === gerritHostname) {
          return name
        }
      }
    } catch {
      // Ignore malformed URLs
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

export const workspaceCommand = (
  changeSpec: string,
  options: WorkspaceOptions,
): Effect.Effect<void, ApiError | ConfigError | Error, GerritApiService | ConfigService> =>
  Effect.gen(function* () {
    // Check if we're in a git repo
    if (!isInGitRepo()) {
      throw new Error(
        'Not in a git repository. Please run this command from within a git repository.',
      )
    }

    const repoRoot = getRepoRoot()
    const { changeId, patchset } = parseChangeSpec(changeSpec)

    // Get Gerrit credentials and find matching remote
    const configService = yield* ConfigService
    const credentials = yield* configService.getCredentials
    const matchingRemote = findMatchingRemote(credentials.host)

    if (!matchingRemote) {
      throw new Error(`No git remote found matching Gerrit host: ${credentials.host}`)
    }

    // Get change details from Gerrit
    const gerritApi = yield* GerritApiService
    const change = yield* gerritApi.getChange(changeId)

    // Determine patchset to use
    const targetPatchset = patchset || 'current'
    const revision = yield* gerritApi.getRevision(changeId, targetPatchset)

    // Create workspace directory name - validate to prevent path traversal
    const workspaceName = change._number.toString()
    // Validate workspace name contains only digits
    if (!/^\d+$/.test(workspaceName)) {
      throw new Error(`Invalid change number: ${workspaceName}`)
    }
    const workspaceDir = path.join(repoRoot, '.ger', workspaceName)

    // Check if worktree already exists
    if (fs.existsSync(workspaceDir)) {
      if (options.json) {
        console.log(
          JSON.stringify({ status: 'success', path: workspaceDir, exists: true }, null, 2),
        )
      } else if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<workspace>`)
        console.log(`  <path>${workspaceDir}</path>`)
        console.log(`  <exists>true</exists>`)
        console.log(`</workspace>`)
      } else {
        console.log(`✓ Workspace already exists at: ${workspaceDir}`)
        console.log(`  Run: cd ${workspaceDir}`)
      }
      return
    }

    // Ensure .ger directory exists
    const gerDir = path.join(repoRoot, '.ger')
    if (!fs.existsSync(gerDir)) {
      fs.mkdirSync(gerDir, { recursive: true })
    }

    // Fetch the change ref
    const changeRef = revision.ref
    if (!options.xml && !options.json) {
      console.log(`Fetching change ${change._number}: ${change.subject}`)
    }

    try {
      // Use spawnSync with array to prevent command injection
      const fetchResult = spawnSync('git', ['fetch', matchingRemote, changeRef], {
        encoding: 'utf8',
        cwd: repoRoot,
      })
      if (fetchResult.status !== 0) {
        throw new Error(fetchResult.stderr || 'Git fetch failed')
      }
    } catch (error) {
      throw new Error(`Failed to fetch change: ${error}`)
    }

    // Create worktree
    if (!options.xml && !options.json) {
      console.log(`Creating worktree at: ${workspaceDir}`)
    }

    try {
      // Use spawnSync with array to prevent command injection
      const worktreeResult = spawnSync('git', ['worktree', 'add', workspaceDir, 'FETCH_HEAD'], {
        encoding: 'utf8',
        cwd: repoRoot,
      })
      if (worktreeResult.status !== 0) {
        throw new Error(worktreeResult.stderr || 'Git worktree add failed')
      }
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error}`)
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            path: workspaceDir,
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
      console.log(`<workspace>`)
      console.log(`  <path>${workspaceDir}</path>`)
      console.log(`  <change_number>${change._number}</change_number>`)
      console.log(`  <subject><![CDATA[${change.subject}]]></subject>`)
      console.log(`  <created>true</created>`)
      console.log(`</workspace>`)
    } else {
      console.log(`✓ Workspace created successfully!`)
      console.log(`  Run: cd ${workspaceDir}`)
    }
  })
