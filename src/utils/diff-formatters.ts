import { colors } from './formatters'
import type { FileDiffContent } from '@/schemas/gerrit'

interface DiffStats {
  additions: number
  deletions: number
  files: number
}

/**
 * Format a unified diff for pretty human-readable output
 */
export const formatDiffPretty = (diffContent: string): string => {
  if (!diffContent || typeof diffContent !== 'string') {
    const emptyStats = { additions: 0, deletions: 0, files: 0 }
    return formatDiffSummary(emptyStats) + '\n\n' + 'No diff content available'
  }

  const lines = diffContent.split('\n')
  const formattedLines: string[] = []
  let stats: DiffStats = { additions: 0, deletions: 0, files: 0 }

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      stats.files++
      // File header with colors
      formattedLines.push(`${colors.bold}${colors.blue}${line}${colors.reset}`)
    } else if (line.startsWith('index ')) {
      // Index line
      formattedLines.push(`${colors.dim}${line}${colors.reset}`)
    } else if (line.startsWith('---')) {
      // Old file marker
      formattedLines.push(`${colors.red}${line}${colors.reset}`)
    } else if (line.startsWith('+++')) {
      // New file marker
      formattedLines.push(`${colors.green}${line}${colors.reset}`)
    } else if (line.startsWith('@@')) {
      // Hunk header
      formattedLines.push(`${colors.cyan}${line}${colors.reset}`)
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      // Added lines
      stats.additions++
      formattedLines.push(`${colors.green}${line}${colors.reset}`)
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Removed lines
      stats.deletions++
      formattedLines.push(`${colors.red}${line}${colors.reset}`)
    } else if (line.startsWith(' ')) {
      // Context lines
      formattedLines.push(`${colors.dim}${line}${colors.reset}`)
    } else {
      // Other lines (usually empty or metadata)
      formattedLines.push(line)
    }
  }

  // Add summary at the top
  const summary = formatDiffSummary(stats)

  return summary + '\n\n' + formattedLines.join('\n')
}

/**
 * Format diff summary statistics
 */
export const formatDiffSummary = (stats: DiffStats): string => {
  const { additions, deletions, files } = stats
  const total = additions + deletions

  let summary = `${colors.bold}Changes summary:${colors.reset} `

  if (files > 0) {
    summary += `${files} file${files !== 1 ? 's' : ''} changed`
  }

  if (additions > 0 || deletions > 0) {
    if (files > 0) summary += ', '

    if (additions > 0) {
      summary += `${colors.green}+${additions} addition${additions !== 1 ? 's' : ''}${colors.reset}`
    }

    if (additions > 0 && deletions > 0) {
      summary += ', '
    }

    if (deletions > 0) {
      summary += `${colors.red}-${deletions} deletion${deletions !== 1 ? 's' : ''}${colors.reset}`
    }
  }

  if (total === 0 && files === 0) {
    summary += 'No changes detected'
  }

  return summary
}

/**
 * Format a list of changed files for pretty output
 */
export const formatFilesList = (files: string[]): string => {
  if (!files || files.length === 0) {
    return 'No files changed'
  }

  const header = `${colors.bold}Changed files (${files.length}):${colors.reset}\n`
  const fileList = files
    .map((file) => {
      // Simple file status indicators - we could enhance this if we had status info
      return `  ${colors.blue}•${colors.reset} ${file}`
    })
    .join('\n')

  return header + fileList
}

/**
 * Extract diff statistics from unified diff content
 */
export const extractDiffStats = (diffContent: string): DiffStats => {
  if (!diffContent || typeof diffContent !== 'string') {
    return { additions: 0, deletions: 0, files: 0 }
  }

  const lines = diffContent.split('\n')
  let additions = 0
  let deletions = 0
  let files = 0

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      files++
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++
    }
  }

  return { additions, deletions, files }
}

export const convertToUnifiedDiff = (diff: FileDiffContent, filePath: string): string => {
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
