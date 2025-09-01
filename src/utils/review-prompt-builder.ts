import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import type { CommentInfo, MessageInfo } from '@/schemas/gerrit'
import { flattenComments } from '@/utils/review-formatters'

export const buildEnhancedPrompt = (
  userPrompt: string,
  systemPrompt: string,
  changeId: string,
  changedFiles: string[],
): Effect.Effect<string, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    const change = yield* gerritApi.getChange(changeId)
    const commentsMap = yield* gerritApi.getComments(changeId)
    const messages = yield* gerritApi.getMessages(changeId)

    const comments = flattenComments(commentsMap)

    const promptLines: string[] = []

    // User custom prompt (if provided)
    if (userPrompt.trim()) {
      promptLines.push(userPrompt.trim())
      promptLines.push('')
    }

    // System prompt
    promptLines.push(systemPrompt.trim())
    promptLines.push('')

    // Change metadata section
    promptLines.push('CHANGE INFORMATION')
    promptLines.push('==================')
    promptLines.push(`Change ID: ${change.change_id}`)
    promptLines.push(`Number: ${change._number}`)
    promptLines.push(`Subject: ${change.subject}`)
    promptLines.push(`Project: ${change.project}`)
    promptLines.push(`Branch: ${change.branch}`)
    promptLines.push(`Status: ${change.status}`)
    if (change.owner?.name) {
      promptLines.push(`Author: ${change.owner.name}`)
    }
    promptLines.push('')

    // Existing comments section
    if (comments.length > 0) {
      promptLines.push('EXISTING COMMENTS')
      promptLines.push('=================')
      for (const comment of comments) {
        const author = comment.author?.name || 'Unknown'
        const date = comment.updated || 'Unknown date'
        const location = comment.path
          ? `${comment.path}${comment.line ? `:${comment.line}` : ''}`
          : 'General'
        promptLines.push(`[${author}] on ${location} (${date}):`)
        promptLines.push(`  ${comment.message}`)
        if (comment.unresolved) {
          promptLines.push('  ⚠️ UNRESOLVED')
        }
        promptLines.push('')
      }
    }

    // Review messages section
    if (messages.length > 0) {
      promptLines.push('REVIEW ACTIVITY')
      promptLines.push('===============')
      for (const message of messages) {
        const author = message.author?.name || 'Unknown'
        const cleanMessage = message.message.trim()

        // Skip very short automated messages
        if (
          cleanMessage.length >= 10 &&
          !cleanMessage.includes('Build') &&
          !cleanMessage.includes('Patch')
        ) {
          promptLines.push(`[${author}] ${message.date}:`)
          promptLines.push(`  ${cleanMessage}`)
          promptLines.push('')
        }
      }
    }

    // Changed files section
    promptLines.push('CHANGED FILES')
    promptLines.push('=============')
    for (const file of changedFiles) {
      promptLines.push(`- ${file}`)
    }
    promptLines.push('')

    // Git capabilities section
    promptLines.push('GIT CAPABILITIES')
    promptLines.push('================')
    promptLines.push('You are running in a git repository with full access to:')
    promptLines.push('- git diff, git show, git log for understanding changes')
    promptLines.push('- git blame for code ownership context')
    promptLines.push('- All project files for architectural understanding')
    promptLines.push('- Use these tools to provide comprehensive review')
    promptLines.push('')

    promptLines.push('Focus your review on the changed files listed above, but feel free to')
    promptLines.push('examine related files, tests, and project structure as needed.')

    return promptLines.join('\n')
  })
