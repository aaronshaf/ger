import { Schema } from '@effect/schema'
import { Effect, pipe } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { DiffOptions, DiffCommandOptions } from '@/schemas/gerrit'
import { DiffCommandOptions as DiffCommandOptionsSchema } from '@/schemas/gerrit'
import { formatDiffPretty, formatFilesList } from '@/utils/diff-formatters'
import { sanitizeCDATA, escapeXML } from '@/utils/shell-safety'

export const diffCommand = (
  changeId: string,
  options: DiffCommandOptions,
): Effect.Effect<void, ApiError | Error, GerritApiService> =>
  Effect.gen(function* () {
    // Validate input options using Effect Schema
    const validatedOptions = yield* pipe(
      options,
      Schema.decodeUnknown(DiffCommandOptionsSchema, {
        errors: 'all',
        onExcessProperty: 'ignore',
      }),
      Effect.mapError(() => new Error('Invalid diff command options')),
    )
    const apiService = yield* GerritApiService

    const diffOptions: DiffOptions = {
      format: validatedOptions.filesOnly ? 'files' : validatedOptions.format || 'unified',
      file: validatedOptions.file,
    }

    const diff = yield* apiService
      .getDiff(changeId, diffOptions)
      .pipe(
        Effect.catchTag('ApiError', (error) =>
          Effect.fail(new Error(`Failed to get diff: ${error.message}`)),
        ),
      )

    if (validatedOptions.json) {
      // JSON output
      const jsonOutput: Record<string, unknown> = {
        status: 'success',
        change_id: changeId,
      }
      if (Array.isArray(diff)) {
        jsonOutput.files = diff
      } else {
        jsonOutput.content = diff
      }
      console.log(JSON.stringify(jsonOutput, null, 2))
    } else if (validatedOptions.xml) {
      // XML output for LLM consumption
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<diff_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <change_id>${escapeXML(changeId)}</change_id>`)

      if (Array.isArray(diff)) {
        console.log(`  <files>`)
        diff.forEach((file) => {
          console.log(`    <file>${escapeXML(file)}</file>`)
        })
        console.log(`  </files>`)
      } else if (typeof diff === 'string') {
        console.log(`  <content><![CDATA[${sanitizeCDATA(diff)}]]></content>`)
      } else {
        console.log(
          `  <content><![CDATA[${sanitizeCDATA(JSON.stringify(diff, null, 2))}]]></content>`,
        )
      }

      console.log(`</diff_result>`)
    } else {
      // Human-readable output (default) - pretty formatted
      if (Array.isArray(diff)) {
        console.log(formatFilesList(diff))
      } else if (typeof diff === 'string') {
        console.log(formatDiffPretty(diff))
      } else {
        // JSON data - format as pretty JSON for readability
        console.log(JSON.stringify(diff, null, 2))
      }
    }
  })
