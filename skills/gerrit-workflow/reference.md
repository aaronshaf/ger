# ger CLI Command Reference

Complete reference documentation for all ger CLI commands.

## Output Format Flags

All commands that produce output support:
- `--json` — Structured JSON for programmatic consumption
- `--xml` — XML with CDATA-wrapped content (preferred for LLM consumption)
- (default) — Colored terminal output

`--json` and `--xml` are mutually exclusive.

---

## Change Viewing Commands

### show

Display comprehensive information about a Gerrit change.

**Syntax:**
```bash
ger show [change-id] [options]
```

**Options:**
- `--json` — JSON output
- `--xml` — XML output
- `--no-comments` — Exclude comments
- `--no-diff` — Exclude diff

**Examples:**
```bash
ger show
ger show 12345
ger show 12345 --xml
ger show --no-comments
```

**Output includes:** metadata, commit message, file diffs, all comments, Jenkins build status

---

### diff

Get the diff for a Gerrit change.

**Syntax:**
```bash
ger diff [change-id] [options]
```

**Options:**
- `--file <path>` — Show diff for specific file only
- `--base <revision>` — Compare against specific base revision
- `--files-only` — List changed filenames only (no diff content)
- `--json` — JSON output
- `--xml` — XML output

**Examples:**
```bash
ger diff 12345
ger diff 12345 --file src/api/client.ts
ger diff 12345 --xml
```

---

### comments

View all comments on a change.

**Syntax:**
```bash
ger comments [change-id] [options]
```

**Options:**
- `--unresolved-only` — Show only unresolved comments
- `--file <path>` — Show comments for specific file only
- `--json` — JSON output
- `--xml` — XML output

---

### files

List changed files in a change.

**Syntax:**
```bash
ger files [change-id] [options]
```

**Options:**
- `--json` — JSON output
- `--xml` — XML output

---

### reviewers

List reviewers on a change.

**Syntax:**
```bash
ger reviewers [change-id] [options]
```

**Options:**
- `--json` — JSON output
- `--xml` — XML output

---

## Change Listing Commands

### list

List your changes or changes needing your review.

**Syntax:**
```bash
ger list [options]
```

**Options:**
- `--status <status>` — Filter by status: `open`, `merged`, `abandoned` (default: open)
- `-n, --limit <n>` — Maximum number of changes (default: 25)
- `--detailed` — Show detailed information
- `--reviewer` — Show changes where you are a reviewer or CC'd
- `--json` — JSON output
- `--xml` — XML output

---

### mine

List all changes owned by you. Alias for `ger list`.

**Syntax:**
```bash
ger mine [options]
```

**Options:**
- `--json` — JSON output
- `--xml` — XML output

---

### incoming / team

List changes where you are a reviewer or CC'd.
Both commands are aliases for `ger list --reviewer`.
Query: `(reviewer:self OR cc:self) status:open`

**Syntax:**
```bash
ger incoming [options]
ger team [options]
```

**Options:**
- `--status <status>` — Filter by status (default: open)
- `-n, --limit <n>` — Maximum number of changes (default: 25)
- `--detailed` — Show detailed information
- `--all-verified` — Include all verification states (default: excludes unverified)
- `-f, --filter <query>` — Append custom Gerrit query syntax (e.g. `project:canvas-lms`)
- `--json` — JSON output
- `--xml` — XML output

**Examples:**
```bash
ger team
ger incoming --filter "project:canvas-lms"
ger team --all-verified --json
```

---

### search

Search for changes using Gerrit query syntax.

**Syntax:**
```bash
ger search [query] [options]
```

**Options:**
- `-n, --limit <n>` — Maximum results (default: 25)
- `--xml` — XML output

**Common Query Operators:**
- `owner:USER` / `owner:self`
- `status:open|merged|abandoned`
- `project:NAME`
- `branch:NAME`
- `reviewer:USER` / `cc:USER`
- `is:wip` / `is:submittable`
- `after:YYYY-MM-DD` / `before:YYYY-MM-DD`
- `age:1d|2w|1mon`
- `label:Code-Review+2`

**Examples:**
```bash
ger search "owner:self status:open"
ger search "is:wip"
ger search "project:canvas-lms after:2025-01-01" -n 10 --xml
```

---

## Comment and Vote Commands

### comment

Post a comment on a Gerrit change.

**Syntax:**
```bash
ger comment [change-id] [options]
```

**Options:**
- `-m, --message <text>` — Comment message (reads from stdin if omitted)
- `--file <path>` — File for inline comment
- `--line <n>` — Line number for inline comment
- `--unresolved` — Mark comment as unresolved

**Examples:**
```bash
ger comment 12345 -m "Looks good!"
ger comment 12345 --file src/api/client.ts --line 42 -m "Consider error handling"
echo "Review feedback" | ger comment 12345
```

---

### vote

Vote on a Gerrit change.

**Syntax:**
```bash
ger vote <change-id> [options]
```

**Options:**
- `--code-review <n>` — Code-Review vote (-2 to +2)
- `--verified <n>` — Verified vote (-1 to +1)
- `--label <name> <value>` — Custom label (repeatable)
- `--message <text>` — Optional comment with the vote
- `--json` — JSON output
- `--xml` — XML output

**Examples:**
```bash
ger vote 12345 --code-review 2
ger vote 12345 --code-review -1
ger vote 12345 --verified 1 --message "Looks good"
ger vote 12345 --label My-Label 1
```

---

## Change Management Commands

### abandon

Mark a change as abandoned.

**Syntax:**
```bash
ger abandon [change-id] [options]
```

**Options:**
- `-m, --message <text>` — Abandonment message
- `--json` — JSON output
- `--xml` — XML output

---

### restore

Restore an abandoned change.

**Syntax:**
```bash
ger restore [change-id] [options]
```

**Options:**
- `-m, --message <text>` — Restoration message
- `--json` — JSON output
- `--xml` — XML output

---

### submit

Submit a change (merge it).

**Syntax:**
```bash
ger submit [change-id] [options]
```

**Options:**
- `--json` — JSON output
- `--xml` — XML output

---

### set-wip

Mark a change as work-in-progress.

**Syntax:**
```bash
ger set-wip [change-id] [options]
```

**Options:**
- `-m, --message <text>` — Optional message
- `--json` — JSON output
- `--xml` — XML output

---

### set-ready

Mark a change as ready for review.

**Syntax:**
```bash
ger set-ready [change-id] [options]
```

**Options:**
- `-m, --message <text>` — Optional message
- `--json` — JSON output
- `--xml` — XML output

---

### topic

Get or set the topic on a change.

**Syntax:**
```bash
ger topic [change-id] [topic] [options]
```

**Options:**
- `--delete` — Remove the topic
- `--json` — JSON output
- `--xml` — XML output

**Examples:**
```bash
ger topic 12345              # get topic
ger topic 12345 my-feature   # set topic
ger topic 12345 --delete     # delete topic
```

---

## Push and Checkout Commands

### push

Push changes to Gerrit for review.

**Syntax:**
```bash
ger push [options]
```

**Options:**
- `-b, --branch <branch>` — Target branch (auto-detected from tracking branch)
- `-t, --topic <topic>` — Topic name
- `-r, --reviewer <email>` — Add reviewer (repeatable)
- `--cc <email>` — Add CC (repeatable)
- `--wip` — Mark as work-in-progress
- `--ready` — Mark as ready for review
- `--hashtag <tag>` — Add hashtag (repeatable)
- `--private` — Mark as private
- `--dry-run` — Preview without pushing

---

### checkout

Checkout a specific change revision locally.

**Syntax:**
```bash
ger checkout <change-id> [options]
```

**Options:**
- `--revision <n>` — Checkout specific patchset (default: latest)

---

### cherry

Cherry-pick a Gerrit change into the current branch.

**Syntax:**
```bash
ger cherry <change-id>[/<patchset>] [options]
```

**Options:**
- `--no-commit` — Stage changes without committing (`git cherry-pick -n`)
- `--no-verify` — Skip pre-commit hooks during cherry-pick
- `--remote <name>` — Use specific git remote (default: auto-detected from Gerrit host)

**Input formats:**
- `12345` — Latest patchset
- `12345/3` — Specific patchset
- `If5a3ae8cb5a107e187447802358417f311d0c4b1` — Change-ID
- `https://gerrit.example.com/c/my-project/+/12345` — Full URL

**Examples:**
```bash
ger cherry 12345
ger cherry 12345/3
ger cherry 12345 --no-commit
ger cherry 12345 --no-verify
```

---

### rebase

Rebase a change on Gerrit (server-side rebase).

**Syntax:**
```bash
ger rebase [change-id] [options]
```

**Options:**
- `--base <sha-or-id>` — Rebase onto specific base commit or change
- `--allow-conflicts` — Allow rebase even when conflicts exist
- `--json` — JSON output
- `--xml` — XML output

**Examples:**
```bash
ger rebase
ger rebase 12345
ger rebase 12345 --allow-conflicts
ger rebase 12345 --base abc123def --xml
```

---

## Build and CI Commands

### build-status

Check the Jenkins build status for a change.

**Syntax:**
```bash
ger build-status [change-id] [options]
```

**Options:**
- `--watch` — Poll until build completes
- `--interval <seconds>` — Polling interval (default: 30)
- `--timeout <seconds>` — Maximum wait time
- `--exit-status` — Return non-zero exit code on build failure (for scripting)
- `--json` — JSON output
- `--xml` — XML output

**Examples:**
```bash
ger build-status 12345
ger build-status --watch --interval 20 --timeout 1800
ger build-status --exit-status
```

---

### extract-url

Extract URLs from change messages (e.g., Jenkins build links).

**Syntax:**
```bash
ger extract-url <pattern> [change-id]
```

**Examples:**
```bash
ger extract-url "build-summary-report"
ger extract-url "build-summary-report" | tail -1
ger extract-url "jenkins" 12345
```

---

### retrigger

Post a CI retrigger comment on a change.

**Syntax:**
```bash
ger retrigger [change-id] [options]
```

**Options:**
- `--json` — JSON output
- `--xml` — XML output

The retrigger comment is configured via `ger setup` or prompted on first use and saved to config.

**Examples:**
```bash
ger retrigger
ger retrigger 12345
ger retrigger 12345 --json
```

---

## Analytics Commands

### analyze

View merged change analytics.

**Syntax:**
```bash
ger analyze [options]
```

**Options:**
- `--start-date <YYYY-MM-DD>` — Start date (default: January 1 of current year)
- `--end-date <YYYY-MM-DD>` — End date (default: today)
- `--repo <name>` — Filter by repository
- `--json` — JSON output
- `--xml` — XML output
- `--markdown` — Markdown output
- `--csv` — CSV output
- `--output <file>` — Write output to file

**Examples:**
```bash
ger analyze
ger analyze --start-date 2025-01-01 --end-date 2025-06-30
ger analyze --repo canvas-lms --markdown
ger analyze --csv --output report.csv
```

---

### update

Update ger to the latest version (self-update).

**Syntax:**
```bash
ger update [options]
```

**Options:**
- `--skip-pull` — Skip version check, just reinstall

---

### failures

View recent build failures summary.

**Syntax:**
```bash
ger failures [options]
```

**Options:**
- `--json` — JSON output
- `--xml` — XML output

---

## Worktree (tree) Commands

### tree setup

Create a git worktree for a Gerrit change, checked out at `<repo-root>/.ger/<change-number>/`.

**Syntax:**
```bash
ger tree setup <change-id>[:<patchset>] [options]
```

**Options:**
- `--json` — JSON output
- `--xml` — XML output

**Examples:**
```bash
ger tree setup 12345
ger tree setup 12345:3      # specific patchset
ger tree setup 12345 --xml
```

---

### trees

List all ger-managed worktrees.

**Syntax:**
```bash
ger trees [options]
```

**Options:**
- `--json` — JSON output
- `--xml` — XML output

---

### tree rebase

Rebase the current worktree onto the latest base branch. Must be run from inside a ger worktree.

**Syntax:**
```bash
ger tree rebase [options]
```

**Options:**
- `--onto <branch>` — Rebase onto specific branch (default: auto-detected from tracking branch)
- `-i, --interactive` — Interactive rebase (`git rebase -i`)
- `--json` — JSON output
- `--xml` — XML output

**Examples:**
```bash
cd .ger/12345
ger tree rebase
ger tree rebase --onto origin/main
ger tree rebase --interactive
```

---

### tree cleanup

Remove a ger-managed worktree.

**Syntax:**
```bash
ger tree cleanup <change-id> [options]
```

---

## Groups and Reviewer Commands

### add-reviewer

Add reviewers, groups, or CCs to a change.

**Syntax:**
```bash
ger add-reviewer <reviewers...> -c <change-id> [options]
```

**Options:**
- `-c, --change <id>` — Change ID (required)
- `--group` — Add as group
- `--cc` — Add as CC
- `--notify <level>` — `none`, `owner`, `owner_reviewers`, `all`
- `--xml` — XML output

---

### remove-reviewer

Remove a reviewer from a change.

**Syntax:**
```bash
ger remove-reviewer <account> -c <change-id> [options]
```

**Options:**
- `-c, --change <id>` — Change ID (required)
- `--notify <level>` — `none`, `owner`, `owner_reviewers`, `all`
- `--xml` — XML output

---

### groups

List and search Gerrit groups.

**Syntax:**
```bash
ger groups [options]
```

**Options:**
- `--pattern <regex>` — Filter by name pattern
- `--owned` — Show only groups you own
- `--project <name>` — Show groups for a project
- `--user <account>` — Show groups a user belongs to
- `--limit <n>` — Limit results (default: 25)
- `--xml` — XML output

---

### groups-show

Show detailed information about a specific group.

**Syntax:**
```bash
ger groups-show <group-id> [options]
```

**Options:**
- `--xml` — XML output

---

### groups-members

List all members of a group.

**Syntax:**
```bash
ger groups-members <group-id> [options]
```

**Options:**
- `--xml` — XML output

---

## Configuration Commands

### setup

Interactive first-time setup.

```bash
ger setup
```

Configures Gerrit URL, credentials, and retrigger comment.

### config

Manage ger CLI configuration.

**Syntax:**
```bash
ger config <action> [key] [value]
```

**Actions:** `get`, `set`, `list`, `reset`

**Examples:**
```bash
ger config list
ger config get gerrit.url
ger config set gerrit.url https://gerrit.example.com
```

---

## Auto-Detection

These commands auto-detect the change from the HEAD commit's `Change-Id` footer when no change-id is provided:

`show`, `build-status`, `topic`, `rebase`, `extract-url`, `diff`, `comments`, `vote`, `retrigger`, `files`, `reviewers`

---

## Exit Codes

- `0` — Success
- `1` — General error (network, API, validation)
- `build-status --exit-status` returns non-zero on build failure
