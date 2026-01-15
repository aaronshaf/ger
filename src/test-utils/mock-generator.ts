import type { Schema } from '@effect/schema'
import type { ChangeInfo, FileDiffContent, FileInfo } from '@/schemas/gerrit'

export const generateMockChange = (
  overrides?: Partial<Schema.Schema.Type<typeof ChangeInfo>>,
): Schema.Schema.Type<typeof ChangeInfo> => {
  const base: Schema.Schema.Type<typeof ChangeInfo> = {
    id: 'myProject~master~I8473b95934b5732ac55d26311a706c9c2bde9940',
    project: 'myProject',
    branch: 'master',
    change_id: 'I8473b95934b5732ac55d26311a706c9c2bde9940',
    subject: 'Implementing new feature',
    status: 'NEW' as const,
    created: '2023-12-01 10:00:00.000000000',
    updated: '2023-12-01 15:30:00.000000000',
    insertions: 25,
    deletions: 3,
    _number: 12345,
    owner: {
      _account_id: 1000096,
      name: 'John Developer',
      email: 'john@example.com',
      username: 'jdeveloper',
    },
  }

  return { ...base, ...overrides }
}

export const generateMockFiles = (): Record<string, Schema.Schema.Type<typeof FileInfo>> => {
  return {
    'src/main.ts': {
      status: 'M' as const,
      lines_inserted: 15,
      lines_deleted: 3,
      size_delta: 120,
      size: 1200,
    },
    'tests/main.test.ts': {
      status: 'A' as const,
      lines_inserted: 45,
      lines_deleted: 0,
      size_delta: 450,
      size: 450,
    },
  }
}

export const generateMockFileDiff = (): Schema.Schema.Type<typeof FileDiffContent> => {
  return {
    content: [
      {
        ab: ['function main() {', '  console.log("Hello, world!")'],
      },
      {
        a: ['  return 0'],
        b: ['  return process.exit(0)'],
      },
      {
        ab: ['}'],
      },
    ],
    change_type: 'MODIFIED' as const,
    diff_header: ['--- a/src/main.ts', '+++ b/src/main.ts'],
  }
}

export const generateMockAccount = () => ({
  _account_id: 1000096,
  name: 'Test User',
  email: 'test@example.com',
  username: 'testuser',
})

/**
 * Generate mock revision data to be included in ChangeInfo
 * Used when simulating API responses with CURRENT_REVISION option
 */
export const generateMockRevision = (
  patchsetNumber = 1,
  sha = '54795ce71b351480c887e92aa0e5b9a57aef58ab',
) => ({
  kind: 'REWORK',
  _number: patchsetNumber,
  created: '2023-12-01 10:00:00.000000000',
  uploader: {
    _account_id: 1000096,
    name: 'John Developer',
    email: 'john@example.com',
  },
  ref: `refs/changes/${String(Math.floor(12345 % 100)).padStart(2, '0')}/12345/${patchsetNumber}`,
  fetch: {
    http: {
      url: 'https://gerrit.example.com/myProject',
      ref: `refs/changes/${String(Math.floor(12345 % 100)).padStart(2, '0')}/12345/${patchsetNumber}`,
    },
  },
  commit: {
    commit: sha,
    parents: [
      {
        commit: 'parent-sha-1234567890abcdef',
        subject: 'Parent commit',
      },
    ],
    author: {
      name: 'John Developer',
      email: 'john@example.com',
      date: '2023-12-01 10:00:00.000000000',
    },
    committer: {
      name: 'John Developer',
      email: 'john@example.com',
      date: '2023-12-01 10:00:00.000000000',
    },
    subject: 'Implementing new feature',
    message: 'Implementing new feature\n\nThis is the full commit message.',
  },
})

/**
 * Generate mock change with revision data (simulates API response with CURRENT_REVISION option)
 */
export const generateMockChangeWithRevision = (
  overrides?: Partial<Schema.Schema.Type<typeof ChangeInfo>>,
  patchsetNumber = 1,
): Schema.Schema.Type<typeof ChangeInfo> => {
  const sha = '54795ce71b351480c887e92aa0e5b9a57aef58ab'
  const revision = generateMockRevision(patchsetNumber, sha)

  return generateMockChange({
    current_revision: sha,
    revisions: {
      [sha]: revision,
    },
    ...overrides,
  })
}
