import { Effect, Console } from 'effect'
import chalk from 'chalk'
import {
  CommitHookService,
  type CommitHookServiceImpl,
  type HookInstallError,
  type NotGitRepoError,
} from '@/services/commit-hook'
import { type ConfigError, type ConfigServiceImpl } from '@/services/config'

export interface InstallHookOptions {
  force?: boolean
  xml?: boolean
  json?: boolean
}

export type InstallHookErrors = ConfigError | HookInstallError | NotGitRepoError

export const installHookCommand = (
  options: InstallHookOptions,
): Effect.Effect<void, InstallHookErrors, CommitHookServiceImpl | ConfigServiceImpl> =>
  Effect.gen(function* () {
    const commitHookService = yield* CommitHookService

    // Check if hook already exists using service method
    const hookExists = yield* commitHookService.hasHook()

    if (hookExists && !options.force) {
      if (options.json) {
        yield* Console.log(
          JSON.stringify(
            {
              status: 'skipped',
              message: 'commit-msg hook already installed',
              hint: 'Use --force to overwrite',
            },
            null,
            2,
          ),
        )
      } else if (options.xml) {
        yield* Console.log('<?xml version="1.0" encoding="UTF-8"?>')
        yield* Console.log('<install_hook_result>')
        yield* Console.log('  <status>skipped</status>')
        yield* Console.log('  <message><![CDATA[commit-msg hook already installed]]></message>')
        yield* Console.log('  <hint><![CDATA[Use --force to overwrite]]></hint>')
        yield* Console.log('</install_hook_result>')
      } else {
        yield* Console.log(chalk.yellow('commit-msg hook already installed'))
        yield* Console.log(chalk.dim('Use --force to overwrite'))
      }
      return
    }

    if (hookExists && options.force) {
      if (!options.xml) {
        yield* Console.log(chalk.yellow('Overwriting existing commit-msg hook...'))
      }
    }

    // Install the hook (service logs progress messages in non-XML mode)
    yield* commitHookService.installHook()

    // Only output JSON/XML here - service already logs success message for plain mode
    if (options.json) {
      yield* Console.log(
        JSON.stringify(
          { status: 'success', message: 'commit-msg hook installed successfully' },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      yield* Console.log('<?xml version="1.0" encoding="UTF-8"?>')
      yield* Console.log('<install_hook_result>')
      yield* Console.log('  <status>success</status>')
      yield* Console.log('  <message><![CDATA[commit-msg hook installed successfully]]></message>')
      yield* Console.log('</install_hook_result>')
    }
  })
