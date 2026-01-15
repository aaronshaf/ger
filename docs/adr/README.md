# ADR - Architecture Decision Records

Records of significant architectural decisions with context and rationale. Each ADR captures the why behind technical choices.

## Records

| ADR | Decision |
|-----|----------|
| [0001](0001-use-effect-for-side-effects.md) | Effect-TS for all side effects |
| [0002](0002-use-bun-runtime.md) | Bun as the JavaScript runtime |
| [0003](0003-store-credentials-in-home-directory.md) | `~/.ger/config.json` for credentials |
| [0004](0004-use-commander-for-cli.md) | Commander.js for CLI framework |
| [0005](0005-use-effect-schema-for-validation.md) | Effect Schema for data validation |
| [0006](0006-use-msw-for-api-mocking.md) | MSW for HTTP mocking in tests |
| [0007](0007-git-hooks-for-quality.md) | Pre-commit hooks for code quality |
| [0008](0008-no-as-typecasting.md) | Prohibit `as` type casting |
| [0009](0009-file-size-limits.md) | Enforce file size limits |
| [0010](0010-llm-friendly-xml-output.md) | `--xml` flag for LLM consumption |
| [0011](0011-ai-tool-strategy-pattern.md) | Pluggable AI tool strategies |
| [0012](0012-build-status-message-parsing.md) | Parse messages for build status |
| [0013](0013-git-subprocess-integration.md) | Shell out to git instead of library |
| [0014](0014-group-management-support.md) | Full Gerrit group management |
| [0015](0015-batch-comment-processing.md) | JSON array input for bulk comments |
| [0016](0016-flexible-change-identifiers.md) | Accept both numeric and Change-ID formats |
| [0017](0017-git-worktree-support.md) | Full git worktree compatibility |
| [0018](0018-auto-install-commit-hook.md) | Auto-install Gerrit commit-msg hook |
| [0019](0019-sdk-package-exports.md) | Export SDK for programmatic usage |
| [0020](0020-code-coverage-enforcement.md) | 80% coverage threshold in pre-commit |
| [0021](0021-typescript-isolated-declarations.md) | Explicit return types on exports |
| [0022](0022-biome-oxlint-tooling.md) | Biome formatter + oxlint linter |
