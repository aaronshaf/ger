import { Effect, Layer } from 'effect'
import { AiService, AiServiceError, NoAiToolFoundError, AiResponseParseError } from './ai'
import { ConfigService, ConfigServiceLive } from './config'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// Enhanced AI Service that uses configuration
export const AiServiceEnhanced = Layer.effect(
  AiService,
  Effect.gen(function* () {
    const configService = yield* ConfigService

    const detectAiTool = () =>
      Effect.gen(function* () {
        // First check configured preference
        const aiConfig = yield* configService.getAiConfig.pipe(
          Effect.orElseSucceed(() => ({ autoDetect: true })),
        )

        if ('tool' in aiConfig && aiConfig.tool && !aiConfig.autoDetect) {
          // Check if configured tool is available
          const result = yield* Effect.tryPromise({
            try: () => execAsync(`which ${aiConfig.tool}`),
            catch: () => null,
          }).pipe(Effect.orElseSucceed(() => null))

          if (result && result.stdout.trim()) {
            return aiConfig.tool
          }

          // Configured tool not available, fall back to auto-detect
          yield* Effect.logWarning(
            `Configured AI tool '${aiConfig.tool}' not found, auto-detecting...`,
          )
        }

        // Auto-detect available tools
        const tools =
          'tool' in aiConfig && aiConfig.tool
            ? [aiConfig.tool, 'claude', 'llm', 'opencode', 'gemini'].filter(
                (v, i, a) => a.indexOf(v) === i,
              )
            : ['claude', 'llm', 'opencode', 'gemini']

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

    const extractResponseTag = (output: string) =>
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
      })

    const runPrompt = (prompt: string, input: string = '', options: { cwd?: string } = {}) =>
      Effect.gen(function* () {
        const tool = yield* detectAiTool()

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
          case 'gemini':
            // Gemini CLI syntax (adjust as needed)
            command = 'gemini'
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

        // Extract response tag
        return yield* extractResponseTag(result.stdout)
      })

    return AiService.of({
      detectAiTool,
      extractResponseTag,
      runPrompt,
    })
  }),
).pipe(Layer.provide(ConfigServiceLive))

// Export a simpler Live layer for backward compatibility
export const AiServiceLive = AiServiceEnhanced
