import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'
import { GitError, NoChangeIdError, getChangeIdFromHead } from '@/utils/git-commit'
import { escapeXML, sanitizeCDATA } from '@/utils/shell-safety'

const MAGIC_FILES = new Set(['/COMMIT_MSG', '/MERGE_LIST', '/PATCHSET_LEVEL'])

interface FilesOptions {
  xml?: boolean
  json?: boolean
}

export const filesCommand = (
  changeId?: string,
  options: FilesOptions = {},
): Effect.Effect<void, never, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService
    const resolvedChangeId = changeId || (yield* getChangeIdFromHead())

    const filesRecord = yield* gerritApi.getFiles(resolvedChangeId)
    const files = Object.entries(filesRecord)
      .filter(([path]) => !MAGIC_FILES.has(path))
      .map(([path, info]) => ({
        path,
        status: info.status ?? 'M',
        lines_inserted: info.lines_inserted ?? 0,
        lines_deleted: info.lines_deleted ?? 0,
      }))

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            status: 'success',
            change_id: resolvedChangeId,
            files,
          },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<files_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <change_id><![CDATA[${sanitizeCDATA(resolvedChangeId)}]]></change_id>`)
      console.log(`  <files>`)
      for (const file of files) {
        console.log(`    <file>`)
        console.log(`      <path><![CDATA[${sanitizeCDATA(file.path)}]]></path>`)
        console.log(`      <status>${escapeXML(file.status)}</status>`)
        console.log(`      <lines_inserted>${file.lines_inserted}</lines_inserted>`)
        console.log(`      <lines_deleted>${file.lines_deleted}</lines_deleted>`)
        console.log(`    </file>`)
      }
      console.log(`  </files>`)
      console.log(`</files_result>`)
    } else {
      for (const file of files) {
        console.log(`${file.status} ${file.path}`)
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
          console.log(`<files_result>`)
          console.log(`  <status>error</status>`)
          console.log(`  <error><![CDATA[${sanitizeCDATA(errorMessage)}]]></error>`)
          console.log(`</files_result>`)
        } else {
          console.error(`✗ Error: ${errorMessage}`)
        }
        process.exit(1)
      }),
    ),
  )
