# ADR 0006: Use MSW for API Mocking

## Status

Accepted

## Context

We need to mock HTTP requests in tests without making real API calls. Options considered:

1. **nock** - Classic Node.js HTTP mocking
2. **MSW (Mock Service Worker)** - Request interception at network level
3. **fetch-mock** - Simple fetch mocking
4. **Manual mocks** - Jest/Vitest manual module mocks

## Decision

Use MSW (Mock Service Worker) for all HTTP request mocking in tests.

## Rationale

- **Network level**: Intercepts at fetch/HTTP level, not module level
- **Realistic**: Tests actual HTTP behavior, not mocked modules
- **Reusable handlers**: Define once, use across many tests
- **Schema validation**: Mock responses can validate against Effect Schemas
- **Framework agnostic**: Works with any test runner

## Consequences

### Positive
- Tests exercise real HTTP client code
- Handlers are portable and reusable
- Easy to simulate error conditions (timeouts, 500s)
- No module mocking complexity

### Negative
- Additional dependency
- Requires setup/teardown in tests
- Learning MSW handler syntax

## Implementation

```typescript
// tests/mocks/handlers.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('*/a/changes/:changeId', ({ params }) => {
    return HttpResponse.json({
      id: 'project~main~I1234567890abcdef',
      _number: parseInt(params.changeId as string),
      project: 'test-project',
      branch: 'main',
      subject: 'Test change',
      status: 'NEW',
      // ... schema-compliant response
    })
  }),

  http.post('*/a/changes/:changeId/revisions/current/review', () => {
    return new HttpResponse(null, { status: 200 })
  }),
]
```

## Test Setup

```typescript
// tests/setup.ts
import { setupServer } from 'msw/node'
import { handlers } from './mocks/handlers'

export const server = setupServer(...handlers)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

## Error Simulation

```typescript
// Simulate API errors in specific tests
server.use(
  http.get('*/a/changes/:changeId', () => {
    return new HttpResponse(null, { status: 404 })
  })
)
```
