import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'

interface RestoreOptions {
  message?: string
  xml?: boolean
}

/**
 * Restores an abandoned Gerrit change to NEW status.
 *
 * @param changeId - Change number or Change-ID to restore
 * @param options - Configuration options
 * @param options.message - Optional restoration message
 * @param options.xml - Whether to output in XML format for LLM consumption
 * @returns Effect that completes when the change is restored
 */
export const restoreCommand = (
  changeId?: string,
  options: RestoreOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    if (!changeId || changeId.trim() === '') {
      console.error('✗ Change ID is required')
      console.error('  Usage: ger restore <change-id>')
      return
    }

    // Perform the restore - this returns the restored change info
    const change = yield* gerritApi.restoreChange(changeId, options.message)

    if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<restore_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <change_number>${change._number}</change_number>`)
      console.log(`  <subject><![CDATA[${change.subject}]]></subject>`)
      if (options.message) {
        console.log(`  <message><![CDATA[${options.message}]]></message>`)
      }
      console.log(`</restore_result>`)
    } else {
      console.log(`✓ Restored change ${change._number}: ${change.subject}`)
      if (options.message) {
        console.log(`  Message: ${options.message}`)
      }
    }
  })
