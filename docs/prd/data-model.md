# Data Model

Schemas and data structures used throughout the application.

## Gerrit API Types

### ChangeInfo

Primary change representation from Gerrit API.

```typescript
const ChangeInfo = Schema.Struct({
  id: Schema.String,              // "project~branch~Change-Id"
  _number: Schema.Number,         // Numeric change ID
  project: Schema.String,         // Project name
  branch: Schema.String,          // Target branch
  topic: Schema.optional(Schema.String),
  subject: Schema.String,         // First line of commit message
  status: Schema.Literal('NEW', 'MERGED', 'ABANDONED', 'DRAFT'),
  created: Schema.String,         // ISO timestamp
  updated: Schema.String,         // ISO timestamp
  submitted: Schema.optional(Schema.String),
  submitter: Schema.optional(AccountInfo),
  owner: AccountInfo,
  current_revision: Schema.optional(Schema.String),
  revisions: Schema.optional(Schema.Record(Schema.String, RevisionInfo)),
  labels: Schema.optional(Schema.Record(Schema.String, LabelInfo)),
  reviewers: Schema.optional(ReviewerMap),
  messages: Schema.optional(Schema.Array(ChangeMessage)),
  mergeable: Schema.optional(Schema.Boolean),
  insertions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
})
```

### AccountInfo

User account information.

```typescript
const AccountInfo = Schema.Struct({
  _account_id: Schema.Number,
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  display_name: Schema.optional(Schema.String),
})
```

### RevisionInfo

Patchset revision details.

```typescript
const RevisionInfo = Schema.Struct({
  _number: Schema.Number,         // Patchset number
  kind: Schema.Literal(
    'REWORK', 'TRIVIAL_REBASE', 'MERGE_FIRST_PARENT_UPDATE',
    'NO_CODE_CHANGE', 'NO_CHANGE'
  ),
  created: Schema.String,
  uploader: AccountInfo,
  ref: Schema.String,             // Git ref (refs/changes/xx/xxxxx/x)
  fetch: Schema.optional(Schema.Record(Schema.String, FetchInfo)),
  commit: Schema.optional(CommitInfo),
  files: Schema.optional(Schema.Record(Schema.String, FileInfo)),
})
```

### CommentInfo

Comment on a change.

```typescript
const CommentInfo = Schema.Struct({
  id: Schema.String,
  path: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  range: Schema.optional(CommentRange),
  message: Schema.String,
  author: AccountInfo,
  updated: Schema.String,
  side: Schema.optional(Schema.Literal('PARENT', 'REVISION')),
  unresolved: Schema.optional(Schema.Boolean),
  in_reply_to: Schema.optional(Schema.String),
})
```

### CommentRange

Line range for inline comments.

```typescript
const CommentRange = Schema.Struct({
  start_line: Schema.Number,
  start_character: Schema.Number,
  end_line: Schema.Number,
  end_character: Schema.Number,
})
```

### ChangeMessage

Message/event on a change.

```typescript
const ChangeMessage = Schema.Struct({
  id: Schema.String,
  author: Schema.optional(AccountInfo),
  date: Schema.String,
  message: Schema.String,
  tag: Schema.optional(Schema.String),
  _revision_number: Schema.optional(Schema.Number),
})
```

### LabelInfo

Voting label information.

```typescript
const LabelInfo = Schema.Struct({
  approved: Schema.optional(AccountInfo),
  rejected: Schema.optional(AccountInfo),
  recommended: Schema.optional(AccountInfo),
  disliked: Schema.optional(AccountInfo),
  value: Schema.optional(Schema.Number),
  default_value: Schema.optional(Schema.Number),
  all: Schema.optional(Schema.Array(ApprovalInfo)),
  values: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
```

### GroupInfo

Gerrit group information.

```typescript
const GroupInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.optional(Schema.String),
  options: Schema.optional(GroupOptions),
  description: Schema.optional(Schema.String),
  group_id: Schema.optional(Schema.Number),
  owner: Schema.optional(Schema.String),
  owner_id: Schema.optional(Schema.String),
  created_on: Schema.optional(Schema.String),
  members: Schema.optional(Schema.Array(AccountInfo)),
  includes: Schema.optional(Schema.Array(GroupInfo)),
})
```

## Configuration Schema

### AppConfig

Application configuration stored in `~/.ger/config.json`.

```typescript
const AppConfig = Schema.Struct({
  host: Schema.String,            // Gerrit server URL
  username: Schema.String,        // Gerrit username
  password: Schema.String,        // HTTP password/token
  aiTool: Schema.optional(Schema.String),      // Preferred AI tool
  aiAutoDetect: Schema.optional(Schema.Boolean), // Auto-detect AI tool
})
```

**File permissions:** 0600 (owner read/write only)

## API Input Types

### ReviewInput

Input for posting reviews/comments.

```typescript
const ReviewInput = Schema.Struct({
  message: Schema.optional(Schema.String),     // Overall comment
  labels: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  comments: Schema.optional(Schema.Record(
    Schema.String,  // file path
    Schema.Array(CommentInput)
  )),
  tag: Schema.optional(Schema.String),
  notify: Schema.optional(Schema.Literal('NONE', 'OWNER', 'OWNER_REVIEWERS', 'ALL')),
})
```

### CommentInput

Input for a single inline comment.

```typescript
const CommentInput = Schema.Struct({
  line: Schema.optional(Schema.Number),
  range: Schema.optional(CommentRange),
  message: Schema.String,
  side: Schema.optional(Schema.Literal('PARENT', 'REVISION')),
  unresolved: Schema.optional(Schema.Boolean),
  in_reply_to: Schema.optional(Schema.String),
})
```

### ReviewerInput

Input for adding reviewers.

```typescript
const ReviewerInput = Schema.Struct({
  reviewer: Schema.String,        // Username, email, or group
  state: Schema.optional(Schema.Literal('REVIEWER', 'CC')),
  notify: Schema.optional(Schema.Literal('NONE', 'OWNER', 'OWNER_REVIEWERS', 'ALL')),
})
```

## Internal Types

### BuildState

CI build status.

```typescript
type BuildState = 'pending' | 'running' | 'success' | 'failure' | 'not_found'
```

### InlineComment

CLI input format for batch comments.

```typescript
const InlineComment = Schema.Struct({
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  range: Schema.optional(CommentRange),
  message: Schema.String,
  side: Schema.optional(Schema.Literal('PARENT', 'REVISION')),
  unresolved: Schema.optional(Schema.Boolean),
})
```

### ChangeIdentifier

Normalized change identifier.

```typescript
// Accepts:
// - Numeric: "12345"
// - Change-ID: "If5a3ae8cb5a107e187447802358417f311d0c4b1"
// - Full triplet: "project~branch~Change-Id"
// - URL: "https://gerrit.example.com/c/project/+/12345"

const isChangeNumber = (id: string): boolean => /^\d+$/.test(id)
const isChangeId = (id: string): boolean => /^I[0-9a-f]{40}$/i.test(id)
```

## Error Types

### ApiError

API call failures.

```typescript
class ApiError extends Schema.TaggedError<ApiError>()('ApiError', {
  message: Schema.String,
  statusCode: Schema.Number,
  url: Schema.String,
}) {}
```

### ConfigError

Configuration issues.

```typescript
class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  message: Schema.String,
}) {}
```

### GitError

Git operation failures.

```typescript
class GitError extends Schema.TaggedError<GitError>()('GitError', {
  message: Schema.String,
  exitCode: Schema.Number,
}) {}
```

### NoChangeIdError

Missing Change-ID in commit.

```typescript
class NoChangeIdError extends Schema.TaggedError<NoChangeIdError>()('NoChangeIdError', {
  message: Schema.String,
}) {}
```

## Output Formats

### Text (Default)

Human-readable colored output:
```
Change 12345: Fix login bug
Project: canvas-lms
Branch: main
Status: NEW
Owner: alice@example.com

Files:
  M src/login.ts
  A src/auth.ts
```

### XML (--xml flag)

LLM-friendly structured output:
```xml
<change>
  <number>12345</number>
  <subject><![CDATA[Fix login bug]]></subject>
  <project>canvas-lms</project>
  <branch>main</branch>
  <status>NEW</status>
  <owner>alice@example.com</owner>
  <files>
    <file action="M">src/login.ts</file>
    <file action="A">src/auth.ts</file>
  </files>
</change>
```

### JSON

Programmatic consumption:
```json
{
  "_number": 12345,
  "subject": "Fix login bug",
  "project": "canvas-lms",
  "branch": "main",
  "status": "NEW"
}
```
