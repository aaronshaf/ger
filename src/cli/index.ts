#!/usr/bin/env bun

// Check Bun version requirement
const MIN_BUN_VERSION = '1.2.0'
const bunVersion = Bun.version

function compareSemver(a: string, b: string): number {
  const parseVersion = (v: string) => v.split('.').map((n) => parseInt(n, 10))
  const [aMajor, aMinor = 0, aPatch = 0] = parseVersion(a)
  const [bMajor, bMinor = 0, bPatch = 0] = parseVersion(b)

  if (aMajor !== bMajor) return aMajor - bMajor
  if (aMinor !== bMinor) return aMinor - bMinor
  return aPatch - bPatch
}

if (compareSemver(bunVersion, MIN_BUN_VERSION) < 0) {
  console.error(`✗ Error: Bun version ${MIN_BUN_VERSION} or higher is required`)
  console.error(`  Current version: ${bunVersion}`)
  console.error(`  Please upgrade Bun: bun upgrade`)
  process.exit(1)
}

import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerCommands } from './register-commands'

// Read version from package.json
function getVersion(): string {
  try {
    // Get the directory of the current module
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)

    // Navigate up to the project root and read package.json
    const packageJsonPath = join(__dirname, '..', '..', 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    return packageJson.version || '0.0.0'
  } catch {
    // Fallback version if package.json can't be read
    return '0.0.0'
  }
}

const program = new Command()

program.name('ger').description('Gerrit CLI tool').version(getVersion())

program.addHelpText(
  'after',
  `
CHANGE-ID FORMATS
  Accepts numeric change numbers (12345) or full Change-IDs (I1234abc...).
  Many commands auto-detect from HEAD commit's Change-Id footer when the
  argument is omitted.

OUTPUT FORMATS
  --json    Structured JSON output for programmatic consumption
  --xml     XML with CDATA-wrapped content, optimized for LLM consumption
  (default) Plain text for human reading
  Most commands support both --json and --xml.

PIPING / STDIN
  comment           Reads message from stdin if no -m flag is provided
  comment --batch   Reads a JSON array from stdin for bulk commenting

AUTO-DETECTION
  These commands auto-detect the change from HEAD's Change-Id footer when
  the change-id argument is omitted:
    show, build-status, topic, rebase, extract-url, diff, comments, vote

COMMON LLM WORKFLOWS
  Review a change:    ger show <id> → ger diff <id> → ger comments <id>
  Post a review:      ger comment <id> -m "..." → ger vote <id> <label> <score>
  Manage changes:     ger push, ger checkout <id>, ger abandon <id>, ger submit <id>
  WIP toggle:         ger set-wip <id>, ger set-ready <id> [-m "message"]
  Check CI:           ger build-status <id> --exit-status

EXIT CODES
  build-status --exit-status returns non-zero on build failure (useful for scripting).

SUBCOMMAND HELP
  Run ger <command> --help for detailed usage and examples.
`,
)

registerCommands(program)

program.parse(process.argv)
