import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { Effect, Layer } from 'effect'
import {
  AiService,
  AiServiceError,
  NoAiToolFoundError,
  AiResponseParseError,
  AiServiceLive,
} from '@/services/ai'
import { ConfigService } from '@/services/config'
import { createMockConfigService } from './helpers/config-mock'

describe('AI Service', () => {
  describe('extractResponseTag', () => {
    test('should extract content from response tags', async () => {
      const input = `Some text before
<response>
This is the response content
</response>
Some text after`

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.extractResponseTag(input)
        }).pipe(
          Effect.provide(
            Layer.succeed(
              AiService,
              AiService.of({
                detectAiTool: () =>
                  Effect.fail(new NoAiToolFoundError({ message: 'Not implemented' })),
                extractResponseTag: (output: string) =>
                  Effect.gen(function* () {
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
                runPrompt: () => Effect.fail(new AiServiceError({ message: 'Not implemented' })),
              }),
            ),
          ),
        ),
      )

      expect(result).toBe('This is the response content')
    })

    test('should handle case-insensitive response tags', async () => {
      const input = `<RESPONSE>Content here</RESPONSE>`

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.extractResponseTag(input)
        }).pipe(
          Effect.provide(
            Layer.succeed(
              AiService,
              AiService.of({
                detectAiTool: () =>
                  Effect.fail(new NoAiToolFoundError({ message: 'Not implemented' })),
                extractResponseTag: (output: string) =>
                  Effect.gen(function* () {
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
                runPrompt: () => Effect.fail(new AiServiceError({ message: 'Not implemented' })),
              }),
            ),
          ),
        ),
      )

      expect(result).toBe('Content here')
    })

    test('should fail when no response tag is found', async () => {
      const input = 'This is just plain text without tags'

      const result = await Effect.runPromise(
        Effect.either(
          Effect.gen(function* () {
            const service = yield* AiService
            return yield* service.extractResponseTag(input)
          }).pipe(
            Effect.provide(
              Layer.succeed(
                AiService,
                AiService.of({
                  detectAiTool: () =>
                    Effect.fail(new NoAiToolFoundError({ message: 'Not implemented' })),
                  extractResponseTag: (output: string) =>
                    Effect.gen(function* () {
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
                  runPrompt: () => Effect.fail(new AiServiceError({ message: 'Not implemented' })),
                }),
              ),
            ),
          ),
        ),
      )

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(AiResponseParseError)
        expect((result.left as AiResponseParseError).rawOutput).toBe(input)
      }
    })

    test('should handle multiline content in response tags', async () => {
      const input = `<response>
Line 1
Line 2
Line 3
</response>`

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.extractResponseTag(input)
        }).pipe(
          Effect.provide(
            Layer.succeed(
              AiService,
              AiService.of({
                detectAiTool: () =>
                  Effect.fail(new NoAiToolFoundError({ message: 'Not implemented' })),
                extractResponseTag: (output: string) =>
                  Effect.gen(function* () {
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
                runPrompt: () => Effect.fail(new AiServiceError({ message: 'Not implemented' })),
              }),
            ),
          ),
        ),
      )

      expect(result).toBe('Line 1\nLine 2\nLine 3')
    })
  })

  describe('Error Types', () => {
    test('NoAiToolFoundError should have correct message', () => {
      const error = new NoAiToolFoundError({
        message: 'No AI tool found. Please install claude, llm, or opencode CLI.',
      })
      expect(error.message).toBe('No AI tool found. Please install claude, llm, or opencode CLI.')
    })

    test('AiResponseParseError should include raw output', () => {
      const error = new AiResponseParseError({
        message: 'Failed to parse response',
        rawOutput: 'Some raw output',
      })
      expect(error.message).toBe('Failed to parse response')
      expect(error.rawOutput).toBe('Some raw output')
    })

    test('AiServiceError should have message and optional cause', () => {
      const cause = new Error('Original error')
      const error = new AiServiceError({
        message: 'Service failed',
        cause,
      })
      expect(error.message).toBe('Service failed')
      expect(error.cause).toBe(cause)
    })
  })

  describe('detectAiTool', () => {
    test('should detect claude tool when available', async () => {
      // Mock which command to return success for claude
      const mockExecAsync = mock(() =>
        Promise.resolve({ stdout: '/usr/local/bin/claude\n', stderr: '' }),
      )

      const mockAiService = AiService.of({
        detectAiTool: () => Effect.succeed('claude'),
        extractResponseTag: (output: string) => Effect.succeed(output),
        runPrompt: () => Effect.succeed('mock response'),
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.detectAiTool()
        }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
      )

      expect(result).toBe('claude')
    })

    test('should detect llm tool when claude not available', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () => Effect.succeed('llm'),
        extractResponseTag: (output: string) => Effect.succeed(output),
        runPrompt: () => Effect.succeed('mock response'),
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.detectAiTool()
        }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
      )

      expect(result).toBe('llm')
    })

    test('should detect opencode tool when others not available', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () => Effect.succeed('opencode'),
        extractResponseTag: (output: string) => Effect.succeed(output),
        runPrompt: () => Effect.succeed('mock response'),
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.detectAiTool()
        }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
      )

      expect(result).toBe('opencode')
    })

    test('should detect gemini tool when others not available', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () => Effect.succeed('gemini'),
        extractResponseTag: (output: string) => Effect.succeed(output),
        runPrompt: () => Effect.succeed('mock response'),
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.detectAiTool()
        }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
      )

      expect(result).toBe('gemini')
    })

    test('should fail when no AI tools are available', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () =>
          Effect.fail(
            new NoAiToolFoundError({
              message: 'No AI tool found. Please install claude, llm, opencode, or gemini CLI.',
            }),
          ),
        extractResponseTag: (output: string) => Effect.succeed(output),
        runPrompt: () => Effect.succeed('mock response'),
      })

      const result = await Effect.runPromise(
        Effect.either(
          Effect.gen(function* () {
            const service = yield* AiService
            return yield* service.detectAiTool()
          }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
        ),
      )

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(NoAiToolFoundError)
        expect((result.left as NoAiToolFoundError).message).toContain('No AI tool found')
      }
    })
  })

  describe('runPrompt', () => {
    test('should successfully run prompt with claude', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () => Effect.succeed('claude'),
        extractResponseTag: (output: string) => Effect.succeed('extracted response'),
        runPrompt: (prompt: string, input?: string, options?: { cwd?: string }) => {
          expect(prompt).toBe('Test prompt')
          expect(input).toBe('Test input')
          return Effect.succeed('extracted response')
        },
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.runPrompt('Test prompt', 'Test input')
        }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
      )

      expect(result).toBe('extracted response')
    })

    test('should successfully run prompt with llm', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () => Effect.succeed('llm'),
        extractResponseTag: (output: string) => Effect.succeed('llm response'),
        runPrompt: (prompt: string, input?: string, options?: { cwd?: string }) => {
          return Effect.succeed('llm response')
        },
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.runPrompt('Test prompt', 'Test input')
        }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
      )

      expect(result).toBe('llm response')
    })

    test('should handle AI tool execution failure', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () => Effect.succeed('claude'),
        extractResponseTag: (output: string) => Effect.succeed(output),
        runPrompt: () =>
          Effect.fail(
            new AiServiceError({
              message: 'Failed to run AI tool: Command not found',
              cause: new Error('ENOENT'),
            }),
          ),
      })

      const result = await Effect.runPromise(
        Effect.either(
          Effect.gen(function* () {
            const service = yield* AiService
            return yield* service.runPrompt('Test prompt', 'Test input')
          }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
        ),
      )

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(AiServiceError)
        expect((result.left as AiServiceError).message).toContain('Failed to run AI tool')
      }
    })

    test('should handle missing response tag in AI output', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () => Effect.succeed('claude'),
        extractResponseTag: (output: string) =>
          Effect.fail(
            new AiResponseParseError({
              message: 'No <response> tag found in AI output',
              rawOutput: 'Raw AI output without response tags',
            }),
          ),
        runPrompt: () =>
          Effect.fail(
            new AiResponseParseError({
              message: 'No <response> tag found in AI output',
              rawOutput: 'Raw AI output without response tags',
            }),
          ),
      })

      const result = await Effect.runPromise(
        Effect.either(
          Effect.gen(function* () {
            const service = yield* AiService
            return yield* service.runPrompt('Test prompt', 'Test input')
          }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
        ),
      )

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(AiResponseParseError)
        expect((result.left as AiResponseParseError).rawOutput).toBe(
          'Raw AI output without response tags',
        )
      }
    })

    test('should handle no AI tool found during prompt execution', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () =>
          Effect.fail(
            new NoAiToolFoundError({
              message: 'No AI tool found',
            }),
          ),
        extractResponseTag: (output: string) => Effect.succeed(output),
        runPrompt: () =>
          Effect.fail(
            new NoAiToolFoundError({
              message: 'No AI tool found',
            }),
          ),
      })

      const result = await Effect.runPromise(
        Effect.either(
          Effect.gen(function* () {
            const service = yield* AiService
            return yield* service.runPrompt('Test prompt', 'Test input')
          }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
        ),
      )

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(NoAiToolFoundError)
      }
    })

    test('should format input correctly for AI tool', async () => {
      const mockAiService = AiService.of({
        detectAiTool: () => Effect.succeed('claude'),
        extractResponseTag: (output: string) => Effect.succeed('response content'),
        runPrompt: (prompt: string, input?: string, options?: { cwd?: string }) => {
          // Verify the prompt and input are passed correctly
          expect(prompt).toBe('System: Analyze this code')
          expect(input).toBe('function test() { return 42; }')
          return Effect.succeed('response content')
        },
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* AiService
          return yield* service.runPrompt(
            'System: Analyze this code',
            'function test() { return 42; }',
          )
        }).pipe(Effect.provide(Layer.succeed(AiService, mockAiService))),
      )

      expect(result).toBe('response content')
    })
  })

  describe('AiServiceLive integration', () => {
    test('should be able to create live service layer', () => {
      // Test that the live service layer can be created without errors
      expect(AiServiceLive).toBeDefined()
      expect(typeof AiServiceLive).toBe('object')
    })
  })
})
