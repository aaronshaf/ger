import { HttpResponse, http, type HttpHandler } from 'msw'
import type { CommentInfo } from '@/schemas/gerrit'

export const commentHandlers: HttpHandler[] = [
  // Comments endpoint
  http.get('*/a/changes/:changeId/revisions/:revisionId/comments', () => {
    const mockComments: Record<string, CommentInfo[]> = {
      '/COMMIT_MSG': [
        {
          id: 'comment1',
          message: 'Please update the commit message',
          author: {
            name: 'Reviewer 1',
            email: 'reviewer1@example.com',
            _account_id: 1001,
          },
          updated: '2024-01-15 10:30:00.000000000',
          unresolved: true,
          line: 3,
        },
      ],
      'src/main.ts': [
        {
          id: 'comment2',
          message: 'Consider using a more descriptive variable name',
          author: {
            name: 'Reviewer 2',
            email: 'reviewer2@example.com',
            _account_id: 1002,
          },
          updated: '2024-01-15 11:45:00.000000000',
          unresolved: false,
          line: 42,
        },
        {
          id: 'comment3',
          message: 'This could be simplified',
          author: {
            name: 'Reviewer 1',
            _account_id: 1001,
          },
          updated: '2024-01-15 12:00:00.000000000',
          line: 67,
        },
      ],
    }

    return HttpResponse.text(`)]}'\n${JSON.stringify(mockComments)}`)
  }),

  // File diff endpoint
  http.get('*/a/changes/:changeId/revisions/:revisionId/files/:filePath/diff', () => {
    const mockDiff = {
      content: [
        {
          ab: ['function calculateTotal(items) {', '  let total = 0;'],
        },
        {
          b: [
            '  // TODO: Add validation',
            '  for (const item of items) {',
            '    total += item.price * item.quantity;',
            '  }',
          ],
        },
        {
          ab: ['  return total;', '}'],
        },
      ],
    }

    return HttpResponse.text(`)]}'\n${JSON.stringify(mockDiff)}`)
  }),
]

export const emptyCommentsHandlers: HttpHandler[] = [
  http.get('*/a/changes/:changeId/revisions/:revisionId/comments', () => {
    return HttpResponse.text(`)]}'\n{}`)
  }),
]
