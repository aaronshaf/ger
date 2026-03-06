import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { GitError, NoChangeIdError, getChangeIdFromHead } from '@/utils/git-commit'
import { sanitizeCDATA } from '@/utils/shell-safety'
import type { ReviewerListItem } from '@/schemas/reviewer'

interface ReviewersOptions {
  xml?: boolean
  json?: boolean
}

function formatReviewer(r: ReviewerListItem): string {
  const name =
    r.name ?? r.username ?? (r._account_id !== undefined ? `#${r._account_id}` : undefined)
  if (name !== undefined) return r.email ? `${name} <${r.email}>` : name
  return r.email ?? 'unknown'
}

export const reviewersCommand = (
  changeId?: string,
  options: ReviewersOptions = {},
): Effect.Effect<void, never, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService
    const resolvedChangeId = changeId || (yield* getChangeIdFromHead())

    const reviewers = yield* gerritApi.getReviewers(resolvedChangeId)

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            change_id: resolvedChangeId,
            reviewers: reviewers.map((r) => ({
              ...(r._account_id !== undefined ? { account_id: r._account_id } : {}),
              name: r.name,
              email: r.email,
              username: r.username,
            })),
          },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<reviewers_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <change_id><![CDATA[${sanitizeCDATA(resolvedChangeId)}]]></change_id>`)
      console.log(`  <reviewers>`)
      for (const r of reviewers) {
        console.log(`    <reviewer>`)
        if (r._account_id !== undefined)
          console.log(`      <account_id>${r._account_id}</account_id>`)
        if (r.name) console.log(`      <name><![CDATA[${sanitizeCDATA(r.name)}]]></name>`)
        if (r.email) console.log(`      <email><![CDATA[${sanitizeCDATA(r.email)}]]></email>`)
        if (r.username)
          console.log(`      <username><![CDATA[${sanitizeCDATA(r.username)}]]></username>`)
        console.log(`    </reviewer>`)
      }
      console.log(`  </reviewers>`)
      console.log(`</reviewers_result>`)
    } else {
      if (reviewers.length === 0) {
        console.log('No reviewers')
      } else {
        for (const r of reviewers) {
          console.log(formatReviewer(r))
        }
      }
    }
  }).pipe(
    Effect.catchAll((error: ApiError | GitError | NoChangeIdError) =>
      Effect.sync(() => {
        const errorMessage =
          error instanceof GitError || error instanceof NoChangeIdError || error instanceof Error
            ? error.message
            : String(error)

        if (options.json) {
          console.log(JSON.stringify({ status: 'error', error: errorMessage }, null, 2))
        } else if (options.xml) {
          console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
          console.log(`<reviewers_result>`)
          console.log(`  <status>error</status>`)
          console.log(`  <error><![CDATA[${sanitizeCDATA(errorMessage)}]]></error>`)
          console.log(`</reviewers_result>`)
        } else {
          console.error(`✗ Error: ${errorMessage}`)
        }
        process.exit(1)
      }),
    ),
  )
