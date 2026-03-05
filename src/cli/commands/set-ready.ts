import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { sanitizeCDATA } from '@/utils/shell-safety'

interface SetReadyOptions {
  message?: string
  xml?: boolean
  json?: boolean
}

export const setReadyCommand = (
  changeId?: string,
  options: SetReadyOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    if (!changeId) {
      console.error('✗ Change ID is required')
      console.error('  Usage: ger set-ready <change-id>')
      return
    }

    // Try to fetch change details for richer output, but don't let it block the mutation
    let changeNumber: number | undefined
    let subject: string | undefined
    try {
      const change = yield* gerritApi.getChange(changeId)
      changeNumber = change._number
      subject = change.subject
    } catch {
      // Proceed without change details
    }

    yield* gerritApi.setReady(changeId, options.message)

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            ...(changeNumber !== undefined
              ? { change_number: changeNumber }
              : { change_id: changeId }),
            ...(subject !== undefined ? { subject } : {}),
            ...(options.message ? { message: options.message } : {}),
          },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<set_ready_result>`)
      console.log(`  <status>success</status>`)
      if (changeNumber !== undefined) {
        console.log(`  <change_number>${changeNumber}</change_number>`)
      } else {
        console.log(`  <change_id>${changeId}</change_id>`)
      }
      if (subject !== undefined) {
        console.log(`  <subject><![CDATA[${sanitizeCDATA(subject)}]]></subject>`)
      }
      if (options.message) {
        console.log(`  <message><![CDATA[${sanitizeCDATA(options.message)}]]></message>`)
      }
      console.log(`</set_ready_result>`)
    } else {
      const label = changeNumber !== undefined ? `${changeNumber}` : changeId
      const suffix = subject !== undefined ? `: ${subject}` : ''
      console.log(`✓ Marked change ${label} as ready for review${suffix}`)
      if (options.message) {
        console.log(`  Message: ${options.message}`)
      }
    }
  })
