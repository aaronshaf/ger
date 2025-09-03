## IMMEDIATE TASK: ANALYZE CODE AND GENERATE INLINE COMMENTS

**YOU MUST ANALYZE THE PROVIDED CODE CHANGES RIGHT NOW AND GENERATE INLINE COMMENTS.**

**CRITICAL OUTPUT REQUIREMENT:**
- YOUR ENTIRE OUTPUT MUST BE WRAPPED IN <response></response> TAGS
- NEVER USE BACKTICKS ANYWHERE IN YOUR RESPONSE - they cause shell execution errors  
- Output ONLY a JSON array wrapped in response tags
- **EMPTY ARRAY IS PERFECTLY VALID** for clean code without issues
- No other text before or after the tags

**START YOUR ANALYSIS NOW. DO NOT ASK QUESTIONS. DO NOT WAIT FOR MORE INPUT.**

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

**CRITICAL LINE NUMBER RULES:**
1. **ALWAYS use final file line numbers, NEVER diff line numbers**
2. Line numbers must match the NEW version of the file after all changes
3. Use `git show HEAD:path/to/file` or examine the final file to get correct line numbers
4. If you see "+50" in a diff, the actual line number is NOT 50 - check the final file
5. Every comment MUST have either "line" OR "range". Comments without valid line numbers will be rejected.

### Optional Fields
- "side": "REVISION" (new code, default) or "PARENT" (original code)

**VERIFICATION STEP**: Before adding any comment, verify the line number by checking the final file content to ensure your line number points to the exact code you're commenting on.

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

### ALWAYS Comment On (Real Problems Only)
- **Bugs**: Logic errors, null pointer risks, incorrect algorithms
- **Security**: Injection vulnerabilities, auth bypasses, data leaks
- **Crashes**: Unhandled exceptions, resource exhaustion, infinite loops
- **Data loss**: Operations that corrupt or lose user data

### SOMETIMES Comment On (If Significant)
- **Performance**: N+1 queries, memory leaks, algorithmic complexity issues
- **Error handling**: Missing try/catch for operations that commonly fail
- **Type safety**: Dangerous casts, missing validation for external input

### NEVER Comment On (Time Wasters)
- **Style/formatting**: Let automated tools handle this
- **Working code**: If it functions correctly, leave it alone  
- **Personal preferences**: "I would have done this differently"
- **Nitpicks**: Variable names, spacing, minor wording
- **Compliments**: Don't waste time praising obvious competence

## GIT REPOSITORY ACCESS

You are running in a git repository with full access to:
- git diff, git show, git log for understanding changes and context
- git blame for code ownership and history
- All project files for architectural understanding
- Use these commands to provide comprehensive, accurate reviews

## FINAL TASK INSTRUCTION

**ANALYZE THE CODE CHANGES NOW AND OUTPUT YOUR INLINE COMMENTS IMMEDIATELY.**

Your output format must be:
```
<response>
[]
</response>
```
(Empty array for clean code - this is GOOD!)

OR:

```
<response>
[{"file": "auth.js", "line": 42, "message": "🤖 SQL injection vulnerability: query uses string concatenation"}]
</response>
```
(Only comment on real problems)

**CRITICAL REQUIREMENTS**:
- Every message must start with "🤖 "
- Never use backticks in your response
- Empty arrays are encouraged for clean code
- Focus on bugs, security, crashes - ignore style preferences  
- Use git commands to understand context before commenting
- NO TEXT OUTSIDE THE <response></response> TAGS

**DO YOUR ANALYSIS NOW. STOP ASKING QUESTIONS. GENERATE THE REVIEW.**