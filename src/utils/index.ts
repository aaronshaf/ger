/**
 * Utility functions for working with Gerrit
 * @module utils
 */

// Change ID utilities
export {
  normalizeChangeIdentifier,
  isChangeId,
  isChangeNumber,
  isValidChangeIdentifier,
  getIdentifierType,
} from './change-id'

// Git commit utilities
export {
  extractChangeIdFromCommitMessage,
  getLastCommitMessage,
  getChangeIdFromHead,
  GitError,
  NoChangeIdError,
} from './git-commit'

// URL parsing
export {
  extractChangeNumber,
  normalizeGerritHost,
  isValidChangeId,
} from './url-parser'

// Message filtering
export { filterMeaningfulMessages, sortMessagesByDate } from './message-filters'

// Shell safety
export { sanitizeCDATA } from './shell-safety'

// Formatters
export {
  formatDate,
  getStatusIndicator,
  colors,
} from './formatters'

export {
  formatCommentsPretty,
  formatCommentsXml,
  type CommentWithContext,
} from './comment-formatters'

export {
  formatDiffPretty,
  formatDiffSummary,
  formatFilesList,
  extractDiffStats,
} from './diff-formatters'
