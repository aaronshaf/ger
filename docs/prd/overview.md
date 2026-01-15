# ger - Gerrit CLI Tool

## Overview

`ger` is a modern, LLM-friendly CLI tool and SDK for Gerrit Code Review. It provides comprehensive Gerrit workflow automation with AI integration, published as both a CLI tool and npm package.

## Goals

1. **Fast Gerrit operations** - Quick access to changes, diffs, comments without browser
2. **AI integration** - LLM-friendly output and automated code review
3. **Developer ergonomics** - Auto-detection, smart defaults, minimal configuration
4. **Programmatic access** - SDK for building custom tools and automation
5. **Type safety** - Full TypeScript with Effect for reliable operations

## Non-Goals

- Replace Gerrit web UI entirely (complex dashboards, admin)
- Support Gerrit versions older than 3.0
- Implement bidirectional sync (changes are created via git push)
- Provide real-time notifications (use Gerrit's native features)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript/Bun | Fast runtime, native TS, matches ji/cn projects |
| Error handling | Effect library | Type-safe errors, composable operations |
| CLI framework | Commander.js | Stable, simple, well-documented |
| Output formats | Text, XML, JSON | Human + machine readable |
| Credentials | `~/.ger/config.json` | Secure, standard pattern |
| Git integration | Subprocess | No deps, full features, worktree support |
| Validation | Effect Schema | Single source of truth, type inference |
| Testing | MSW + Bun test | Fast, realistic API mocking |
| AI tools | Strategy pattern | Vendor-agnostic, auto-detection |

## User Personas

### Individual Developer
- Works on personal changes
- Needs quick status checks
- Wants CLI convenience over browser

### Code Reviewer
- Reviews multiple changes daily
- Needs efficient navigation
- Benefits from AI-assisted review

### Automation Engineer
- Builds CI/CD pipelines
- Needs programmatic access
- Requires JSON/XML output

### Team Lead
- Manages reviewers and groups
- Tracks team's open changes
- Assigns reviewers efficiently

## Commands Overview

| Category | Commands |
|----------|----------|
| **View** | `show`, `diff`, `comments`, `search` |
| **Review** | `comment`, `vote`, `review`, `add-reviewer` |
| **Manage** | `mine`, `incoming`, `abandon`, `restore` |
| **Operations** | `checkout`, `push`, `rebase`, `submit` |
| **Groups** | `groups`, `groups-show`, `groups-members` |
| **Utilities** | `status`, `setup`, `open`, `extract-url`, `build-status` |

## User Flows

### First-time Setup

```
$ ger setup
? Gerrit URL: https://gerrit.example.com
? Username: john.doe
? HTTP Password: ****
✓ Configuration saved to ~/.ger/config.json
✓ Connection verified
```

### Daily Code Review

```
$ ger incoming
PROJECT: canvas-lms
  12345  Fix login bug             alice       CR: +1
  12346  Add dark mode             bob         CR: 0

$ ger show 12345
Change 12345: Fix login bug
Author: alice@example.com
Status: NEW
...

$ ger review 12345
✓ AI review posted (3 inline comments, 1 overall comment)
```

### Submit a Change

```
$ git commit -m "Fix typo in README"
$ ger push
✓ Pushed to refs/for/main
✓ Change 12347 created

$ ger add-reviewer 12347 bob carol
✓ Added 2 reviewers
```

## Success Metrics

- Handle repositories with 10,000+ changes
- Complete common operations in < 2 seconds
- AI review completes in < 30 seconds
- 80%+ test coverage maintained

## References

- [Gerrit REST API](https://gerrit-review.googlesource.com/Documentation/rest-api.html)
- [Effect library](https://effect.website/)
- [ji project](https://github.com/aaronshaf/ji) - JIRA CLI (same author)
- [cn project](https://github.com/aaronshaf/cn) - Confluence CLI (same author)
