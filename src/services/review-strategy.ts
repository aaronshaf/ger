import { Context, Data, Effect, Layer } from 'effect'
import { Console } from 'effect'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// Simple strategy focused only on review needs
export class ReviewStrategyError extends Data.TaggedError('ReviewStrategyError')<{
  message: string
  cause?: unknown
}> {}

// Review strategy interface - focused on specific review patterns
export interface ReviewStrategy {
  readonly name: string
  readonly isAvailable: () => Effect.Effect<boolean, never>
  readonly executeReview: (
    prompt: string,
    options?: { cwd?: string; systemPrompt?: string },
  ) => Effect.Effect<string, ReviewStrategyError>
}

// Strategy implementations for different AI tools
export const claudeCliStrategy: ReviewStrategy = {
  name: 'Claude CLI',
  isAvailable: () =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => execAsync('which claude'),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null))

      return Boolean(result && result.stdout.trim())
    }),
  executeReview: (prompt, options = {}) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          const child = require('node:child_process').spawn('claude -p', {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options.cwd || process.cwd(),
          })

          child.stdin.write(prompt)
          child.stdin.end()

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
                reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`))
              } else {
                resolve({ stdout, stderr })
              }
            })

            child.on('error', reject)
          })
        },
        catch: (error) =>
          new ReviewStrategyError({
            message: `Claude CLI failed: ${error instanceof Error ? error.message : String(error)}`,
            cause: error,
          }),
      })

      // Extract response from <response> tags or use full output
      const responseMatch = result.stdout.match(/<response>([\s\S]*?)<\/response>/i)
      return responseMatch ? responseMatch[1].trim() : result.stdout.trim()
    }),
}

export const geminiCliStrategy: ReviewStrategy = {
  name: 'Gemini CLI',
  isAvailable: () =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => execAsync('which gemini'),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null))

      return Boolean(result && result.stdout.trim())
    }),
  executeReview: (prompt, options = {}) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          const child = require('node:child_process').spawn('gemini -p', {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options.cwd || process.cwd(),
          })

          child.stdin.write(prompt)
          child.stdin.end()

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
                reject(new Error(`Gemini CLI exited with code ${code}: ${stderr}`))
              } else {
                resolve({ stdout, stderr })
              }
            })

            child.on('error', reject)
          })
        },
        catch: (error) =>
          new ReviewStrategyError({
            message: `Gemini CLI failed: ${error instanceof Error ? error.message : String(error)}`,
            cause: error,
          }),
      })

      return result.stdout.trim()
    }),
}

export const openCodeCliStrategy: ReviewStrategy = {
  name: 'OpenCode CLI',
  isAvailable: () =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => execAsync('which opencode'),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null))

      return Boolean(result && result.stdout.trim())
    }),
  executeReview: (prompt, options = {}) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          const child = require('node:child_process').spawn('opencode -p', {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options.cwd || process.cwd(),
          })

          child.stdin.write(prompt)
          child.stdin.end()

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
                reject(new Error(`OpenCode CLI exited with code ${code}: ${stderr}`))
              } else {
                resolve({ stdout, stderr })
              }
            })

            child.on('error', reject)
          })
        },
        catch: (error) =>
          new ReviewStrategyError({
            message: `OpenCode CLI failed: ${error instanceof Error ? error.message : String(error)}`,
            cause: error,
          }),
      })

      return result.stdout.trim()
    }),
}

export const codexCliStrategy: ReviewStrategy = {
  name: 'Codex CLI',
  isAvailable: () =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => execAsync('which codex'),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null))

      return Boolean(result && result.stdout.trim())
    }),
  executeReview: (prompt, options = {}) =>
    Effect.gen(function* () {
      const command = `codex exec "${prompt.replace(/"/g, '\\"')}"`

      const result = yield* Effect.tryPromise({
        try: () => execAsync(command, { cwd: options.cwd }),
        catch: (error) =>
          new ReviewStrategyError({
            message: `Codex CLI failed: ${error instanceof Error ? error.message : String(error)}`,
            cause: error,
          }),
      })

      return result.stdout.trim()
    }),
}

// Review service using strategy pattern
export class ReviewStrategyService extends Context.Tag('ReviewStrategyService')<
  ReviewStrategyService,
  {
    readonly getAvailableStrategies: () => Effect.Effect<ReviewStrategy[], never>
    readonly selectStrategy: (
      preferredName?: string,
    ) => Effect.Effect<ReviewStrategy, ReviewStrategyError>
    readonly executeWithStrategy: (
      strategy: ReviewStrategy,
      prompt: string,
      options?: { cwd?: string; systemPrompt?: string },
    ) => Effect.Effect<string, ReviewStrategyError>
  }
>() {}

export const ReviewStrategyServiceLive = Layer.succeed(
  ReviewStrategyService,
  ReviewStrategyService.of({
    getAvailableStrategies: () =>
      Effect.gen(function* () {
        const strategies = [
          claudeCliStrategy,
          geminiCliStrategy,
          openCodeCliStrategy,
          codexCliStrategy,
        ]
        const available: ReviewStrategy[] = []

        for (const strategy of strategies) {
          const isAvailable = yield* strategy.isAvailable()
          if (isAvailable) {
            available.push(strategy)
          }
        }

        return available
      }),

    selectStrategy: (preferredName?: string) =>
      Effect.gen(function* () {
        const strategies = [
          claudeCliStrategy,
          geminiCliStrategy,
          openCodeCliStrategy,
          codexCliStrategy,
        ]
        const available: ReviewStrategy[] = []

        for (const strategy of strategies) {
          const isAvailable = yield* strategy.isAvailable()
          if (isAvailable) {
            available.push(strategy)
          }
        }

        if (available.length === 0) {
          return yield* Effect.fail(
            new ReviewStrategyError({
              message: 'No AI tools available. Please install claude, gemini, or codex CLI.',
            }),
          )
        }

        if (preferredName) {
          const preferred = available.find((s: ReviewStrategy) =>
            s.name.toLowerCase().includes(preferredName.toLowerCase()),
          )
          if (preferred) {
            return preferred
          }
        }

        return available[0] // Return first available
      }),

    executeWithStrategy: (strategy, prompt, options = {}) =>
      strategy.executeReview(prompt, options),
  }),
)
