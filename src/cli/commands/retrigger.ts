import { Effect } from 'effect'
import chalk from 'chalk'
import { input } from '@inquirer/prompts'
import { type ApiError, GerritApiService, type GerritApiServiceImpl } from '@/api/gerrit'
import { type ConfigError, ConfigService, type ConfigServiceImpl } from '@/services/config'
import { getChangeIdFromHead, type GitError, type NoChangeIdError } from '@/utils/git-commit'

export const RETRIGGER_HELP_TEXT = `
Examples:
  # Retrigger CI for the change in HEAD commit (auto-detected)
  $ ger retrigger

  # Retrigger CI for a specific change
  $ ger retrigger 12345

Notes:
  - The retrigger comment is saved in config (set during "ger setup" or prompted on first use)
  - Auto-detection reads the Change-Id footer from HEAD commit`

export interface RetriggerOptions {
  xml?: boolean
  json?: boolean
}

export const retriggerCommand = (
  changeId: string | undefined,
  options: RetriggerOptions,
): Effect.Effect<
  void,
  ApiError | ConfigError | GitError | NoChangeIdError | Error,
  GerritApiServiceImpl | ConfigServiceImpl
> =>
  Effect.gen(function* () {
    // Resolve change ID — explicit arg or auto-detect from HEAD
    const resolvedChangeId = changeId !== undefined ? changeId : yield* getChangeIdFromHead()

    // Get retrigger comment from config
    const configService = yield* ConfigService
    let retriggerComment = yield* configService.getRetriggerComment

    // If not configured, prompt and save
    if (!retriggerComment) {
      if (!options.xml && !options.json) {
        console.log(chalk.yellow('No retrigger comment configured.'))
        console.log(
          chalk.dim('This comment will be posted to trigger CI. It will be saved to config.'),
        )
      }

      const prompted = yield* Effect.tryPromise({
        try: () =>
          input({
            message: 'CI retrigger comment',
          }),
        catch: (e) =>
          new Error(e instanceof Error ? e.message : 'Failed to read retrigger comment'),
      })

      if (!prompted.trim()) {
        return yield* Effect.fail(new Error('Retrigger comment cannot be empty'))
      }

      retriggerComment = prompted.trim()
      yield* configService.saveRetriggerComment(retriggerComment)

      if (!options.xml && !options.json) {
        console.log(chalk.dim('  Retrigger comment saved to config'))
      }
    }

    // Post the comment
    const gerritApi = yield* GerritApiService

    if (!options.xml && !options.json) {
      console.log(chalk.bold(`Retriggering CI for change ${chalk.cyan(resolvedChangeId)}...`))
    }

    yield* gerritApi.postReview(resolvedChangeId, { message: retriggerComment })

    if (options.json) {
      console.log(JSON.stringify({ status: 'success', change_id: resolvedChangeId }, null, 2))
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<retrigger>`)
      console.log(`  <status>success</status>`)
      console.log(`  <change_id><![CDATA[${resolvedChangeId}]]></change_id>`)
      console.log(`</retrigger>`)
    } else {
      console.log(chalk.green('  ✓ CI retrigger comment posted'))
    }
  })
