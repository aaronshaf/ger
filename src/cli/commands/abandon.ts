import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'

interface AbandonOptions {
  message?: string
  xml?: boolean
  json?: boolean
}

export const abandonCommand = (
  changeId?: string,
  options: AbandonOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    if (!changeId) {
      console.error('✗ Change ID is required')
      console.error('  Usage: ger abandon <change-id>')
      return
    }

    try {
      // First get the change details to show what we're abandoning
      const change = yield* gerritApi.getChange(changeId)

      // Perform the abandon
      yield* gerritApi.abandonChange(changeId, options.message)

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: 'success',
              change_number: change._number,
              subject: change.subject,
              ...(options.message ? { message: options.message } : {}),
            },
            null,
            2,
          ),
        )
      } else if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<abandon_result>`)
        console.log(`  <status>success</status>`)
        console.log(`  <change_number>${change._number}</change_number>`)
        console.log(`  <subject><![CDATA[${change.subject}]]></subject>`)
        if (options.message) {
          console.log(`  <message><![CDATA[${options.message}]]></message>`)
        }
        console.log(`</abandon_result>`)
      } else {
        console.log(`✓ Abandoned change ${change._number}: ${change.subject}`)
        if (options.message) {
          console.log(`  Message: ${options.message}`)
        }
      }
    } catch {
      // If we can't get change details, still try to abandon with just the ID
      yield* gerritApi.abandonChange(changeId, options.message)

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: 'success',
              change_id: changeId,
              ...(options.message ? { message: options.message } : {}),
            },
            null,
            2,
          ),
        )
      } else if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<abandon_result>`)
        console.log(`  <status>success</status>`)
        console.log(`  <change_id>${changeId}</change_id>`)
        if (options.message) {
          console.log(`  <message><![CDATA[${options.message}]]></message>`)
        }
        console.log(`</abandon_result>`)
      } else {
        console.log(`✓ Abandoned change ${changeId}`)
        if (options.message) {
          console.log(`  Message: ${options.message}`)
        }
      }
    }
  })
