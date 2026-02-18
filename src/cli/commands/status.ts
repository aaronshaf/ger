import { Effect } from 'effect'
import { GerritApiService } from '@/api/gerrit'

interface StatusOptions {
  xml?: boolean
  json?: boolean
}

export const statusCommand = (
  options: StatusOptions,
): Effect.Effect<void, Error, GerritApiService> =>
  Effect.gen(function* () {
    const apiService = yield* GerritApiService

    const isConnected = yield* apiService.testConnection

    if (options.json) {
      // JSON output
      console.log(
        JSON.stringify(
          { status: isConnected ? 'success' : 'error', connected: isConnected },
          null,
          2,
        ),
      )
    } else if (options.xml) {
      // XML output for LLM consumption
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<status_result>`)
      console.log(`  <connected>${isConnected}</connected>`)
      console.log(`</status_result>`)
    } else {
      // Pretty output by default
      if (isConnected) {
        console.log('✓ Connected to Gerrit successfully!')
      } else {
        console.log('✗ Failed to connect to Gerrit')
        console.log('Please check your credentials and network connection')
      }
    }

    if (!isConnected) {
      yield* Effect.fail(new Error('Connection failed'))
    }
  })
