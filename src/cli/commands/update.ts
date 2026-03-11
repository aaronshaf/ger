import { execSync } from 'node:child_process'
import { Console, Effect } from 'effect'
import chalk from 'chalk'
export interface UpdateOptions {
  skipPull?: boolean
}

const PACKAGE_NAME = '@aaronshaf/ger'
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`

const readCurrentVersion = (): string => {
  try {
    // Bun.file is available at runtime; use dynamic require as fallback
    const raw = require('../../package.json') as { version: string }
    return raw.version
  } catch {
    return '0.0.0'
  }
}

class UpdateError extends Error {
  readonly _tag = 'UpdateError' as const
  constructor(message: string) {
    super(message)
    this.name = 'UpdateError'
  }
}

const fetchLatestVersion = (): Effect.Effect<string, UpdateError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(REGISTRY_URL)
      if (!res.ok) throw new Error(`Registry returned ${res.status}`)
      const data = (await res.json()) as { version: string }
      return data.version
    },
    catch: (e) =>
      new UpdateError(
        `Failed to check latest version: ${e instanceof Error ? e.message : String(e)}`,
      ),
  })

export const updateCommand = (options: UpdateOptions): Effect.Effect<void, UpdateError, never> =>
  Effect.gen(function* () {
    if (!options.skipPull) {
      yield* Console.log(chalk.dim('Checking for updates...'))

      const latest = yield* fetchLatestVersion()
      const current = readCurrentVersion()

      yield* Console.log(`  Current: ${chalk.cyan(current)}`)
      yield* Console.log(`  Latest:  ${chalk.cyan(latest)}`)

      if (current === latest) {
        yield* Console.log(chalk.green(`✓ Already up to date (${current})`))
        return
      }

      yield* Console.log('')
    }

    yield* Console.log(chalk.dim(`Installing ${PACKAGE_NAME}@latest...`))
    yield* Effect.try({
      try: () => {
        execSync(`bun install -g ${PACKAGE_NAME}@latest`, { stdio: 'inherit', timeout: 60000 })
      },
      catch: (e) =>
        new UpdateError(`Install failed: ${e instanceof Error ? e.message : String(e)}`),
    })

    yield* Console.log('')
    yield* Console.log(chalk.green('✓ ger updated successfully'))
  })
