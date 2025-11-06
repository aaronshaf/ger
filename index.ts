/**
 * @aaronshaf/ger - Gerrit CLI and SDK
 *
 * This package provides both a CLI tool and a programmatic API for interacting with Gerrit Code Review.
 * Built with Effect-TS for type-safe, composable operations.
 *
 * @module
 *
 * @example Basic usage with Effect
 * ```typescript
 * import { Effect, pipe } from 'effect'
 * import {
 *   GerritApiService,
 *   GerritApiServiceLive,
 *   ConfigServiceLive,
 * } from '@aaronshaf/ger'
 *
 * const program = Effect.gen(function* () {
 *   const api = yield* GerritApiService
 *   const change = yield* api.getChange('12345')
 *   console.log(change.subject)
 * })
 *
 * const runnable = pipe(
 *   program,
 *   Effect.provide(GerritApiServiceLive),
 *   Effect.provide(ConfigServiceLive)
 * )
 *
 * Effect.runPromise(runnable)
 * ```
 */

// ============================================================================
// Core API Service
// ============================================================================

export {
  // Service tag and implementation
  GerritApiService,
  GerritApiServiceLive,
  // Types
  type GerritApiServiceImpl,
  // Errors
  ApiError,
  type ApiErrorFields,
} from './src/api/gerrit'

// ============================================================================
// Configuration Service
// ============================================================================

export {
  // Service tag and implementation
  ConfigService,
  ConfigServiceLive,
  // Types
  type ConfigServiceImpl,
  // Errors
  ConfigError,
  type ConfigErrorFields,
} from './src/services/config'

// ============================================================================
// Review Strategy Service
// ============================================================================

export {
  // Strategy types
  type ReviewStrategy,
  // Built-in strategies
  claudeCliStrategy,
  geminiCliStrategy,
  openCodeCliStrategy,
  // Service
  ReviewStrategyService,
  ReviewStrategyServiceLive,
  type ReviewStrategyServiceImpl,
  // Errors
  ReviewStrategyError,
  type ReviewStrategyErrorFields,
} from './src/services/review-strategy'

// ============================================================================
// Git Worktree Service
// ============================================================================

export {
  // Service tag and implementation
  GitWorktreeService,
  GitWorktreeServiceLive,
  type GitWorktreeServiceImpl,
  // Types
  type WorktreeInfo,
  // Errors
  WorktreeCreationError,
  type WorktreeCreationErrorFields,
  PatchsetFetchError,
  type PatchsetFetchErrorFields,
  DirtyRepoError,
  type DirtyRepoErrorFields,
  NotGitRepoError,
  type NotGitRepoErrorFields,
  type GitWorktreeError,
} from './src/services/git-worktree'

// ============================================================================
// Schemas and Types
// ============================================================================

export {
  // Authentication
  GerritCredentials,
  type GerritCredentials as GerritCredentialsType,
  // Changes
  ChangeInfo,
  type ChangeInfo as ChangeInfoType,
  // Comments
  CommentInput,
  type CommentInput as CommentInputType,
  CommentInfo,
  type CommentInfo as CommentInfoType,
  // Messages
  MessageInfo,
  type MessageInfo as MessageInfoType,
  // Reviews
  ReviewInput,
  type ReviewInput as ReviewInputType,
  // Files and Diffs
  FileInfo,
  type FileInfo as FileInfoType,
  FileDiffContent,
  type FileDiffContent as FileDiffContentType,
  RevisionInfo,
  type RevisionInfo as RevisionInfoType,
  // Diff Options
  DiffFormat,
  type DiffFormat as DiffFormatType,
  DiffOptions,
  type DiffOptions as DiffOptionsType,
  DiffCommandOptions,
  type DiffCommandOptions as DiffCommandOptionsType,
  // Errors
  GerritError,
  type GerritError as GerritErrorType,
} from './src/schemas/gerrit'

export {
  // Config schemas
  AppConfig,
  type AppConfig as AppConfigType,
  AiConfig,
  type AiConfig as AiConfigType,
  // Utilities
  aiConfigFromFlat,
  migrateFromNestedConfig,
} from './src/schemas/config'

// ============================================================================
// Utilities
// ============================================================================

export {
  // Change ID handling
  normalizeChangeIdentifier,
  isChangeId,
  isChangeNumber,
  isValidChangeIdentifier,
  getIdentifierType,
} from './src/utils/change-id'

export {
  // Git commit utilities
  extractChangeIdFromCommitMessage,
  getLastCommitMessage,
  getChangeIdFromHead,
  GitError,
  NoChangeIdError,
} from './src/utils/git-commit'

export {
  // URL parsing
  extractChangeNumber,
  normalizeGerritHost,
  isValidChangeId,
} from './src/utils/url-parser'

export {
  // Message filtering
  filterMeaningfulMessages,
  sortMessagesByDate,
} from './src/utils/message-filters'

export {
  // Shell safety
  sanitizeCDATA,
} from './src/utils/shell-safety'

export {
  // Formatters
  formatDate,
  getStatusIndicator,
  colors,
} from './src/utils/formatters'

export {
  // Comment formatters
  formatCommentsPretty,
  formatCommentsXml,
  type CommentWithContext,
} from './src/utils/comment-formatters'

export {
  // Diff formatters
  formatDiffPretty,
  formatDiffSummary,
  formatFilesList,
  extractDiffStats,
} from './src/utils/diff-formatters'
