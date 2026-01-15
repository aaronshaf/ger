import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'

interface AddReviewerOptions {
  change?: string
  cc?: boolean
  notify?: string
  xml?: boolean
  group?: boolean
}

type NotifyLevel = 'NONE' | 'OWNER' | 'OWNER_REVIEWERS' | 'ALL'

const VALID_NOTIFY_LEVELS: ReadonlyArray<NotifyLevel> = ['NONE', 'OWNER', 'OWNER_REVIEWERS', 'ALL']

const escapeXml = (str: string): string =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const outputXmlError = (message: string): void => {
  console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
  console.log(`<add_reviewer_result>`)
  console.log(`  <status>error</status>`)
  console.log(`  <error><![CDATA[${message}]]></error>`)
  console.log(`</add_reviewer_result>`)
}

class ValidationError extends Error {
  readonly _tag = 'ValidationError'
}

export const addReviewerCommand = (
  reviewers: string[],
  options: AddReviewerOptions = {},
): Effect.Effect<void, ApiError | ValidationError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    const changeId = options.change

    if (!changeId) {
      const message =
        'Change ID is required. Use -c <change-id> or run from a branch with an active change.'
      if (options.xml) {
        outputXmlError(message)
      } else {
        console.error(`✗ ${message}`)
      }
      return yield* Effect.fail(new ValidationError(message))
    }

    if (reviewers.length === 0) {
      const entityType = options.group ? 'group' : 'reviewer'
      const message = `At least one ${entityType} is required.`
      if (options.xml) {
        outputXmlError(message)
      } else {
        console.error(`✗ ${message}`)
      }
      return yield* Effect.fail(new ValidationError(message))
    }

    // Validate that email-like inputs aren't used with --group flag
    // Note: This uses a simple heuristic (presence of '@') to detect likely email addresses.
    // While Gerrit group names could theoretically contain '@', this is rare in practice
    // and the validation serves as a helpful UX guardrail against common mistakes.
    if (options.group) {
      const emailLikeInputs = reviewers.filter((r) => r.includes('@'))
      if (emailLikeInputs.length > 0) {
        const message = `The --group flag expects group identifiers, but received email-like input: ${emailLikeInputs.join(', ')}. Did you mean to omit --group?`
        if (options.xml) {
          outputXmlError(message)
        } else {
          console.error(`✗ ${message}`)
        }
        return yield* Effect.fail(new ValidationError(message))
      }
    }

    const state: 'REVIEWER' | 'CC' = options.cc ? 'CC' : 'REVIEWER'
    const entityType = options.group ? 'group' : 'individual'
    const stateLabel = options.cc ? 'cc' : options.group ? 'group' : 'reviewer'

    let notify: NotifyLevel | undefined
    if (options.notify) {
      const upperNotify = options.notify.toUpperCase()
      if (!VALID_NOTIFY_LEVELS.includes(upperNotify as NotifyLevel)) {
        const message = `Invalid notify level: ${options.notify}. Valid values: none, owner, owner_reviewers, all`
        if (options.xml) {
          outputXmlError(message)
        } else {
          console.error(`✗ ${message}`)
        }
        return yield* Effect.fail(new ValidationError(message))
      }
      notify = upperNotify as NotifyLevel
    }

    const results: Array<{ reviewer: string; success: boolean; name?: string; error?: string }> = []

    for (const reviewer of reviewers) {
      const result = yield* Effect.either(
        gerritApi.addReviewer(changeId, reviewer, { state, notify }),
      )

      if (result._tag === 'Left') {
        const error = result.left
        const message = 'message' in error ? String(error.message) : String(error)
        results.push({ reviewer, success: false, error: message })
        continue
      }

      const apiResult = result.right

      if (apiResult.error) {
        results.push({ reviewer, success: false, error: apiResult.error })
      } else {
        const added = apiResult.reviewers?.[0] || apiResult.ccs?.[0]
        const name = added?.name || added?.email || reviewer
        results.push({ reviewer, success: true, name })
      }
    }

    if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<add_reviewer_result>`)
      console.log(`  <change_id>${escapeXml(changeId)}</change_id>`)
      console.log(`  <state>${escapeXml(state)}</state>`)
      console.log(`  <entity_type>${escapeXml(entityType)}</entity_type>`)
      console.log(`  <reviewers>`)
      for (const r of results) {
        if (r.success) {
          console.log(`    <reviewer status="added">`)
          console.log(`      <input>${escapeXml(r.reviewer)}</input>`)
          console.log(`      <name><![CDATA[${r.name}]]></name>`)
          console.log(`    </reviewer>`)
        } else {
          console.log(`    <reviewer status="failed">`)
          console.log(`      <input>${escapeXml(r.reviewer)}</input>`)
          console.log(`      <error><![CDATA[${r.error}]]></error>`)
          console.log(`    </reviewer>`)
        }
      }
      console.log(`  </reviewers>`)
      const allSuccess = results.every((r) => r.success)
      console.log(`  <status>${allSuccess ? 'success' : 'partial_failure'}</status>`)
      console.log(`</add_reviewer_result>`)
    } else {
      for (const r of results) {
        if (r.success) {
          console.log(`✓ Added ${r.name} as ${stateLabel}`)
        } else {
          console.error(`✗ Failed to add ${r.reviewer}: ${r.error}`)
        }
      }
    }
  })
