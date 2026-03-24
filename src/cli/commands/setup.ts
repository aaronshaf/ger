import chalk from 'chalk'
import { Effect, pipe, Console } from 'effect'
import {
  ConfigService,
  ConfigServiceLive,
  ConfigError,
  type ConfigServiceImpl,
} from '@/services/config'
import type { GerritCredentials } from '@/schemas/gerrit'
import { AppConfig } from '@/schemas/config'
import { Schema } from '@effect/schema'
import { input, password } from '@inquirer/prompts'
import { normalizeGerritHost } from '@/utils/url-parser'

// Effect wrapper for getting existing config
const getExistingConfig = (configService: ConfigServiceImpl) =>
  configService.getFullConfig.pipe(Effect.orElseSucceed(() => null))

// Test connection with credentials
const verifyCredentials = (credentials: GerritCredentials) =>
  Effect.tryPromise({
    try: async () => {
      const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
      const response = await fetch(`${credentials.host}/a/config/server/version`, {
        headers: { Authorization: `Basic ${auth}` },
      })

      if (!response.ok) {
        throw new Error(`Authentication failed: ${response.status}`)
      }

      return response.ok
    },
    catch: (error) => {
      if (error instanceof Error) {
        // Authentication/permission errors
        if (error.message.includes('401')) {
          return new ConfigError({
            message: 'Invalid credentials. Please check your username and password.',
          })
        }
        if (error.message.includes('403')) {
          return new ConfigError({
            message: 'Access denied. Please verify your credentials and server permissions.',
          })
        }

        // Network/hostname errors
        if (error.message.includes('ENOTFOUND')) {
          return new ConfigError({
            message: `Hostname not found. Please check that the Gerrit URL is correct.\nExample: https://gerrit.example.com (without /a/ or paths)`,
          })
        }
        if (error.message.includes('ECONNREFUSED')) {
          return new ConfigError({
            message: `Connection refused. The server may be down or the port may be incorrect.\nPlease verify the URL and try again.`,
          })
        }
        if (error.message.includes('ETIMEDOUT')) {
          return new ConfigError({
            message: `Connection timed out. Please check:\n• Your internet connection\n• The Gerrit server URL\n• Any firewall or VPN settings`,
          })
        }
        if (error.message.includes('certificate') || error.message.includes('SSL')) {
          return new ConfigError({
            message: `SSL/Certificate error. Please ensure the URL uses HTTPS and the certificate is valid.`,
          })
        }

        // URL format errors
        if (error.message.includes('Invalid URL') || error.message.includes('fetch failed')) {
          return new ConfigError({
            message: `Invalid URL format. Please use the full URL including https://\nExample: https://gerrit.example.com`,
          })
        }

        // Generic network errors
        if (error.message.includes('network') || error.message.includes('fetch')) {
          return new ConfigError({
            message: `Network error: ${error.message}\nPlease check your connection and the Gerrit server URL.`,
          })
        }

        return new ConfigError({ message: error.message })
      }
      return new ConfigError({ message: 'Unknown error occurred' })
    },
  })

// Pure Effect-based setup implementation using inquirer
const setupEffect = (configService: ConfigServiceImpl) =>
  pipe(
    getExistingConfig(configService),
    Effect.flatMap((existingConfig) =>
      pipe(
        Console.log(chalk.bold('🔧 Gerrit CLI Setup')),
        Effect.flatMap(() => Console.log('')),
        Effect.flatMap(() => {
          if (existingConfig) {
            return Console.log(chalk.dim('(Press Enter to keep existing values)'))
          } else {
            return pipe(
              Console.log(chalk.cyan('Please provide your Gerrit connection details:')),
              Effect.flatMap(() =>
                Console.log(chalk.dim('Example URL: https://gerrit.example.com')),
              ),
              Effect.flatMap(() =>
                Console.log(
                  chalk.dim(
                    'You can find your HTTP password in Gerrit Settings > HTTP Credentials',
                  ),
                ),
              ),
            )
          }
        }),
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: async () => {
              console.log('')

              // Enable raw mode for proper password masking
              const wasRawMode = process.stdin.isRaw
              if (process.stdin.isTTY && !wasRawMode) {
                process.stdin.setRawMode(true)
              }

              try {
                // Gerrit Host URL
                const host = await input({
                  message: 'Gerrit Host URL (e.g., https://gerrit.example.com)',
                  default: existingConfig?.host,
                })

                // Username
                const username = await input({
                  message: 'Username (your Gerrit username)',
                  default: existingConfig?.username,
                })

                // Password - with proper masking and visual feedback
                const passwordMessage = existingConfig?.password
                  ? `HTTP Password (generated from Gerrit settings) ${chalk.dim('(press Enter to keep existing)')}`
                  : 'HTTP Password (generated from Gerrit settings)'

                const passwordValue =
                  (await password({
                    message: passwordMessage,
                    mask: true, // Show * characters as user types
                  })) ||
                  existingConfig?.password ||
                  ''

                console.log('')
                console.log(chalk.yellow('Optional: CI Retrigger'))
                console.log(
                  chalk.dim(
                    'Comment to post when triggering a CI build (e.g. a magic trigger string your CI watches for)',
                  ),
                )

                const retriggerComment = await input({
                  message: 'CI retrigger comment (leave blank to skip)',
                  default: existingConfig?.retriggerComment ?? undefined,
                })

                // Build flat config
                const configData = {
                  host: normalizeGerritHost(host),
                  username: username.trim(),
                  password: passwordValue,
                  ...(retriggerComment.trim() && {
                    retriggerComment: retriggerComment.trim(),
                  }),
                }

                // Validate config using Schema instead of type assertion
                const fullConfig = Schema.decodeUnknownSync(AppConfig)(configData)

                return fullConfig
              } finally {
                // Restore raw mode state
                if (process.stdin.isTTY && !wasRawMode) {
                  process.stdin.setRawMode(false)
                }
              }
            },
            catch: (error) => {
              if (error instanceof Error && error.message.includes('User force closed')) {
                console.log(`\n${chalk.yellow('Setup cancelled')}`)
                process.exit(0)
              }
              return new ConfigError({
                message: error instanceof Error ? error.message : 'Failed to get user input',
              })
            },
          }),
        ),
      ),
    ),
    Effect.tap(() => Console.log('\nVerifying credentials...')),
    Effect.flatMap((config) =>
      pipe(
        verifyCredentials({
          host: config.host,
          username: config.username,
          password: config.password,
        }),
        Effect.map(() => config),
      ),
    ),
    Effect.tap(() => Console.log(chalk.green('Successfully authenticated'))),
    Effect.flatMap((config) => configService.saveFullConfig(config)),
    Effect.tap(() => Console.log(chalk.green('\nConfiguration saved successfully!'))),
    Effect.tap(() => Console.log('You can now use:')),
    Effect.tap(() => Console.log('  • "ger mine" to view your changes')),
    Effect.tap(() => Console.log('  • "ger show <change-id>" to view change details')),
    Effect.catchAll((error) =>
      pipe(
        Console.error(
          chalk.red(`\n${error instanceof ConfigError ? error.message : `Setup failed: ${error}`}`),
        ),
        Effect.flatMap(() => Effect.fail(error)),
      ),
    ),
  )

export async function setup(): Promise<void> {
  const program = pipe(
    ConfigService,
    Effect.flatMap((configService) => setupEffect(configService)),
  ).pipe(Effect.provide(ConfigServiceLive))

  try {
    await Effect.runPromise(program)
  } catch {
    // Error already handled and displayed
    process.exit(1)
  }
}
