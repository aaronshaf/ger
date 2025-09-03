import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { Effect } from 'effect'

// Create testable versions of the strategies by injecting dependencies
interface MockDeps {
  execAsync: (cmd: string) => Promise<{ stdout: string; stderr: string }>
  spawn: (command: string, options: any) => any
}

// Test implementation that mirrors the real strategy structure
const createTestStrategy = (name: string, command: string, flags: string[], deps: MockDeps) => ({
  name,
  isAvailable: () =>
    Effect.gen(function* () {
      try {
        const result = yield* Effect.tryPromise({
          try: () => deps.execAsync(`which ${command.split(' ')[0]}`),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null))

        return Boolean(result && result.stdout.trim())
      } catch {
        return false
      }
    }),
  executeReview: (prompt: string, options: { cwd?: string } = {}) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          const child = deps.spawn(`${command} ${flags.join(' ')}`, {
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
                reject(new Error(`${name} exited with code ${code}: ${stderr}`))
              } else {
                resolve({ stdout, stderr })
              }
            })

            child.on('error', reject)
          })
        },
        catch: (error) =>
          new Error(`${name} failed: ${error instanceof Error ? error.message : String(error)}`),
      })

      // Extract response from <response> tags or use full output
      const responseMatch = result.stdout.match(/<response>([\s\S]*?)<\/response>/i)
      return responseMatch ? responseMatch[1].trim() : result.stdout.trim()
    }),
})

describe('Review Strategy', () => {
  let mockExecAsync: any
  let mockSpawn: any
  let mockChildProcess: any

  beforeEach(() => {
    mockChildProcess = {
      stdin: {
        write: mock(() => {}),
        end: mock(() => {}),
      },
      stdout: {
        on: mock(() => {}),
      },
      stderr: {
        on: mock(() => {}),
      },
      on: mock(() => {}),
    }

    mockExecAsync = mock()
    mockSpawn = mock(() => mockChildProcess)
  })

  const setupSuccessfulExecution = (output = 'AI response') => {
    mockChildProcess.stdout.on.mockImplementation((event: string, callback: Function) => {
      if (event === 'data') {
        process.nextTick(() => callback(Buffer.from(output)))
      }
    })

    mockChildProcess.stderr.on.mockImplementation((event: string, callback: Function) => {
      // No stderr for success
    })

    mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
      if (event === 'close') {
        process.nextTick(() => callback(0))
      }
    })
  }

  const setupFailedExecution = (exitCode = 1, stderr = 'Command failed') => {
    mockChildProcess.stdout.on.mockImplementation((event: string, callback: Function) => {
      // No stdout for failure
    })

    mockChildProcess.stderr.on.mockImplementation((event: string, callback: Function) => {
      if (event === 'data') {
        process.nextTick(() => callback(Buffer.from(stderr)))
      }
    })

    mockChildProcess.on.mockImplementation((event: string, callback: Function) => {
      if (event === 'close') {
        process.nextTick(() => callback(exitCode))
      }
    })
  }

  describe('Claude CLI Strategy', () => {
    let claudeStrategy: any

    beforeEach(() => {
      claudeStrategy = createTestStrategy('Claude CLI', 'claude', ['-p'], {
        execAsync: mockExecAsync,
        spawn: mockSpawn,
      })
    })

    it('should check availability when claude is installed', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: '/usr/local/bin/claude', stderr: '' })

      const available = await Effect.runPromise(claudeStrategy.isAvailable())

      expect(available).toBe(true)
      expect(mockExecAsync).toHaveBeenCalledWith('which claude')
    })

    it('should check availability when claude is not installed', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('Command not found'))

      const available = await Effect.runPromise(claudeStrategy.isAvailable())

      expect(available).toBe(false)
    })

    it('should execute review successfully', async () => {
      setupSuccessfulExecution('Claude AI response')

      const response = await Effect.runPromise(
        claudeStrategy.executeReview('Test prompt', { cwd: '/tmp' }),
      )

      expect(response).toBe('Claude AI response')
      expect(mockSpawn).toHaveBeenCalledWith('claude -p', {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/tmp',
      })
      expect(mockChildProcess.stdin.write).toHaveBeenCalledWith('Test prompt')
      expect(mockChildProcess.stdin.end).toHaveBeenCalled()
    })

    it('should extract response from tags', async () => {
      setupSuccessfulExecution('<response>Tagged content</response>')

      const response = await Effect.runPromise(claudeStrategy.executeReview('Test prompt'))

      expect(response).toBe('Tagged content')
    })

    it('should handle command failures', async () => {
      setupFailedExecution(1, 'Claude CLI error')

      try {
        await Effect.runPromise(claudeStrategy.executeReview('Test prompt'))
        expect(false).toBe(true) // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('Claude CLI failed')
      }
    })
  })

  describe('Gemini CLI Strategy', () => {
    let geminiStrategy: any

    beforeEach(() => {
      geminiStrategy = createTestStrategy('Gemini CLI', 'gemini', ['-p'], {
        execAsync: mockExecAsync,
        spawn: mockSpawn,
      })
    })

    it('should check availability', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: '/usr/local/bin/gemini', stderr: '' })

      const available = await Effect.runPromise(geminiStrategy.isAvailable())

      expect(available).toBe(true)
      expect(mockExecAsync).toHaveBeenCalledWith('which gemini')
    })

    it('should use -p flag', async () => {
      setupSuccessfulExecution('Gemini response')

      const response = await Effect.runPromise(geminiStrategy.executeReview('Test prompt'))

      expect(response).toBe('Gemini response')
      expect(mockSpawn).toHaveBeenCalledWith('gemini -p', expect.any(Object))
    })

    it('should extract response from tags', async () => {
      setupSuccessfulExecution('<response>Gemini tagged content</response>')

      const response = await Effect.runPromise(geminiStrategy.executeReview('Test prompt'))

      expect(response).toBe('Gemini tagged content')
    })
  })

  describe('OpenCode CLI Strategy', () => {
    let opencodeStrategy: any

    beforeEach(() => {
      opencodeStrategy = createTestStrategy('OpenCode CLI', 'opencode', ['-p'], {
        execAsync: mockExecAsync,
        spawn: mockSpawn,
      })
    })

    it('should check availability', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: '/usr/local/bin/opencode', stderr: '' })

      const available = await Effect.runPromise(opencodeStrategy.isAvailable())

      expect(available).toBe(true)
      expect(mockExecAsync).toHaveBeenCalledWith('which opencode')
    })

    it('should use -p flag', async () => {
      setupSuccessfulExecution('OpenCode response')

      const response = await Effect.runPromise(opencodeStrategy.executeReview('Test prompt'))

      expect(response).toBe('OpenCode response')
      expect(mockSpawn).toHaveBeenCalledWith('opencode -p', expect.any(Object))
    })

    it('should extract response from tags', async () => {
      setupSuccessfulExecution('<response>OpenCode tagged content</response>')

      const response = await Effect.runPromise(opencodeStrategy.executeReview('Test prompt'))

      expect(response).toBe('OpenCode tagged content')
    })
  })

  describe('Integration with actual service patterns', () => {
    it('should demonstrate proper Effect patterns', async () => {
      const mockStrategy = createTestStrategy('Mock CLI', 'mock', [], {
        execAsync: mockExecAsync,
        spawn: mockSpawn,
      })

      setupSuccessfulExecution('Integration test response')

      // Test using Effect.gen patterns like the real service
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          // Test availability check
          mockExecAsync.mockResolvedValueOnce({ stdout: '/usr/local/bin/mock', stderr: '' })
          const available = yield* mockStrategy.isAvailable()

          if (!available) {
            return yield* Effect.fail(new Error('Strategy not available'))
          }

          // Test execution
          const response = yield* mockStrategy.executeReview('Test prompt', { cwd: '/tmp' })
          return response
        }),
      )

      expect(result).toBe('Integration test response')
    })

    it('should handle error propagation correctly', async () => {
      const mockStrategy = createTestStrategy('Failing CLI', 'failing', [], {
        execAsync: mockExecAsync,
        spawn: mockSpawn,
      })

      setupFailedExecution(1, 'Mock failure')

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            return yield* mockStrategy.executeReview('Test prompt')
          }),
        )
        expect(false).toBe(true) // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('Failing CLI failed')
      }
    })

    it('should test multiple strategy selection logic', async () => {
      const strategies = [
        createTestStrategy('Strategy A', 'a', [], { execAsync: mockExecAsync, spawn: mockSpawn }),
        createTestStrategy('Strategy B', 'b', [], { execAsync: mockExecAsync, spawn: mockSpawn }),
        createTestStrategy('Strategy C', 'c', [], { execAsync: mockExecAsync, spawn: mockSpawn }),
      ]

      // Mock availability checks: A fails, B succeeds, C succeeds
      mockExecAsync
        .mockRejectedValueOnce(new Error('Command not found')) // A not available
        .mockResolvedValueOnce({ stdout: '/usr/local/bin/b', stderr: '' }) // B available
        .mockResolvedValueOnce({ stdout: '/usr/local/bin/c', stderr: '' }) // C available

      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const availableStrategies = []
          for (const strategy of strategies) {
            const isAvailable = yield* strategy.isAvailable()
            if (isAvailable) {
              availableStrategies.push(strategy)
            }
          }
          return availableStrategies
        }),
      )

      expect(available.length).toBe(2)
      expect(available.map((s) => s.name)).toEqual(['Strategy B', 'Strategy C'])
    })
  })
})
