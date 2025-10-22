import { mock } from 'bun:test'
import { Schema } from '@effect/schema'
import { ChangeInfo } from '@/schemas/gerrit'
import {
  generateMockAccount,
  generateMockChange,
  generateMockFileDiff,
  generateMockFiles,
} from '@/test-utils/mock-generator'

// Generate consistent mock data using Effect Schema
const mockChange = generateMockChange()
const mockFiles = generateMockFiles()
const mockDiff = generateMockFileDiff()
const mockAccount = generateMockAccount()

// Keep the old mockChange definition for now as backup (disabled to fix unused variable)
// const _mockChange: Schema.Schema.Type<typeof ChangeInfo> = {
//   id: 'myProject~master~I8473b95934b5732ac55d26311a706c9c2bde9940',
//   project: 'myProject',
//   branch: 'master',
//   change_id: 'I8473b95934b5732ac55d26311a706c9c2bde9940',
//   subject: 'Implementing new feature',
//   status: 'NEW',
//   created: '2023-12-01 10:00:00.000000000',
//   updated: '2023-12-01 12:00:00.000000000',
//   _number: 123456,
//   owner: {
//     _account_id: 1000000,
//     name: 'John Doe',
//     email: 'john.doe@example.com',
//   },
//   labels: {},
//   permitted_labels: {},
//   removable_reviewers: [],
//   reviewers: {},
//   requirements: [],
// }

export const setupFetchMock = (): ((
  url: string | URL,
  options?: RequestInit,
) => Promise<Response>) => {
  return mock(async (url: string | URL, options?: RequestInit): Promise<Response> => {
    const urlStr = url.toString()
    const method = options?.method || 'GET'

    // Check authentication
    const authHeader =
      options?.headers && 'Authorization' in options.headers
        ? (options.headers as Record<string, string>).Authorization
        : undefined

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return new Response(`)]}'\n${JSON.stringify({ message: 'Unauthorized' })}`, { status: 401 })
    }

    // Authentication endpoint
    if (urlStr.includes('/a/accounts/self')) {
      return new Response(`)]}'\n${JSON.stringify(mockAccount)}`, { status: 200 })
    }

    // List changes endpoint (must come before get change endpoint)
    if (urlStr.includes('/a/changes/?q=')) {
      return new Response(`)]}'\n${JSON.stringify([mockChange])}`, { status: 200 })
    }

    // Get change endpoint
    if (
      urlStr.includes('/a/changes/') &&
      method === 'GET' &&
      !urlStr.includes('/files') &&
      !urlStr.includes('/diff') &&
      !urlStr.includes('/patch') &&
      !urlStr.includes('/review')
    ) {
      if (urlStr.includes('notfound')) {
        return new Response(`)]}'\n${JSON.stringify({ message: 'Not found' })}`, { status: 404 })
      }

      // Validate response against schema
      const validated = Schema.decodeUnknownSync(ChangeInfo)(mockChange)
      return new Response(`)]}'\n${JSON.stringify(validated)}`, { status: 200 })
    }

    // Get file diff endpoint - must be checked BEFORE other file endpoints
    if (urlStr.includes('/files/') && urlStr.includes('/diff') && method === 'GET') {
      return new Response(`)]}'\n${JSON.stringify(mockDiff)}`, { status: 200 })
    }

    // Get files endpoint (list of files)
    if (
      urlStr.includes('/files') &&
      method === 'GET' &&
      !urlStr.includes('/diff') &&
      !urlStr.includes('/content')
    ) {
      return new Response(`)]}'\n${JSON.stringify(mockFiles)}`, { status: 200 })
    }

    // Get file content endpoint
    if (urlStr.includes('/content') && method === 'GET' && !urlStr.includes('/diff')) {
      const content =
        'function main() {\n  console.log("Hello, world!")\n  return process.exit(0)\n}'
      const base64Content = btoa(content)
      return new Response(base64Content, { status: 200 })
    }

    // Get patch endpoint
    if (urlStr.includes('/patch') && method === 'GET') {
      const patch = `--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,3 @@
 function main() {
   console.log("Hello, world!")
-  return 0
+  return process.exit(0)
 }`
      const base64Patch = btoa(patch)
      return new Response(base64Patch, { status: 200 })
    }

    // Post review endpoint
    if (urlStr.includes('/review') && method === 'POST') {
      return new Response(
        ")]}'\n" +
          JSON.stringify({
            labels: {},
            ready: true,
          }),
        { status: 200 },
      )
    }

    // Default 404 for unhandled requests
    return new Response(`)]}'\n${JSON.stringify({ message: 'Not found' })}`, { status: 404 })
  })
}

export const restoreFetch: () => void = () => {
  // Restore original fetch (Bun handles this automatically after tests)
}
