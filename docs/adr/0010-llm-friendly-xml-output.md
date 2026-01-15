# ADR 0010: LLM-Friendly XML Output

## Status

Accepted

## Context

We want to integrate with AI tools (Claude, GPT, etc.) for automated code review and analysis. LLMs work better with structured, parseable output.

## Decision

Add `--xml` flag to all major commands that outputs structured XML with CDATA wrapping for special characters.

## Rationale

- **LLM consumption**: XML is well-understood by language models
- **Structured data**: Clear field separation vs prose
- **CDATA safety**: Handles special characters without escaping issues
- **Composability**: Pipe output to AI tools directly
- **Human readable**: XML is also readable by humans when needed

## Consequences

### Positive
- AI tools can parse output reliably
- Pipe directly to `llm`, `claude`, etc.
- Clear data boundaries
- No escaping ambiguity with CDATA

### Negative
- Verbose output
- Two code paths (text and XML)
- CDATA has its own edge cases

## Implementation

```typescript
// --xml flag on commands
program
  .command('show [change-id]')
  .option('--xml', 'Output as XML for LLM consumption')
  .action((changeId, options) => {
    if (options.xml) {
      outputXml(change)
    } else {
      outputPretty(change)
    }
  })
```

## CDATA Sanitization

```typescript
// src/utils/shell-safety.ts
export function sanitizeCDATA(text: string): string {
  // CDATA cannot contain "]]>" - split and rejoin
  return text.replace(/]]>/g, ']]]]><![CDATA[>')
}

export function wrapCDATA(text: string): string {
  return `<![CDATA[${sanitizeCDATA(text)}]]>`
}
```

## Example Output

```xml
<change>
  <number>12345</number>
  <project>canvas-lms</project>
  <subject><![CDATA[Fix login bug with special chars <>&]]></subject>
  <diff><![CDATA[
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
+import { something } from 'somewhere'
  ]]></diff>
</change>
```

## Integration Examples

```bash
# Pipe to Claude for review
ger show 12345 --xml | claude "Review this change"

# Pipe to llm tool
ger diff 12345 --xml | llm "Summarize changes"

# Batch review with comment posting
llm "Review this diff" < <(ger diff 12345 --xml) | ger comment 12345
```
