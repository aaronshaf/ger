import { execSync, spawnSync } from 'node:child_process'
import { Console, Effect } from 'effect'
import chalk from 'chalk'
import { ConfigService, type ConfigError, type ConfigServiceImpl } from '@/services/config'
import {
  CommitHookService,
  NotGitRepoError,
  type HookInstallError,
  type MissingChangeIdError,
  type CommitHookServiceImpl,
} from '@/services/commit-hook'

/** Help text for push command - exported to keep index.ts under line limit */
export const PUSH_HELP_TEXT = `
Examples:
  # Basic push to auto-detected target branch
  $ ger push

  # Push to specific branch
  $ ger push -b master
  $ ger push --branch feature/foo

  # With topic
  $ ger push -t my-feature

  # With reviewers (can be repeated)
  $ ger push -r alice@example.com -r bob@example.com

  # With CC
  $ ger push --cc manager@example.com

  # Work in progress
  $ ger push --wip

  # Mark ready for review
  $ ger push --ready

  # Add hashtag
  $ ger push --hashtag bugfix

  # Combine options
  $ ger push -b master -t refactor-auth -r alice@example.com --wip

  # Dry run (show what would be pushed)
  $ ger push --dry-run

Note:
  - Auto-installs commit-msg hook if missing
  - Auto-detects target branch from tracking branch or defaults to main/master
  - Supports all standard Gerrit push options`

export interface PushOptions {
  branch?: string
  topic?: string
  reviewer?: string[]
  cc?: string[]
  wip?: boolean
  ready?: boolean
  hashtag?: string[]
  private?: boolean
  draft?: boolean
  dryRun?: boolean
}

// Custom error for push-specific failures
export class PushError extends Error {
  readonly _tag = 'PushError'
  constructor(message: string) {
    super(message)
    this.name = 'PushError'
  }
}

export type PushErrors =
  | ConfigError
  | HookInstallError
  | MissingChangeIdError
  | NotGitRepoError
  | PushError

/** Basic email validation pattern */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Validate email addresses for reviewer/cc options */
export const validateEmails = (emails: string[] | undefined, fieldName: string): void => {
  if (!emails) return
  for (const email of emails) {
    if (!EMAIL_PATTERN.test(email)) {
      throw new PushError(
        `Invalid email address for ${fieldName}: "${email}"\n` + `Expected format: user@domain.com`,
      )
    }
  }
}

// Get git remotes
const getGitRemotes = (): Record<string, string> => {
  try {
    const output = execSync('git remote -v', { encoding: 'utf8' })
    const remotes: Record<string, string> = {}

    for (const line of output.split('\n')) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\(push\)$/)
      if (match) {
        remotes[match[1]] = match[2]
      }
    }

    return remotes
  } catch {
    return {}
  }
}

// Find remote matching Gerrit host
const findMatchingRemote = (gerritHost: string): string | null => {
  const remotes = getGitRemotes()

  // Parse gerrit host
  const gerritUrl = new URL(gerritHost)
  const gerritHostname = gerritUrl.hostname

  // Check each remote
  for (const [name, url] of Object.entries(remotes)) {
    try {
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

// Check if we're in a git repo
const isInGitRepo = (): boolean => {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

// Get current branch name
const getCurrentBranch = (): string | null => {
  try {
    const branch = execSync('git symbolic-ref --short HEAD', { encoding: 'utf8' }).trim()
    return branch || null
  } catch {
    return null
  }
}

// Get tracking branch for current branch
const getTrackingBranch = (): string | null => {
  try {
    // Get the upstream branch reference
    const upstream = execSync('git rev-parse --abbrev-ref @{upstream}', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    // Extract branch name (remove remote prefix like "origin/")
    const parts = upstream.split('/')
    if (parts.length > 1) {
      return parts.slice(1).join('/')
    }
    return upstream
  } catch {
    return null
  }
}

// Check if a remote branch exists
const remoteBranchExists = (remote: string, branch: string): boolean => {
  try {
    execSync(`git rev-parse --verify ${remote}/${branch}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

// Detect target branch with fallback strategy
const detectTargetBranch = (remote: string): string => {
  // 1. Try tracking branch
  const tracking = getTrackingBranch()
  if (tracking) {
    return tracking
  }

  // 2. Check if origin/main exists
  if (remoteBranchExists(remote, 'main')) {
    return 'main'
  }

  // 3. Check if origin/master exists
  if (remoteBranchExists(remote, 'master')) {
    return 'master'
  }

  // 4. Final fallback
  return 'master'
}

// Build Gerrit push refspec with options
export const buildPushRefspec = (branch: string, options: PushOptions): string => {
  let refspec = `refs/for/${branch}`
  const params: string[] = []

  if (options.topic) {
    params.push(`topic=${encodeURIComponent(options.topic)}`)
  }

  // --draft is an alias for --wip; both map to Gerrit's 'wip' push option
  if (options.wip || options.draft) {
    params.push('wip')
  }

  if (options.ready) {
    params.push('ready')
  }

  if (options.private) {
    params.push('private')
  }

  if (options.reviewer) {
    for (const reviewer of options.reviewer) {
      params.push(`r=${reviewer}`)
    }
  }

  if (options.cc) {
    for (const cc of options.cc) {
      params.push(`cc=${cc}`)
    }
  }

  if (options.hashtag) {
    for (const tag of options.hashtag) {
      params.push(`hashtag=${encodeURIComponent(tag)}`)
    }
  }

  if (params.length > 0) {
    refspec += '%' + params.join(',')
  }

  return refspec
}

// Parse push output to extract change URL
const extractChangeUrl = (output: string): string | null => {
  // Gerrit push output format: "remote: https://gerrit.example.com/c/project/+/12345"
  const urlMatch = output.match(/remote:\s+(https?:\/\/\S+\/c\/\S+\/\+\/\d+)/)
  if (urlMatch) {
    return urlMatch[1]
  }

  return null
}

export const pushCommand = (
  options: PushOptions,
): Effect.Effect<void, PushErrors, ConfigServiceImpl | CommitHookServiceImpl> =>
  Effect.gen(function* () {
    // Validate email addresses early
    yield* Effect.try({
      try: () => {
        validateEmails(options.reviewer, 'reviewer')
        validateEmails(options.cc, 'cc')
      },
      catch: (e) => (e instanceof PushError ? e : new PushError(String(e))),
    })

    // Check if we're in a git repo
    if (!isInGitRepo()) {
      return yield* Effect.fail(new NotGitRepoError({ message: 'Not in a git repository' }))
    }

    // Get config for Gerrit host
    const configService = yield* ConfigService
    const credentials = yield* configService.getCredentials

    // Find matching remote
    const remote = findMatchingRemote(credentials.host)
    if (!remote) {
      return yield* Effect.fail(
        new PushError(
          `No git remote found matching Gerrit host: ${credentials.host}\n` +
            `Please ensure your git remote points to the Gerrit server.`,
        ),
      )
    }

    // Ensure commit has Change-Id (installs hook if needed)
    const commitHookService = yield* CommitHookService
    yield* commitHookService.ensureChangeId()

    // Determine target branch
    const targetBranch = options.branch || detectTargetBranch(remote)

    // Build refspec
    const refspec = buildPushRefspec(targetBranch, options)

    // Current branch info
    const currentBranch = getCurrentBranch() || 'HEAD'

    // Display what we're doing
    if (options.dryRun) {
      yield* Console.log(chalk.yellow('Dry run mode - no changes will be pushed\n'))
    }

    yield* Console.log(chalk.bold('Pushing to Gerrit'))
    yield* Console.log(`  Remote: ${remote} (${credentials.host})`)
    yield* Console.log(`  Branch: ${currentBranch} -> ${targetBranch}`)

    if (options.topic) {
      yield* Console.log(`  Topic: ${options.topic}`)
    }
    if (options.reviewer && options.reviewer.length > 0) {
      yield* Console.log(`  Reviewers: ${options.reviewer.join(', ')}`)
    }
    if (options.cc && options.cc.length > 0) {
      yield* Console.log(`  CC: ${options.cc.join(', ')}`)
    }
    if (options.wip || options.draft) {
      yield* Console.log(`  Status: ${chalk.yellow('Work-in-Progress')}`)
    }
    if (options.ready) {
      yield* Console.log(`  Status: ${chalk.green('Ready for Review')}`)
    }
    if (options.hashtag && options.hashtag.length > 0) {
      yield* Console.log(`  Hashtags: ${options.hashtag.join(', ')}`)
    }

    yield* Console.log('')

    // Build git push command
    const args = ['push']
    if (options.dryRun) {
      args.push('--dry-run')
    }
    args.push(remote)
    args.push(`HEAD:${refspec}`)

    // Execute push
    const result = spawnSync('git', args, {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    // Combine stdout and stderr (git push writes to stderr)
    const output = (result.stdout || '') + (result.stderr || '')

    if (result.status !== 0) {
      // Parse common errors
      if (output.includes('no new changes')) {
        yield* Console.log(chalk.yellow('No new changes to push'))
        return
      }

      if (output.includes('Permission denied') || output.includes('authentication failed')) {
        return yield* Effect.fail(
          new PushError(
            'Authentication failed. Please check your credentials with: ger status\n' +
              'You may need to regenerate your HTTP password in Gerrit settings.',
          ),
        )
      }

      if (output.includes('prohibited by Gerrit')) {
        return yield* Effect.fail(
          new PushError(
            'Push rejected by Gerrit. Common causes:\n' +
              '  - Missing permissions for the target branch\n' +
              '  - Branch may be read-only\n' +
              '  - Change-Id may be in use by another change',
          ),
        )
      }

      return yield* Effect.fail(new PushError(`Push failed:\n${output}`))
    }

    // Success - try to extract change URL
    const changeUrl = extractChangeUrl(output)

    yield* Console.log(chalk.green('Push successful!'))

    if (changeUrl) {
      yield* Console.log(`\n  ${chalk.cyan(changeUrl)}`)
    }

    // Show the raw output for additional info
    if (output.includes('remote:')) {
      const remoteLines = output
        .split('\n')
        .filter((line) => line.startsWith('remote:'))
        .map((line) => line.replace('remote:', '').trim())
        .filter((line) => line.length > 0)

      if (remoteLines.length > 0) {
        yield* Console.log('\nGerrit response:')
        for (const line of remoteLines) {
          yield* Console.log(`  ${line}`)
        }
      }
    }
  })
