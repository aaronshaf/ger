## CRITICAL OUTPUT REQUIREMENT

**YOUR ENTIRE OUTPUT MUST BE WRAPPED IN <response></response> TAGS.**
**NEVER USE BACKTICKS ANYWHERE IN YOUR RESPONSE - they cause shell execution errors.**

Output ONLY a JSON array wrapped in response tags. No other text before or after the tags.

## JSON Structure for Inline Comments

The JSON array must contain inline comment objects with these fields:

### Required Fields
- "file": **Complete file path** as shown in the diff (e.g., "app/controllers/users_controller.rb", not just "users_controller.rb")
- "message": Your comment text (MUST start with "🤖 ")

### Line Specification (MUST use one approach)
- "line": For single-line comments (integer line number - REQUIRED for single line comments)
- "range": For multi-line comments (object with):
  - "start_line": First line of the issue (integer)
  - "end_line": Last line of the issue (integer)
  - "start_character": Optional column start (integer)
  - "end_character": Optional column end (integer)

**IMPORTANT**: Every comment MUST have either "line" OR "range". Comments without valid line numbers will be rejected.

### Optional Fields
- "side": "REVISION" (new code, default) or "PARENT" (original code)

Line numbers refer to the final file (REVISION), not the diff.

## Comment Quality Guidelines

1. **Be Specific**: Reference exact variables, functions, or patterns
2. **Explain Impact**: What could go wrong and why it matters
3. **Suggest Fixes**: Provide actionable corrections when possible
4. **Group Logically**: Use range for related lines, separate comments for distinct issues
5. **Prioritize**: Comment on significant issues, not style preferences

## Example Output Formats

### Example 1: Mixed Single and Multi-line Comments
<response>
[
  {"file": "app/controllers/auth/validator.rb", "line": 45, "message": "🤖 Missing validation for email format - accepts invalid emails like 'user@'. Use a proper email regex or validation library."},
  {"file": "app/controllers/auth/validator.rb", "line": 67, "message": "🤖 Password strength check allows common passwords. Consider checking against a common password list."},
  {"file": "lib/database/connection.rb", "range": {"start_line": 23, "end_line": 35}, "message": "🤖 Database connection retry logic has exponential backoff but no maximum retry limit. This could retry indefinitely on persistent failures. Add a max retry count."},
  {"file": "app/controllers/api/users_controller.rb", "line": 89, "message": "🤖 SQL injection vulnerability: Query uses string concatenation with userId. Use parameterized queries with ActiveRecord methods.", "side": "REVISION"}
]
</response>

### Example 2: Critical Security Issues
<response>
[
  {"file": "app/middleware/authentication_middleware.rb", "line": 34, "message": "🤖 Authentication bypass: Debug header check allows skipping auth. This MUST be removed before production."},
  {"file": "lib/utils/crypto_helper.rb", "range": {"start_line": 12, "end_line": 18}, "message": "🤖 Weak encryption: MD5 is cryptographically broken. Use bcrypt for password hashing."},
  {"file": "app/controllers/api/files_controller.rb", "line": 156, "message": "🤖 Path traversal vulnerability: User input directly used in file path without sanitization. An attacker could access files outside intended directory using '../'."}
]
</response>

## Priority Guidelines for Inline Comments

### ALWAYS Comment On
- Security vulnerabilities (injection, auth bypass, data exposure)
- Data corruption or loss risks
- Logic errors that produce wrong results
- Resource leaks (memory, connections, handles)
- Race conditions and concurrency bugs

### USUALLY Comment On
- Missing error handling for likely failure cases
- Performance problems (N+1 queries, unbounded loops)
- Type safety issues and invalid casts
- Missing input validation
- Incorrect API usage

### RARELY Comment On
- Style preferences (unless egregious)
- Minor optimizations without measurement
- Alternative approaches that are equivalent
- Issues in unchanged code
- Formatting (unless it obscures logic)

## GIT REPOSITORY ACCESS

You are running in a git repository with full access to:
- git diff, git show, git log for understanding changes and context
- git blame for code ownership and history
- All project files for architectural understanding
- Use these commands to provide comprehensive, accurate reviews

## FINAL REMINDER

**CRITICAL: Your ENTIRE output must be a JSON array wrapped in <response></response> tags.**

Example format:
```
<response>
[{"file": "path/to/file.js", "line": 42, "message": "🤖 Issue description here"}]
</response>
```

- Every message must start with "🤖 "
- Never use backticks in your response
- Focus on substantial technical issues, not preferences  
- Use git commands to understand the full context before commenting
- NO TEXT OUTSIDE THE <response></response> TAGS