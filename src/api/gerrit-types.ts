import { Schema } from '@effect/schema'
import type { Effect } from 'effect'
import type {
  ChangeInfo,
  CommentInfo,
  MessageInfo,
  DiffOptions,
  FileDiffContent,
  FileInfo,
  ProjectInfo,
  ReviewInput,
  ReviewerInput,
  ReviewerResult,
  RevisionInfo,
  SubmitInfo,
  GroupInfo,
  GroupDetailInfo,
  AccountInfo,
} from '@/schemas/gerrit'
import type { ReviewerListItem } from '@/schemas/reviewer'

export interface ApiErrorFields {
  readonly message: string
  readonly status?: number
}

const ApiErrorSchema = Schema.TaggedError<ApiErrorFields>()('ApiError', {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
} as const) as unknown

export class ApiError
  extends (ApiErrorSchema as new (
    args: ApiErrorFields,
  ) => ApiErrorFields & Error & { readonly _tag: 'ApiError' })
  implements Error
{
  readonly name = 'ApiError'
}

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
    options?: { base?: string; allowConflicts?: boolean },
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
  readonly getReviewers: (changeId: string) => Effect.Effect<readonly ReviewerListItem[], ApiError>
  readonly removeReviewer: (
    changeId: string,
    accountId: string,
    options?: { notify?: 'NONE' | 'OWNER' | 'OWNER_REVIEWERS' | 'ALL' },
  ) => Effect.Effect<void, ApiError>
  readonly getTopic: (changeId: string) => Effect.Effect<string | null, ApiError>
  readonly setTopic: (changeId: string, topic: string) => Effect.Effect<string, ApiError>
  readonly deleteTopic: (changeId: string) => Effect.Effect<void, ApiError>
  readonly setReady: (changeId: string, message?: string) => Effect.Effect<void, ApiError>
  readonly setWip: (changeId: string, message?: string) => Effect.Effect<void, ApiError>
  readonly fetchMergedChanges: (options: {
    after: string
    before?: string
    repo?: string
    maxResults?: number
  }) => Effect.Effect<readonly ChangeInfo[], ApiError>
}
