import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'

interface RebaseOptions {
  base?: string
  xml?: boolean
}

/**
 * Rebases a Gerrit change onto the target branch or specified base.
 *
 * @param changeId - Change number or Change-ID to rebase
 * @param options - Configuration options
 * @param options.base - Optional base revision to rebase onto (default: target branch HEAD)
 * @param options.xml - Whether to output in XML format for LLM consumption
 * @returns Effect that completes when the change is rebased
 */
export const rebaseCommand = (
  changeId?: string,
  options: RebaseOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    if (!changeId || changeId.trim() === '') {
      console.error('✗ Change ID is required')
      console.error('  Usage: ger rebase <change-id> [--base <ref>]')
      return
    }

    // Perform the rebase - this returns the rebased change info
    const change = yield* gerritApi.rebaseChange(changeId, { base: options.base })

    if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<rebase_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <change_number>${change._number}</change_number>`)
      console.log(`  <subject><![CDATA[${change.subject}]]></subject>`)
      console.log(`  <branch>${change.branch}</branch>`)
      if (options.base) {
        console.log(`  <base><![CDATA[${options.base}]]></base>`)
      }
      console.log(`</rebase_result>`)
    } else {
      console.log(`✓ Rebased change ${change._number}: ${change.subject}`)
      console.log(`  Branch: ${change.branch}`)
      if (options.base) {
        console.log(`  Base: ${options.base}`)
      }
    }
  })
