import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { ReviewInput } from '@/schemas/gerrit'

interface VoteOptions {
  codeReview?: number
  verified?: number
  label?: string[]
  message?: string
  xml?: boolean
  json?: boolean
}

/**
 * Casts votes on a Gerrit change with optional comment message.
 *
 * Supports standard labels (Code-Review, Verified) and custom labels.
 * At least one label must be provided.
 *
 * @param changeId - Change number or Change-ID to vote on
 * @param options - Configuration options
 * @param options.codeReview - Code-Review vote value (-2 to +2)
 * @param options.verified - Verified vote value (-1 to +1)
 * @param options.label - Custom label name-value pairs
 * @param options.message - Optional comment message with the vote
 * @param options.xml - Whether to output in XML format for LLM consumption
 * @returns Effect that completes when votes are cast
 */
export const voteCommand = (
  changeId?: string,
  options: VoteOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    if (!changeId || changeId.trim() === '') {
      console.error('✗ Change ID is required')
      console.error('  Usage: ger vote <change-id> --code-review <value> [--verified <value>]')
      return
    }

    // Build labels object from options
    const labels: Record<string, number> = {}

    if (options.codeReview !== undefined) {
      labels['Code-Review'] = options.codeReview
    }

    if (options.verified !== undefined) {
      labels['Verified'] = options.verified
    }

    // Parse custom labels (format: --label <name> <value>)
    if (options.label && options.label.length > 0) {
      // Labels come in pairs: [name1, value1, name2, value2, ...]
      if (options.label.length % 2 !== 0) {
        console.error('✗ Invalid label format: labels must be provided as name-value pairs')
        console.error('  Usage: --label <name> <value> [--label <name> <value> ...]')
        return
      }

      for (let i = 0; i < options.label.length; i += 2) {
        const labelName = options.label[i]
        const labelValue = options.label[i + 1]
        if (labelName && labelValue) {
          const numValue = Number.parseInt(labelValue, 10)
          if (Number.isNaN(numValue)) {
            console.error(`✗ Invalid label value for ${labelName}: ${labelValue}`)
            console.error('  Label values must be integers')
            return
          }
          labels[labelName] = numValue
        }
      }
    }

    // Check if at least one label is provided
    if (Object.keys(labels).length === 0) {
      console.error('✗ At least one label is required')
      console.error(
        '  Usage: ger vote <change-id> --code-review <value> [--verified <value>] [--label <name> <value>]',
      )
      return
    }

    // Build ReviewInput
    const reviewInput: ReviewInput = {
      labels,
      ...(options.message && { message: options.message }),
    }

    // Post the review
    yield* gerritApi.postReview(changeId, reviewInput)

    // Output success
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            change_id: changeId,
            labels,
            ...(options.message ? { message: options.message } : {}),
          },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<vote_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <change_id>${changeId}</change_id>`)
      console.log(`  <labels>`)
      for (const [name, value] of Object.entries(labels)) {
        console.log(`    <label name="${name}">${value}</label>`)
      }
      console.log(`  </labels>`)
      if (options.message) {
        console.log(`  <message><![CDATA[${options.message}]]></message>`)
      }
      console.log(`</vote_result>`)
    } else {
      console.log(`✓ Voted on change ${changeId}`)
      for (const [name, value] of Object.entries(labels)) {
        const sign = value >= 0 ? '+' : ''
        console.log(`  ${name}: ${sign}${value}`)
      }
      if (options.message) {
        console.log(`  Message: ${options.message}`)
      }
    }
  })
