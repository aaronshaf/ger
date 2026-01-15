# ADR 0015: Batch Comment Processing

## Status

Accepted

## Context

AI tools generate multiple inline comments at once. We need to post them efficiently rather than one-by-one.

## Decision

Accept JSON array input for bulk inline comments with schema validation.

## Rationale

- **AI integration**: AI tools output structured comment lists
- **Efficiency**: Single API call for multiple comments
- **Validation**: Schema ensures correct format before posting
- **Features**: Support ranges, sides, resolution state

## Comment Schema

```typescript
interface InlineComment {
  file: string           // File path
  line?: number          // Single line
  range?: {              // Or line range
    start_line: number
    end_line: number
    start_character?: number
    end_character?: number
  }
  message: string        // Comment text
  side?: 'PARENT' | 'REVISION'  // Which side of diff
  unresolved?: boolean   // Mark as unresolved
}
```

## Consequences

### Positive
- One API call for many comments
- Full Gerrit comment features
- Piped input from AI tools
- Schema validation catches errors early

### Negative
- JSON format is verbose
- Must handle malformed input gracefully
- Range calculations can be complex

## Implementation

```typescript
// src/cli/commands/comment.ts
export const postBatchComments = (changeId: string, comments: InlineComment[]) =>
  Effect.gen(function* () {
    const api = yield* GerritApiService

    // Group by file
    const byFile: Record<string, CommentInput[]> = {}
    for (const comment of comments) {
      const input: CommentInput = {
        message: comment.message,
        line: comment.line,
        range: comment.range,
        side: comment.side,
        unresolved: comment.unresolved ?? true,
      }
      byFile[comment.file] ??= []
      byFile[comment.file].push(input)
    }

    // Post all at once
    yield* api.postReview(changeId, { comments: byFile })
  })
```

## Usage Examples

```bash
# From file
cat comments.json | ger comment 12345

# From AI tool
llm "Review this diff, output JSON comments" < diff.txt | ger comment 12345

# Inline JSON
echo '[{"file":"src/index.ts","line":42,"message":"Consider null check"}]' | ger comment 12345
```

## Validation

```typescript
const InlineCommentSchema = Schema.Struct({
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  range: Schema.optional(Schema.Struct({
    start_line: Schema.Number,
    end_line: Schema.Number,
    start_character: Schema.optional(Schema.Number),
    end_character: Schema.optional(Schema.Number),
  })),
  message: Schema.String,
  side: Schema.optional(Schema.Literal('PARENT', 'REVISION')),
  unresolved: Schema.optional(Schema.Boolean),
})

const CommentsArraySchema = Schema.Array(InlineCommentSchema)
```
