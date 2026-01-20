import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { sanitizeCDATA } from '@/utils/shell-safety'
import { getChangeIdFromHead, GitError, NoChangeIdError } from '@/utils/git-commit'

export const TOPIC_HELP_TEXT = `
Examples:
  # View current topic (auto-detect from HEAD)
  $ ger topic

  # View topic for specific change
  $ ger topic 12345

  # Set topic on a change
  $ ger topic 12345 my-feature

  # Remove topic from a change
  $ ger topic 12345 --delete
  $ ger topic --delete  # auto-detect from HEAD

Note: When no change-id is provided, it will be auto-detected from the HEAD commit.`

interface TopicOptions {
  xml?: boolean
  delete?: boolean
}

/**
 * Manages topic for a Gerrit change.
 *
 * - No topic argument: get current topic
 * - With topic argument: set topic
 * - With --delete flag: remove topic
 *
 * @param changeId - Change number or Change-ID (auto-detects from HEAD if not provided)
 * @param topic - Optional topic to set
 * @param options - Configuration options
 * @returns Effect that completes when the operation finishes
 */
export const topicCommand = (
  changeId: string | undefined,
  topic: string | undefined,
  options: TopicOptions = {},
): Effect.Effect<void, ApiError | GitError | NoChangeIdError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Auto-detect Change-ID from HEAD commit if not provided
    const resolvedChangeId = changeId?.trim() || (yield* getChangeIdFromHead())

    // Handle delete operation
    if (options.delete) {
      yield* gerritApi.deleteTopic(resolvedChangeId)

      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<topic_result>`)
        console.log(`  <status>success</status>`)
        console.log(`  <action>deleted</action>`)
        console.log(`  <change_id><![CDATA[${sanitizeCDATA(resolvedChangeId)}]]></change_id>`)
        console.log(`</topic_result>`)
      } else {
        console.log(`✓ Removed topic from change ${resolvedChangeId}`)
      }
      return
    }

    // Handle set operation
    if (topic !== undefined && topic.trim() !== '') {
      const newTopic = yield* gerritApi.setTopic(resolvedChangeId, topic)

      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<topic_result>`)
        console.log(`  <status>success</status>`)
        console.log(`  <action>set</action>`)
        console.log(`  <change_id><![CDATA[${sanitizeCDATA(resolvedChangeId)}]]></change_id>`)
        console.log(`  <topic><![CDATA[${sanitizeCDATA(newTopic)}]]></topic>`)
        console.log(`</topic_result>`)
      } else {
        console.log(`✓ Set topic on change ${resolvedChangeId}: ${newTopic}`)
      }
      return
    }

    // Handle get operation (default)
    const currentTopic = yield* gerritApi.getTopic(resolvedChangeId)

    if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<topic_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <action>get</action>`)
      console.log(`  <change_id><![CDATA[${sanitizeCDATA(resolvedChangeId)}]]></change_id>`)
      if (currentTopic) {
        console.log(`  <topic><![CDATA[${sanitizeCDATA(currentTopic)}]]></topic>`)
      } else {
        console.log(`  <topic />`)
      }
      console.log(`</topic_result>`)
    } else {
      if (currentTopic) {
        console.log(currentTopic)
      } else {
        console.log(`No topic set for change ${resolvedChangeId}`)
      }
    }
  })
