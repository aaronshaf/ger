# ADR 0023: Surface Reviewers and CCs in `ger show`

## Status

Accepted

## Context

`ger` supports reviewer management (`add-reviewer`, `remove-reviewer`) but did not expose a reliable way to view current reviewers for a change in one command.

This created a workflow gap:

- Users could mutate reviewer state but not inspect it from the CLI.
- `show` already served as the canonical "single change detail" command and was the best place to surface reviewer assignments.

## Decision

Add reviewer visibility to `ger show` by:

1. Keeping `getChange` lightweight and using a `listChanges` fallback (with detailed account/label options) when reviewer state is not present in the base change response.
2. Extending `ChangeInfo` schema with Gerrit reviewer state maps (`REVIEWER`, `CC`, `REMOVED`).
3. Rendering reviewers and CCs in all `show` output formats (pretty, JSON, XML).

## Rationale

- **Single source of truth**: `show` remains the canonical command for full change context.
- **No new command surface**: avoids adding a narrowly scoped `list-reviewers` command.
- **Automation-friendly**: JSON/XML consumers can parse reviewer state without scraping text output.
- **Backward compatible**: reviewer fields are optional and do not break servers or older data shapes.

## Consequences

### Positive

- Users can verify reviewer assignment directly after add/remove operations.
- Better parity between mutation commands and read visibility.
- More complete machine-readable change payloads.

### Negative

- Extra `listChanges` request when reviewer data is absent from `getChange`.
- Additional schema/output maintenance for reviewer state rendering.
