/**
 * Utilities for handling Gerrit change identifiers
 * Supports both numeric change numbers (e.g., "392385") and Change-IDs (e.g., "If5a3ae8cb5a107e187447802358417f311d0c4b1")
 */

/**
 * Validates if a string is a valid Gerrit Change-ID format
 * Change-IDs start with 'I' followed by a 40-character SHA-1 hash
 */
export function isChangeId(value: string): boolean {
  return /^I[0-9a-f]{40}$/.test(value)
}

/**
 * Validates if a string is a numeric change number
 */
export function isChangeNumber(value: string): boolean {
  return /^\d+$/.test(value)
}

/**
 * Validates if a string is either a valid Change-ID or change number
 */
export function isValidChangeIdentifier(value: string): boolean {
  return isChangeId(value) || isChangeNumber(value)
}

/**
 * Normalizes a change identifier for use with Gerrit API
 * Gerrit API accepts both formats, so we just validate and return as-is
 *
 * @param value - Either a numeric change number or a Change-ID
 * @returns The normalized identifier
 * @throws Error if the identifier is invalid
 */
export function normalizeChangeIdentifier(value: string): string {
  const trimmed = value.trim()

  if (!isValidChangeIdentifier(trimmed)) {
    throw new Error(
      `Invalid change identifier: "${value}". Expected either a numeric change number (e.g., "392385") or a Change-ID starting with "I" (e.g., "If5a3ae8cb5a107e187447802358417f311d0c4b1")`,
    )
  }

  return trimmed
}

/**
 * Gets a user-friendly description of what type of identifier was provided
 */
export function getIdentifierType(value: string): 'change-number' | 'change-id' | 'invalid' {
  const trimmed = value.trim()

  if (isChangeNumber(trimmed)) {
    return 'change-number'
  }

  if (isChangeId(trimmed)) {
    return 'change-id'
  }

  return 'invalid'
}
