import { Context, Data, Effect, Layer } from 'effect'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// Error types
export class AiServiceError extends Data.TaggedError('AiServiceError')<{
  message: string
  cause?: unknown
}> {}

export class NoAiToolFoundError extends Data.TaggedError('NoAiToolFoundError')<{
  message: string
}> {}

export class AiResponseParseError extends Data.TaggedError('AiResponseParseError')<{
  message: string
  rawOutput: string
}> {}

// Service interface
export class AiService extends Context.Tag('AiService')<
  AiService,
  {
    readonly runPrompt: (
      prompt: string,
      input?: string,
      options?: { cwd?: string },
    ) => Effect.Effect<string, AiServiceError | NoAiToolFoundError | AiResponseParseError>
    readonly detectAiTool: () => Effect.Effect<string, NoAiToolFoundError>
    readonly extractResponseTag: (output: string) => Effect.Effect<string, AiResponseParseError>
  }
>() {}

// Service implementation
export const AiServiceLive = Layer.succeed(
  AiService,
  AiService.of({
    detectAiTool: () =>
      Effect.gen(function* () {
        // Try to detect available AI tools in order of preference
        const tools = ['claude', 'llm', 'opencode', 'gemini']

        for (const tool of tools) {
          const result = yield* Effect.tryPromise({
            try: () => execAsync(`which ${tool}`),
            catch: () => null,
          }).pipe(Effect.orElseSucceed(() => null))

          if (result && result.stdout.trim()) {
            return tool
          }
        }

        return yield* Effect.fail(
          new NoAiToolFoundError({
            message: 'No AI tool found. Please install claude, llm, opencode, or gemini CLI.',
          }),
        )
      }),

    extractResponseTag: (output: string) =>
      Effect.gen(function* () {
        // Extract content between <response> tags
        const responseMatch = output.match(/<response>([\s\S]*?)<\/response>/i)

        if (!responseMatch || !responseMatch[1]) {
          return yield* Effect.fail(
            new AiResponseParseError({
              message: 'No <response> tag found in AI output',
              rawOutput: output,
            }),
          )
        }

        return responseMatch[1].trim()
      }),

    runPrompt: (prompt: string, input: string = '', options: { cwd?: string } = {}) =>
      Effect.gen(function* () {
        const tool = yield* Effect.gen(function* () {
          // Try to detect available AI tools in order of preference
          const tools = ['claude', 'llm', 'opencode', 'gemini']

          for (const tool of tools) {
            const result = yield* Effect.tryPromise({
              try: () => execAsync(`which ${tool}`),
              catch: () => null,
            }).pipe(Effect.orElseSucceed(() => null))

            if (result && result.stdout.trim()) {
              return tool
            }
          }

          return yield* Effect.fail(
            new NoAiToolFoundError({
              message: 'No AI tool found. Please install claude, llm, opencode, or gemini CLI.',
            }),
          )
        })

        // Prepare the command based on the tool
        const fullInput = input ? `${prompt}\n\n${input}` : prompt
        let command: string

        switch (tool) {
          case 'claude':
            // Claude CLI uses -p flag for piped input
            command = 'claude -p'
            break
          case 'llm':
            // LLM CLI syntax
            command = 'llm'
            break
          case 'opencode':
            // Opencode CLI syntax
            command = 'opencode'
            break
          default:
            command = tool
        }

        // Run the AI tool with the prompt and input
        const result = yield* Effect.tryPromise({
          try: async () => {
            const child = require('node:child_process').spawn(command, {
              shell: true,
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: options.cwd || process.cwd(),
            })

            // Write input to stdin
            child.stdin.write(fullInput)
            child.stdin.end()

            // Collect output
            let stdout = ''
            let stderr = ''

            child.stdout.on('data', (data: Buffer) => {
              stdout += data.toString()
            })

            child.stderr.on('data', (data: Buffer) => {
              stderr += data.toString()
            })

            return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
              child.on('close', (code: number) => {
                if (code !== 0) {
                  reject(new Error(`AI tool exited with code ${code}: ${stderr}`))
                } else {
                  resolve({ stdout, stderr })
                }
              })

              child.on('error', reject)
            })
          },
          catch: (error) =>
            new AiServiceError({
              message: `Failed to run AI tool: ${error instanceof Error ? error.message : String(error)}`,
              cause: error,
            }),
        })

        // Debug: Log the raw output to help troubleshoot
        yield* Effect.logDebug(`AI tool raw output: ${JSON.stringify(result.stdout)}`)

        // Extract response tag
        const responseMatch = result.stdout.match(/<response>([\s\S]*?)<\/response>/i)

        if (!responseMatch || !responseMatch[1]) {
          // Enhanced error message with truncated output for debugging
          const truncatedOutput =
            result.stdout.length > 500
              ? result.stdout.substring(0, 500) + '...[truncated]'
              : result.stdout

          return yield* Effect.fail(
            new AiResponseParseError({
              message: `No <response> tag found in AI output. Raw output: ${truncatedOutput}`,
              rawOutput: result.stdout,
            }),
          )
        }

        return responseMatch[1].trim()
      }),
  }),
)
