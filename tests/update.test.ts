import { describe, test, expect, mock, spyOn, afterEach } from 'bun:test'
import { Effect } from 'effect'
import * as childProcess from 'node:child_process'
import { updateCommand } from '@/cli/commands/update'

describe('update command', () => {
  let execSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    execSpy?.mockRestore()
    global.fetch = fetch
  })

  test('skips install when already up to date', async () => {
    execSpy = spyOn(childProcess, 'execSync').mockImplementation((() =>
      Buffer.from('')) as unknown as typeof childProcess.execSync)
    global.fetch = (async () => Response.json({ version: '0.0.0' })) as unknown as typeof fetch

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(updateCommand({}))
    } finally {
      console.log = origLog
    }

    expect(logs.join('\n')).toContain('Already up to date')
    expect(execSpy.mock.calls.length).toBe(0)
  })

  test('runs bun install when newer version available', async () => {
    execSpy = spyOn(childProcess, 'execSync').mockImplementation((() =>
      Buffer.from('')) as unknown as typeof childProcess.execSync)
    global.fetch = (async () => Response.json({ version: '999.0.0' })) as unknown as typeof fetch

    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => logs.push(String(args[0]))

    try {
      await Effect.runPromise(updateCommand({}))
    } finally {
      console.log = origLog
    }

    const calls = (execSpy.mock.calls as unknown as [string][]).map(([c]) => c)
    expect(calls.some((c) => c.includes('bun install -g') && c.includes('@aaronshaf/ger'))).toBe(
      true,
    )
    expect(logs.join('\n')).toContain('updated successfully')
  })

  test('--skip-pull installs without version check', async () => {
    execSpy = spyOn(childProcess, 'execSync').mockImplementation((() =>
      Buffer.from('')) as unknown as typeof childProcess.execSync)
    const fetchSpy = mock(async () => Response.json({ version: '999.0.0' }))
    global.fetch = fetchSpy as unknown as typeof fetch

    await Effect.runPromise(updateCommand({ skipPull: true }))

    expect(fetchSpy.mock.calls.length).toBe(0)
    const calls = (execSpy.mock.calls as unknown as [string][]).map(([c]) => c)
    expect(calls.some((c) => c.includes('bun install -g'))).toBe(true)
  })

  test('fails when registry is unreachable', async () => {
    global.fetch = (async () => {
      throw new Error('network error')
    }) as unknown as typeof fetch

    const result = await Effect.runPromise(updateCommand({}).pipe(Effect.either))
    expect(result._tag).toBe('Left')
  })

  test('fails when install command fails', async () => {
    execSpy = spyOn(childProcess, 'execSync').mockImplementation((() => {
      throw new Error('bun not found')
    }) as unknown as typeof childProcess.execSync)
    global.fetch = (async () => Response.json({ version: '999.0.0' })) as unknown as typeof fetch

    const result = await Effect.runPromise(updateCommand({}).pipe(Effect.either))
    expect(result._tag).toBe('Left')
  })
})
