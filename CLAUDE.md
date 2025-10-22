# Gerrit CLI Tool - Project Rules

## Technology Stack
- **Runtime**: Bun
- **Language**: TypeScript with isolatedDeclarations: true
- **CLI Framework**: Ink with ink-spinner and ink-text-input
- **State Management**: Effect and Effect Schema
- **Testing**: Bun test with MSW
- **Database**: SQLite for local-first caching
- **Linting**: oxlint
- **Formatting**: Biome
- **i18n**: i18next

## Strict Requirements

### Code Quality
- **NO** implicit any or noExplicitAny in TypeScript
- **MUST** use isolatedDeclarations: true in tsconfig.json
- **ONLY** use .ts files (no .js/.jsx/.tsx files - this is a CLI tool)
- **NEVER** use `as` typecasting except for `as const` or `as unknown`
- **NEVER** use --no-verify flag with git commands
- **NO** files over 700 lines (block in pre-commit/pre-push)
- **WARN** for files over 500 lines (but don't block)

### Testing & Coverage
- **ENFORCE** minimum 80% code coverage
- **RUN** all tests in pre-commit and pre-push hooks
- **USE** Bun's native fetch mocking for all HTTP requests
- **REQUIRE** meaningful integration tests for all commands that simulate full workflows
- **IMPLEMENT** both unit tests and integration tests for every command modification/addition
- **ENSURE** integration tests use realistic Bun HTTP mocks that match Gerrit API responses
- **EXCLUDE** generated code and tmp/ from coverage

### Security
- **NEVER** commit sensitive data, API keys, or secrets
- **NEVER** expose sensitive information in error messages
- **USE** Effect Schema for all input validation
- **IMPLEMENT** SQL injection prevention

### Development Workflow
- **RUN** type-checking in pre-commit and pre-push hooks
- **RUN** oxlint in pre-commit and pre-push hooks
- **RUN** biome formatter before commits
- **RUN** `bun run build` after making changes to ensure compilation succeeds
- **USE** ast-grep to enforce no `as` typecasting rule
- **CHECK** file sizes in pre-commit and pre-push hooks
- **EXCLUDE** generated code and tmp/ from all checks

### Architecture Patterns
- **USE** Effect for all service implementations
- **USE** Effect Schema for all data models
- **IMPLEMENT** cache-first strategy with SQLite
- **USE** regional error boundaries for error handling
- **FOLLOW** functional programming patterns with Effect

### Testing Requirements for Commands
- **UNIT TESTS**: Test individual functions, schemas, and utilities
- **INTEGRATION TESTS**: Test complete command flows with mocked HTTP requests
- **HTTP MOCKING**: Use `global.fetch = mock(...)` pattern with Bun's native mocking
- **SCHEMA VALIDATION**: Ensure mocks return data that validates against Effect Schemas
- **COMMAND COVERAGE**: Every command must have integration tests covering:
  - Happy path execution
  - Error handling (network errors, API errors, validation errors)
  - Interactive UI behavior (where applicable)
  - Cache behavior verification

### Git Workflow
- **USE** conventional commit messages
- **CREATE** feature branches from main
- **NEVER** commit directly to main
- **INCLUDE** test coverage report in README.md

### CLI Specific
- **USE** Ink components for all UI
- **IMPLEMENT** proper loading states with ink-spinner
- **USE** ink-text-input for user input
- **SUPPORT** internationalization with i18next
- **PROVIDE** helpful error messages without sensitive data

### File Organization
- src/cli/ - Ink components and commands
- src/services/ - Effect services
- src/api/ - Gerrit API client
- src/db/ - SQLite layer
- src/schemas/ - Effect Schema definitions
- src/i18n/ - Internationalization
- tests/ - All test files
- scripts/ - Build and hook scripts

### Performance
- **IMPLEMENT** efficient caching strategies
- **USE** SQLite for offline-first functionality
- **MINIMIZE** API calls through smart caching
- **OPTIMIZE** bundle size for fast CLI startup

## Commands
- **show** - Comprehensive change information including metadata, diff, and all comments
- **comment** - Post comments with piped input support for AI integration
- **diff** - Get diffs with various formatting options
- **comments** - View all comments on a change with context
- **incoming/mine/abandon/open** - Change management commands

Remember: This is a CLI tool, not a web app. No React components, no .tsx files, no Playwright tests.