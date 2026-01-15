# ADR 0011: AI Tool Strategy Pattern

## Status

Accepted

## Context

We want to support AI-powered code review, but don't want to hard-code a single AI tool. Users may have different tools installed.

## Decision

Implement a strategy pattern for AI tools with auto-detection.

## Rationale

- **No vendor lock-in**: Support multiple AI tools
- **User choice**: Users can specify preferred tool
- **Future-proof**: Easy to add new tools
- **Graceful fallback**: Try tools in priority order

## Supported Tools

| Tool | Command | Priority |
|------|---------|----------|
| Claude CLI | `claude` | 1 (highest) |
| llm | `llm` | 2 |
| opencode | `opencode` | 3 |
| Gemini | `gemini` | 4 |

## Consequences

### Positive
- Works with whatever AI tool user has
- Easy to add new strategies
- Configurable default via config file
- Graceful degradation

### Negative
- Must maintain multiple integrations
- Tool-specific output parsing
- Version compatibility concerns

## Implementation

```typescript
// src/services/review-strategy.ts
interface ReviewStrategy {
  name: string
  isAvailable(): Promise<boolean>
  executeReview(prompt: string, diff: string): Promise<string>
}

const strategies: ReviewStrategy[] = [
  claudeStrategy,
  llmStrategy,
  opencodeStrategy,
  geminiStrategy,
]

export const findAvailableStrategy = async (): Promise<ReviewStrategy | null> => {
  for (const strategy of strategies) {
    if (await strategy.isAvailable()) {
      return strategy
    }
  }
  return null
}
```

## Configuration

```json
// ~/.ger/config.json
{
  "host": "https://gerrit.example.com",
  "username": "user",
  "password": "token",
  "aiTool": "claude",        // explicit tool choice
  "aiAutoDetect": true       // or auto-detect
}
```

## Response Extraction

AI tools may wrap responses in tags:

```typescript
const extractResponse = (output: string): string => {
  // Try to extract from <response> tags
  const match = output.match(/<response>([\s\S]*?)<\/response>/)
  return match ? match[1].trim() : output.trim()
}
```

## Multi-Stage Review

The `review` command uses two stages:
1. **Inline comments**: Line-specific feedback
2. **Overall review**: High-level assessment

Each stage uses the same strategy but different prompts from `src/prompts/`.
