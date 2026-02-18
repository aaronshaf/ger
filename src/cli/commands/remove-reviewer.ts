import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { escapeXML, sanitizeCDATA } from '@/utils/shell-safety'

interface RemoveReviewerOptions {
  change?: string
  notify?: string
  xml?: boolean
  json?: boolean
}

type NotifyLevel = 'NONE' | 'OWNER' | 'OWNER_REVIEWERS' | 'ALL'

const VALID_NOTIFY_LEVELS: ReadonlyArray<NotifyLevel> = ['NONE', 'OWNER', 'OWNER_REVIEWERS', 'ALL']

const isValidNotifyLevel = (value: string): value is NotifyLevel =>
  VALID_NOTIFY_LEVELS.some((level) => level === value)

const outputXmlError = (message: string): void => {
  console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
  console.log(`<remove_reviewer_result>`)
  console.log(`  <status>error</status>`)
  console.log(`  <error><![CDATA[${sanitizeCDATA(message)}]]></error>`)
  console.log(`</remove_reviewer_result>`)
}

const outputJsonError = (message: string): void => {
  console.log(JSON.stringify({ status: 'error', error: message }, null, 2))
}

class ValidationError extends Error {
  readonly _tag = 'ValidationError'
}

export const removeReviewerCommand = (
  reviewers: string[],
  options: RemoveReviewerOptions = {},
): Effect.Effect<void, ApiError | ValidationError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    const changeId = options.change

    if (!changeId) {
      const message =
        'Change ID is required. Use -c <change-id> or run from a branch with an active change.'
      if (options.json) {
        outputJsonError(message)
      } else if (options.xml) {
        outputXmlError(message)
      } else {
        console.error(`✗ ${message}`)
      }
      return yield* Effect.fail(new ValidationError(message))
    }

    if (reviewers.length === 0) {
      const message = 'At least one reviewer is required.'
      if (options.json) {
        outputJsonError(message)
      } else if (options.xml) {
        outputXmlError(message)
      } else {
        console.error(`✗ ${message}`)
      }
      return yield* Effect.fail(new ValidationError(message))
    }

    let notify: NotifyLevel | undefined
    if (options.notify) {
      const upperNotify = options.notify.toUpperCase()
      if (!isValidNotifyLevel(upperNotify)) {
        const message = `Invalid notify level: ${options.notify}. Valid values: none, owner, owner_reviewers, all`
        if (options.json) {
          outputJsonError(message)
        } else if (options.xml) {
          outputXmlError(message)
        } else {
          console.error(`✗ ${message}`)
        }
        yield* Effect.fail(new ValidationError(message))
        return
      }
      notify = upperNotify
    }

    const results: Array<{ reviewer: string; success: boolean; error?: string }> = []

    for (const reviewer of reviewers) {
      const result = yield* Effect.either(
        gerritApi.removeReviewer(changeId, reviewer, notify ? { notify } : undefined),
      )

      if (result._tag === 'Left') {
        const error = result.left
        const message = 'message' in error ? String(error.message) : String(error)
        results.push({ reviewer, success: false, error: message })
        continue
      }

      results.push({ reviewer, success: true })
    }

    if (options.json) {
      const allSuccess = results.every((r) => r.success)
      console.log(
        JSON.stringify(
          {
            status: allSuccess ? 'success' : 'partial_failure',
            change_id: changeId,
            reviewers: results.map((r) =>
              r.success
                ? { input: r.reviewer, status: 'removed' }
                : { input: r.reviewer, error: r.error, status: 'failed' },
            ),
          },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<remove_reviewer_result>`)
      console.log(`  <change_id>${escapeXML(changeId)}</change_id>`)
      console.log(`  <reviewers>`)
      for (const r of results) {
        if (r.success) {
          console.log(`    <reviewer status="removed">`)
          console.log(`      <input>${escapeXML(r.reviewer)}</input>`)
          console.log(`    </reviewer>`)
        } else {
          console.log(`    <reviewer status="failed">`)
          console.log(`      <input>${escapeXML(r.reviewer)}</input>`)
          console.log(`      <error><![CDATA[${sanitizeCDATA(r.error ?? '')}]]></error>`)
          console.log(`    </reviewer>`)
        }
      }
      console.log(`  </reviewers>`)
      const allSuccess = results.every((r) => r.success)
      console.log(`  <status>${allSuccess ? 'success' : 'partial_failure'}</status>`)
      console.log(`</remove_reviewer_result>`)
    } else {
      for (const r of results) {
        if (r.success) {
          console.log(`✓ Removed ${r.reviewer}`)
        } else {
          console.error(`✗ Failed to remove ${r.reviewer}: ${r.error}`)
        }
      }
    }
  })
