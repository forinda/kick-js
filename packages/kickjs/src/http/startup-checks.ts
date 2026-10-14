/**
 * Startup checks: rules run against the assembled app before it serves a
 * request, so a risky configuration is reported at boot — with an ID you can
 * look up, and silence on purpose — instead of discovered in an incident.
 *
 * @module @forinda/kickjs/http/startup-checks
 */
import { createLogger } from '../core/logger'
import { isProduction } from '../core/is-production'

const log = createLogger('Checks')

/** One finding. `error` fails startup; `warning` is logged. */
export interface CheckMessage {
  /** Stable ID, e.g. `'KICK-SEC-W001'` — what `silenceChecks` matches. */
  id: string
  level: 'error' | 'warning'
  message: string
  /** What to change. */
  fix?: string
}

/** What a check can look at. */
export interface CheckContext {
  /** The options the app was created with. */
  options: Readonly<Record<string, unknown>>
  /** Every mounted route, `{ method, path }`. */
  routes: ReadonlyArray<{ method: string; path: string }>
  production: boolean
}

export interface StartupCheck {
  /** Names the check in logs; its messages carry their own IDs. */
  name: string
  /** Run only when `NODE_ENV=production` — for deployment-only advice. */
  deploy?: boolean
  run(ctx: CheckContext): CheckMessage | CheckMessage[] | undefined | void
}

/** Declare a check — an identity helper, for the types. */
export function defineCheck(check: StartupCheck): StartupCheck {
  return check
}

/** Thrown when a check reports an error; lists every error found. */
export class StartupCheckError extends Error {
  constructor(readonly messages: CheckMessage[]) {
    super(
      `Startup checks failed:\n${messages.map((m) => `  ${m.id}: ${m.message}${m.fix ? `\n    fix: ${m.fix}` : ''}`).join('\n')}`,
    )
    this.name = 'StartupCheckError'
  }
}

/** The framework's own checks. */
export const builtInChecks: StartupCheck[] = [
  defineCheck({
    name: 'allowed hosts',
    deploy: true,
    run: ({ options }) => {
      const configured = (options.security as { allowedHosts?: unknown } | undefined)?.allowedHosts
      const hosts = Array.isArray(configured)
        ? configured
        : (configured as { hosts?: unknown } | undefined)?.hosts
      // `'*'` matches every host: configured, but no restriction.
      if (Array.isArray(hosts) && hosts.length > 0 && !hosts.includes('*')) return
      return {
        id: 'KICK-SEC-W001',
        level: 'warning',
        message:
          'No allowed hosts in production (or `*`): any Host header is accepted, and absolute ' +
          'URLs built from it (reset links, redirects) can point anywhere.',
        fix: "bootstrap({ security: { allowedHosts: ['example.com'] } })",
      }
    },
  }),
  defineCheck({
    name: 'trust proxy',
    deploy: true,
    run: ({ options }) => {
      if (options.trustProxy !== true) return
      return {
        id: 'KICK-SEC-W002',
        level: 'warning',
        message:
          '`trustProxy: true` trusts every X-Forwarded-For hop, so a client that reaches the app ' +
          'directly can set its own IP (rate limits, logs, ctx.ip).',
        fix: 'Trust the number of proxies in front of the app instead, e.g. `trustProxy: 1`.',
      }
    },
  }),
]

/**
 * Run the checks, skipping silenced IDs. Warnings are logged; errors throw a
 * {@link StartupCheckError} once every check has run.
 */
export function runStartupChecks(
  checks: readonly StartupCheck[],
  ctx: Omit<CheckContext, 'production'>,
  silenced: readonly string[] = [],
): CheckMessage[] {
  const production = isProduction()
  const skip = new Set(silenced)
  const found: CheckMessage[] = []
  for (const check of checks) {
    if (check.deploy && !production) continue
    let result: ReturnType<StartupCheck['run']>
    try {
      result = check.run({ ...ctx, production })
    } catch (err) {
      // A broken check must not stop the app; say so and move on.
      log.error(err, `Startup check '${check.name}' threw`)
      continue
    }
    for (const message of [result ?? []].flat()) {
      if (!skip.has(message.id)) found.push(message)
    }
  }

  for (const message of found) {
    if (message.level === 'warning') {
      log.warn(`${message.id}: ${message.message}${message.fix ? ` Fix: ${message.fix}` : ''}`)
    }
  }
  const errors = found.filter((m) => m.level === 'error')
  if (errors.length > 0) throw new StartupCheckError(errors)
  return found
}
