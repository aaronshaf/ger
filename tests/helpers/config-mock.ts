import { Effect } from 'effect'
import type { ConfigServiceImpl } from '@/services/config'
import type { GerritCredentials } from '@/schemas/gerrit'
import type { AppConfig } from '@/schemas/config'

export const createMockConfigService = (
  credentials: GerritCredentials = {
    host: 'https://test.gerrit.com',
    username: 'testuser',
    password: 'testpass',
  },
  retriggerComment?: string,
): ConfigServiceImpl => ({
  getCredentials: Effect.succeed(credentials),
  saveCredentials: () => Effect.succeed(undefined as void),
  deleteCredentials: Effect.succeed(undefined as void),
  getFullConfig: Effect.succeed({
    host: credentials.host,
    username: credentials.username,
    password: credentials.password,
    retriggerComment,
  } as AppConfig),
  saveFullConfig: () => Effect.succeed(undefined as void),
  getRetriggerComment: Effect.succeed(retriggerComment),
  saveRetriggerComment: () => Effect.succeed(undefined as void),
})
