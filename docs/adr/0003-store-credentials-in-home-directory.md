# ADR 0003: Store Credentials in Home Directory

## Status

Accepted

## Context

We need to store Gerrit authentication credentials (host, username, HTTP password/token). Options considered:

1. **Environment variables only** - Simple but inconvenient for interactive use
2. **Project-local config** - Risk of committing credentials
3. **System keychain** - Secure but platform-specific complexity
4. **Home directory file** - Portable, standard pattern

## Decision

Store credentials in `~/.ger/config.json` with environment variable fallback.

## Rationale

- **Standard pattern**: Matches Git, SSH, AWS CLI conventions
- **Persistent**: Survives terminal sessions
- **Secure**: File permissions set to 0600 (owner read/write only)
- **CI-friendly**: Environment variables work in pipelines
- **Portable**: Same approach across macOS, Linux, WSL

## Consequences

### Positive
- Single setup command configures everything
- Works offline once configured
- Environment variables for CI/CD pipelines
- Matches user expectations from other CLIs

### Negative
- File stored in plaintext (mitigated by permissions)
- Users must trust file system security
- Migration needed when format changes

## Implementation

```typescript
const CONFIG_DIR = path.join(os.homedir(), '.ger')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

// Set secure permissions
fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
fs.writeFileSync(CONFIG_FILE, JSON.stringify(config), { mode: 0o600 })
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GERRIT_HOST` | Gerrit server URL |
| `GERRIT_USERNAME` | Username for authentication |
| `GERRIT_PASSWORD` | HTTP password or API token |

## Priority Order

1. File configuration (`~/.ger/config.json`)
2. Environment variables
3. Error (no credentials found)

## Migration Support

Automatically migrates legacy nested format:
```json
// Old format
{ "credentials": { "host": "...", "username": "..." } }

// New flat format
{ "host": "...", "username": "..." }
```
