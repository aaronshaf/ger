import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'

interface SubmitOptions {
  xml?: boolean
  json?: boolean
}

/**
 * Submits a Gerrit change for merging after verifying it meets submit requirements.
 *
 * Pre-validates that the change has required approvals and is in the correct state
 * before attempting submission.
 *
 * @param changeId - Change number or Change-ID to submit
 * @param options - Configuration options
 * @param options.xml - Whether to output in XML format for LLM consumption
 * @returns Effect that completes when the change is submitted or validation fails
 */
export const submitCommand = (
  changeId?: string,
  options: SubmitOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    if (!changeId || changeId.trim() === '') {
      console.error('✗ Change ID is required')
      console.error('  Usage: ger submit <change-id>')
      return
    }

    // Pre-check: Fetch change to verify it's submittable
    const change = yield* gerritApi.getChange(changeId)

    // Check if the change is submittable
    if (change.submittable === false) {
      const reasons: string[] = []

      // Check status
      if (change.status !== 'NEW') {
        reasons.push(`Change status is ${change.status} (must be NEW)`)
      }

      // Check for work in progress
      if (change.work_in_progress) {
        reasons.push('Change is marked as work-in-progress')
      }

      // Check labels for required approvals
      if (change.labels) {
        const codeReview = change.labels['Code-Review']
        const verified = change.labels['Verified']

        if (codeReview && !codeReview.approved) {
          reasons.push('Missing Code-Review+2 approval')
        }

        if (verified && !verified.approved) {
          reasons.push('Missing Verified+1 approval')
        }
      }

      // If no specific reasons found but not submittable, add generic reason
      if (reasons.length === 0) {
        reasons.push('Change does not meet submit requirements')
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              status: 'error',
              change_number: change._number,
              subject: change.subject,
              submittable: false,
              reasons,
            },
            null,
            2,
          ),
        )
      } else if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<submit_result>`)
        console.log(`  <status>error</status>`)
        console.log(`  <change_number>${change._number}</change_number>`)
        console.log(`  <subject><![CDATA[${change.subject}]]></subject>`)
        console.log(`  <submittable>false</submittable>`)
        console.log(`  <reasons>`)
        for (const reason of reasons) {
          console.log(`    <reason><![CDATA[${reason}]]></reason>`)
        }
        console.log(`  </reasons>`)
        console.log(`</submit_result>`)
      } else {
        console.error(`✗ Change ${change._number} cannot be submitted:`)
        console.error(`  ${change.subject}`)
        console.error(``)
        console.error(`  Reasons:`)
        for (const reason of reasons) {
          console.error(`  - ${reason}`)
        }
      }
      return
    }

    // Change is submittable, proceed with submission
    const result = yield* gerritApi.submitChange(changeId)

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            change_number: change._number,
            subject: change.subject,
            submit_status: result.status,
          },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<submit_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <change_number>${change._number}</change_number>`)
      console.log(`  <subject><![CDATA[${change.subject}]]></subject>`)
      console.log(`  <submit_status>${result.status}</submit_status>`)
      console.log(`</submit_result>`)
    } else {
      console.log(`✓ Submitted change ${change._number}: ${change.subject}`)
      console.log(`  Status: ${result.status}`)
    }
  })
