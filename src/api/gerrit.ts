import { Schema } from '@effect/schema'
import { Context, Effect, Layer } from 'effect'
import {
  ChangeInfo,
  CommentInfo,
  MessageInfo,
  type DiffOptions,
  FileDiffContent,
  FileInfo,
  type GerritCredentials,
  ProjectInfo,
  type ReviewInput,
  type ReviewerInput,
  ReviewerResult,
  RevisionInfo,
  SubmitInfo,
  GroupInfo,
  GroupDetailInfo,
  AccountInfo,
} from '@/schemas/gerrit'
import { filterMeaningfulMessages } from '@/utils/message-filters'
import { ConfigService } from '@/services/config'
import { normalizeChangeIdentifier } from '@/utils/change-id'

export interface GerritApiServiceImpl {
  readonly getChange: (changeId: string) => Effect.Effect<ChangeInfo, ApiError>
  readonly listChanges: (query?: string) => Effect.Effect<readonly ChangeInfo[], ApiError>
  readonly listProjects: (options?: {
    pattern?: string
  }) => Effect.Effect<readonly ProjectInfo[], ApiError>
  readonly postReview: (changeId: string, review: ReviewInput) => Effect.Effect<void, ApiError>
  readonly abandonChange: (changeId: string, message?: string) => Effect.Effect<void, ApiError>
  readonly restoreChange: (
    changeId: string,
    message?: string,
  ) => Effect.Effect<ChangeInfo, ApiError>
  readonly rebaseChange: (
    changeId: string,
    options?: { base?: string },
  ) => Effect.Effect<ChangeInfo, ApiError>
  readonly submitChange: (changeId: string) => Effect.Effect<SubmitInfo, ApiError>
  readonly testConnection: Effect.Effect<boolean, ApiError>
  readonly getRevision: (
    changeId: string,
    revisionId?: string,
  ) => Effect.Effect<RevisionInfo, ApiError>
  readonly getFiles: (
    changeId: string,
    revisionId?: string,
  ) => Effect.Effect<Record<string, FileInfo>, ApiError>
  readonly getFileDiff: (
    changeId: string,
    filePath: string,
    revisionId?: string,
    base?: string,
  ) => Effect.Effect<FileDiffContent, ApiError>
  readonly getFileContent: (
    changeId: string,
    filePath: string,
    revisionId?: string,
  ) => Effect.Effect<string, ApiError>
  readonly getPatch: (changeId: string, revisionId?: string) => Effect.Effect<string, ApiError>
  readonly getDiff: (
    changeId: string,
    options?: DiffOptions,
  ) => Effect.Effect<string | string[] | Record<string, unknown> | FileDiffContent, ApiError>
  readonly getComments: (
    changeId: string,
    revisionId?: string,
  ) => Effect.Effect<Record<string, readonly CommentInfo[]>, ApiError>
  readonly getMessages: (changeId: string) => Effect.Effect<readonly MessageInfo[], ApiError>
  readonly addReviewer: (
    changeId: string,
    reviewer: string,
    options?: { state?: 'REVIEWER' | 'CC'; notify?: 'NONE' | 'OWNER' | 'OWNER_REVIEWERS' | 'ALL' },
  ) => Effect.Effect<ReviewerResult, ApiError>
  readonly listGroups: (options?: {
    owned?: boolean
    project?: string
    user?: string
    pattern?: string
    limit?: number
    skip?: number
  }) => Effect.Effect<readonly GroupInfo[], ApiError>
  readonly getGroup: (groupId: string) => Effect.Effect<GroupInfo, ApiError>
  readonly getGroupDetail: (groupId: string) => Effect.Effect<GroupDetailInfo, ApiError>
  readonly getGroupMembers: (groupId: string) => Effect.Effect<readonly AccountInfo[], ApiError>
}

// Export both the tag value and the type for use in Effect requirements
export const GerritApiService: Context.Tag<GerritApiServiceImpl, GerritApiServiceImpl> =
  Context.GenericTag<GerritApiServiceImpl>('GerritApiService')
export type GerritApiService = Context.Tag.Identifier<typeof GerritApiService>

// Export ApiError fields interface explicitly
export interface ApiErrorFields {
  readonly message: string
  readonly status?: number
}

// Define error schema (not exported, so type can be implicit)
const ApiErrorSchema = Schema.TaggedError<ApiErrorFields>()('ApiError', {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
} as const) as unknown

// Export the error class with explicit constructor signature for isolatedDeclarations
export class ApiError
  extends (ApiErrorSchema as new (
    args: ApiErrorFields,
  ) => ApiErrorFields & Error & { readonly _tag: 'ApiError' })
  implements Error
{
  readonly name = 'ApiError'
}

const createAuthHeader = (credentials: GerritCredentials): string => {
  const auth = btoa(`${credentials.username}:${credentials.password}`)
  return `Basic ${auth}`
}

const makeRequest = <T = unknown>(
  url: string,
  authHeader: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  schema?: Schema.Schema<T>,
): Effect.Effect<T, ApiError> =>
  Effect.gen(function* () {
    const headers: Record<string, string> = {
      Authorization: authHeader,
    }

    if (body) {
      headers['Content-Type'] = 'application/json'
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method,
          headers,
          ...(method !== 'GET' && body ? { body: JSON.stringify(body) } : {}),
        }),
      catch: () => new ApiError({ message: 'Request failed - network or authentication error' }),
    })

    if (!response.ok) {
      const errorText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => 'Unknown error',
      }).pipe(Effect.orElseSucceed(() => 'Unknown error'))
      yield* Effect.fail(
        new ApiError({
          message: errorText,
          status: response.status,
        }),
      )
    }

    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: () => new ApiError({ message: 'Failed to read response data' }),
    })

    // Gerrit returns JSON with )]}' prefix for security
    const cleanJson = text.replace(/^\)\]\}'\n?/, '')

    if (!cleanJson.trim()) {
      // Empty response - return empty object for endpoints that expect void
      return {} as T
    }

    const parsed = yield* Effect.try({
      try: () => JSON.parse(cleanJson),
      catch: () => new ApiError({ message: 'Failed to parse response - invalid JSON format' }),
    })

    if (schema) {
      return yield* Schema.decodeUnknown(schema)(parsed).pipe(
        Effect.mapError(() => new ApiError({ message: 'Invalid response format from server' })),
      )
    }

    // When no schema is provided, the caller expects void or doesn't care about the response
    return parsed
  })

export const GerritApiServiceLive: Layer.Layer<GerritApiService, never, ConfigService> =
  Layer.effect(
    GerritApiService,
    Effect.gen(function* () {
      const configService = yield* ConfigService

      const getCredentialsAndAuth = Effect.gen(function* () {
        const credentials = yield* configService.getCredentials.pipe(
          Effect.mapError(() => new ApiError({ message: 'Failed to get credentials' })),
        )
        // Ensure host doesn't have trailing slash
        const normalizedCredentials = {
          ...credentials,
          host: credentials.host.replace(/\/$/, ''),
        }
        const authHeader = createAuthHeader(normalizedCredentials)
        return { credentials: normalizedCredentials, authHeader }
      })

      // Helper to normalize and validate change identifier
      const normalizeAndValidate = (changeId: string): Effect.Effect<string, ApiError> =>
        Effect.try({
          try: () => normalizeChangeIdentifier(changeId),
          catch: (error) =>
            new ApiError({
              message: error instanceof Error ? error.message : String(error),
            }),
        })

      const getChange = (changeId: string) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}?o=CURRENT_REVISION&o=CURRENT_COMMIT`
          return yield* makeRequest(url, authHeader, 'GET', undefined, ChangeInfo)
        })

      const listChanges = (query = 'is:open') =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const encodedQuery = encodeURIComponent(query)
          // Add additional options to get detailed information
          const url = `${credentials.host}/a/changes/?q=${encodedQuery}&o=LABELS&o=DETAILED_LABELS&o=DETAILED_ACCOUNTS&o=SUBMITTABLE`
          return yield* makeRequest(url, authHeader, 'GET', undefined, Schema.Array(ChangeInfo))
        })

      const listProjects = (options?: { pattern?: string }) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          let url = `${credentials.host}/a/projects/`
          if (options?.pattern) {
            url += `?p=${encodeURIComponent(options.pattern)}`
          }
          // Gerrit returns projects as a Record, need to convert to array
          const projectsRecord = yield* makeRequest(
            url,
            authHeader,
            'GET',
            undefined,
            Schema.Record({ key: Schema.String, value: ProjectInfo }),
          )
          // Convert Record to Array and sort alphabetically by name
          return Object.values(projectsRecord).sort((a, b) => a.name.localeCompare(b.name))
        })

      const postReview = (changeId: string, review: ReviewInput) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/revisions/current/review`
          yield* makeRequest(url, authHeader, 'POST', review)
        })

      const abandonChange = (changeId: string, message?: string) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/abandon`
          const body = message ? { message } : {}
          yield* makeRequest(url, authHeader, 'POST', body)
        })

      const restoreChange = (changeId: string, message?: string) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/restore`
          const body = message ? { message } : {}
          return yield* makeRequest(url, authHeader, 'POST', body, ChangeInfo)
        })

      const rebaseChange = (changeId: string, options?: { base?: string }) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/revisions/current/rebase`
          const body = options?.base ? { base: options.base } : {}
          return yield* makeRequest(url, authHeader, 'POST', body, ChangeInfo)
        })

      const submitChange = (changeId: string) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/submit`
          return yield* makeRequest(url, authHeader, 'POST', {}, SubmitInfo)
        })

      const testConnection = Effect.gen(function* () {
        const { credentials, authHeader } = yield* getCredentialsAndAuth
        const url = `${credentials.host}/a/accounts/self`
        yield* makeRequest(url, authHeader)
        return true
      }).pipe(
        Effect.catchAll((error) => {
          // Log the actual error for debugging
          if (process.env.DEBUG) {
            console.error('Connection error:', error)
          }
          return Effect.succeed(false)
        }),
      )

      const getRevision = (changeId: string, revisionId = 'current') =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/revisions/${revisionId}`
          return yield* makeRequest(url, authHeader, 'GET', undefined, RevisionInfo)
        })

      const getFiles = (changeId: string, revisionId = 'current') =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/revisions/${revisionId}/files`
          return yield* makeRequest(
            url,
            authHeader,
            'GET',
            undefined,
            Schema.Record({ key: Schema.String, value: FileInfo }),
          )
        })

      const getFileDiff = (
        changeId: string,
        filePath: string,
        revisionId = 'current',
        base?: string,
      ) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          let url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/revisions/${revisionId}/files/${encodeURIComponent(filePath)}/diff`
          if (base) {
            url += `?base=${encodeURIComponent(base)}`
          }
          return yield* makeRequest(url, authHeader, 'GET', undefined, FileDiffContent)
        })

      const getFileContent = (changeId: string, filePath: string, revisionId = 'current') =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/revisions/${revisionId}/files/${encodeURIComponent(filePath)}/content`

          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(url, {
                method: 'GET',
                headers: { Authorization: authHeader },
              }),
            catch: () =>
              new ApiError({ message: 'Request failed - network or authentication error' }),
          })

          if (!response.ok) {
            const errorText = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: () => 'Unknown error',
            }).pipe(Effect.orElseSucceed(() => 'Unknown error'))

            yield* Effect.fail(
              new ApiError({
                message: errorText,
                status: response.status,
              }),
            )
          }

          const base64Content = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: () => new ApiError({ message: 'Failed to read response data' }),
          })

          return yield* Effect.try({
            try: () => atob(base64Content),
            catch: () => new ApiError({ message: 'Failed to decode file content' }),
          })
        })

      const getPatch = (changeId: string, revisionId = 'current') =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/revisions/${revisionId}/patch`

          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(url, {
                method: 'GET',
                headers: { Authorization: authHeader },
              }),
            catch: () =>
              new ApiError({ message: 'Request failed - network or authentication error' }),
          })

          if (!response.ok) {
            const errorText = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: () => 'Unknown error',
            }).pipe(Effect.orElseSucceed(() => 'Unknown error'))

            yield* Effect.fail(
              new ApiError({
                message: errorText,
                status: response.status,
              }),
            )
          }

          const base64Patch = yield* Effect.tryPromise({
            try: () => response.text(),
            catch: () => new ApiError({ message: 'Failed to read response data' }),
          })

          return yield* Effect.try({
            try: () => atob(base64Patch),
            catch: () => new ApiError({ message: 'Failed to decode patch data' }),
          })
        })

      const getDiff = (changeId: string, options: DiffOptions = {}) =>
        Effect.gen(function* () {
          const format = options.format || 'unified'
          const revisionId = options.patchset ? `${options.patchset}` : 'current'

          if (format === 'files') {
            const files = yield* getFiles(changeId, revisionId)
            return Object.keys(files)
          }

          if (options.file) {
            if (format === 'json') {
              const diff = yield* getFileDiff(
                changeId,
                options.file,
                revisionId,
                options.base ? `${options.base}` : undefined,
              )
              return diff
            } else {
              const diff = yield* getFileDiff(
                changeId,
                options.file,
                revisionId,
                options.base ? `${options.base}` : undefined,
              )
              return convertToUnifiedDiff(diff, options.file)
            }
          }

          if (options.fullFiles) {
            const files = yield* getFiles(changeId, revisionId)
            const result: Record<string, string> = {}

            for (const [filePath, _fileInfo] of Object.entries(files)) {
              if (filePath === '/COMMIT_MSG' || filePath === '/MERGE_LIST') continue

              const content = yield* getFileContent(changeId, filePath, revisionId).pipe(
                Effect.catchAll(() => Effect.succeed('Binary file or permission denied')),
              )
              result[filePath] = content
            }

            return format === 'json'
              ? result
              : Object.entries(result)
                  .map(([path, content]) => `=== ${path} ===\n${content}\n`)
                  .join('\n')
          }

          if (format === 'json') {
            const files = yield* getFiles(changeId, revisionId)
            return files
          }

          return yield* getPatch(changeId, revisionId)
        })

      const convertToUnifiedDiff = (diff: FileDiffContent, filePath: string): string => {
        const lines: string[] = []

        if (diff.diff_header) {
          lines.push(...diff.diff_header)
        } else {
          lines.push(`--- a/${filePath}`)
          lines.push(`+++ b/${filePath}`)
        }

        for (const section of diff.content) {
          if (section.ab) {
            for (const line of section.ab) {
              lines.push(` ${line}`)
            }
          }

          if (section.a) {
            for (const line of section.a) {
              lines.push(`-${line}`)
            }
          }

          if (section.b) {
            for (const line of section.b) {
              lines.push(`+${line}`)
            }
          }
        }

        return lines.join('\n')
      }

      const getComments = (changeId: string, revisionId = 'current') =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/revisions/${revisionId}/comments`
          return yield* makeRequest(
            url,
            authHeader,
            'GET',
            undefined,
            Schema.Record({ key: Schema.String, value: Schema.Array(CommentInfo) }),
          )
        })

      const getMessages = (changeId: string) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}?o=MESSAGES`
          const response = yield* makeRequest(url, authHeader, 'GET')

          // Extract messages from the change response with runtime validation
          const changeResponse = yield* Schema.decodeUnknown(
            Schema.Struct({
              messages: Schema.optional(Schema.Array(MessageInfo)),
            }),
          )(response).pipe(
            Effect.mapError(
              () => new ApiError({ message: 'Invalid messages response format from server' }),
            ),
          )

          return changeResponse.messages || []
        }).pipe(Effect.map(filterMeaningfulMessages))

      const addReviewer = (
        changeId: string,
        reviewer: string,
        options?: {
          state?: 'REVIEWER' | 'CC'
          notify?: 'NONE' | 'OWNER' | 'OWNER_REVIEWERS' | 'ALL'
        },
      ) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const normalized = yield* normalizeAndValidate(changeId)
          const url = `${credentials.host}/a/changes/${encodeURIComponent(normalized)}/reviewers`
          const body: ReviewerInput = {
            reviewer,
            ...(options?.state && { state: options.state }),
            ...(options?.notify && { notify: options.notify }),
          }
          return yield* makeRequest(url, authHeader, 'POST', body, ReviewerResult)
        })

      const listGroups = (options?: {
        owned?: boolean
        project?: string
        user?: string
        pattern?: string
        limit?: number
        skip?: number
      }) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          let url = `${credentials.host}/a/groups/`
          const params: string[] = []

          if (options?.owned) {
            params.push('owned')
          }
          if (options?.project) {
            params.push(`p=${encodeURIComponent(options.project)}`)
          }
          if (options?.user) {
            params.push(`user=${encodeURIComponent(options.user)}`)
          }
          if (options?.pattern) {
            params.push(`r=${encodeURIComponent(options.pattern)}`)
          }
          if (options?.limit) {
            params.push(`n=${options.limit}`)
          }
          if (options?.skip) {
            params.push(`S=${options.skip}`)
          }

          if (params.length > 0) {
            url += `?${params.join('&')}`
          }

          // Gerrit returns groups as a Record, need to convert to array
          const groupsRecord = yield* makeRequest(
            url,
            authHeader,
            'GET',
            undefined,
            Schema.Record({ key: Schema.String, value: GroupInfo }),
          )
          // Convert Record to Array and sort alphabetically by name
          return Object.values(groupsRecord).sort((a, b) => {
            const aName = a.name || a.id
            const bName = b.name || b.id
            return aName.localeCompare(bName)
          })
        })

      const getGroup = (groupId: string) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const url = `${credentials.host}/a/groups/${encodeURIComponent(groupId)}`
          return yield* makeRequest(url, authHeader, 'GET', undefined, GroupInfo)
        })

      const getGroupDetail = (groupId: string) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const url = `${credentials.host}/a/groups/${encodeURIComponent(groupId)}/detail`
          return yield* makeRequest(url, authHeader, 'GET', undefined, GroupDetailInfo)
        })

      const getGroupMembers = (groupId: string) =>
        Effect.gen(function* () {
          const { credentials, authHeader } = yield* getCredentialsAndAuth
          const url = `${credentials.host}/a/groups/${encodeURIComponent(groupId)}/members/`
          return yield* makeRequest(url, authHeader, 'GET', undefined, Schema.Array(AccountInfo))
        })

      return {
        getChange,
        listChanges,
        listProjects,
        postReview,
        abandonChange,
        restoreChange,
        rebaseChange,
        submitChange,
        testConnection,
        getRevision,
        getFiles,
        getFileDiff,
        getFileContent,
        getPatch,
        getDiff,
        getComments,
        getMessages,
        addReviewer,
        listGroups,
        getGroup,
        getGroupDetail,
        getGroupMembers,
      }
    }),
  )
