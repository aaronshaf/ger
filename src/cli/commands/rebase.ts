import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { GitError, NoChangeIdError, getChangeIdFromHead } from '@/utils/git-commit'
import { escapeXML, sanitizeCDATA } from '@/utils/shell-safety'

interface RebaseOptions {
  base?: string
  xml?: boolean
}

/**
 * Rebases a Gerrit change onto the target branch or specified base.
 *
 * @param changeId - Change number or Change-ID to rebase (optional, auto-detects from HEAD if not provided)
 * @param options - Configuration options
 * @param options.base - Optional base revision to rebase onto (default: target branch HEAD)
 * @param options.xml - Whether to output in XML format for LLM consumption
 * @returns Effect that completes when the change is rebased
 */
export const rebaseCommand = (
  changeId?: string,
  options: RebaseOptions = {},
): Effect.Effect<void, never, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Auto-detect Change-ID from HEAD commit if not provided
    const resolvedChangeId = changeId || (yield* getChangeIdFromHead())

    // Perform the rebase - this returns the rebased change info
    const change = yield* gerritApi.rebaseChange(resolvedChangeId, { base: options.base })

    if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<rebase_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <change_number>${change._number}</change_number>`)
      console.log(`  <subject><![CDATA[${sanitizeCDATA(change.subject)}]]></subject>`)
      console.log(`  <branch>${escapeXML(change.branch)}</branch>`)
      if (options.base) {
        console.log(`  <base><![CDATA[${sanitizeCDATA(options.base)}]]></base>`)
      }
      console.log(`</rebase_result>`)
    } else {
      console.log(`✓ Rebased change ${change._number}: ${change.subject}`)
      console.log(`  Branch: ${change.branch}`)
      if (options.base) {
        console.log(`  Base: ${options.base}`)
      }
    }
  }).pipe(
    // Regional error boundary for the entire command
    Effect.catchAll((error: ApiError | GitError | NoChangeIdError) =>
      Effect.sync(() => {
        const errorMessage =
          error instanceof GitError || error instanceof NoChangeIdError || error instanceof Error
            ? error.message
            : String(error)

        if (options.xml) {
          console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
          console.log(`<rebase_result>`)
          console.log(`  <status>error</status>`)
          console.log(`  <error><![CDATA[${sanitizeCDATA(errorMessage)}]]></error>`)
          console.log(`</rebase_result>`)
        } else {
          console.error(`✗ Error: ${errorMessage}`)
        }
      }),
    ),
  )
