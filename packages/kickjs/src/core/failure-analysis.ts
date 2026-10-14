/**
 * Turn a startup failure into advice: what went wrong in words, and what to
 * change — instead of a driver's stack trace that names a socket.
 *
 * @module @forinda/kickjs/core/failure-analysis
 */

/** What an analyzer says about an error it recognises. */
export interface FailureAdvice {
  summary: string
  cause?: string
  fix: string
}

type ErrnoLike = {
  code?: unknown
  address?: unknown
  port?: unknown
  hostname?: unknown
  message?: unknown
}

/** The error, or the first error in its `cause` chain / AggregateError, with this errno code. */
function findCode(err: unknown, codes: readonly string[], depth = 0): ErrnoLike | undefined {
  if (!err || typeof err !== 'object' || depth > 5) return undefined
  const e = err as ErrnoLike & { cause?: unknown; errors?: unknown[] }
  if (typeof e.code === 'string' && codes.includes(e.code)) return e
  for (const inner of [e.cause, ...(Array.isArray(e.errors) ? e.errors : [])]) {
    const found = findCode(inner, codes, depth + 1)
    if (found) return found
  }
  return undefined
}

const target = (e: ErrnoLike) =>
  typeof e.address === 'string'
    ? `${e.address}${typeof e.port === 'number' ? `:${e.port}` : ''}`
    : typeof e.hostname === 'string'
      ? e.hostname
      : 'the service'

/** The framework's own analyzers, tried after the failing adapter's. */
export function builtInAdvice(err: unknown, where: string): FailureAdvice | undefined {
  const refused = findCode(err, ['ECONNREFUSED'])
  if (refused) {
    return {
      summary: `${where} could not connect to ${target(refused)}: connection refused`,
      cause:
        'Nothing is listening at that address — the service is down, not started yet, or the URL points at the wrong host or port.',
      fix: 'Start the service, or check the connection URL in your env (localhost inside a container is the container itself).',
    }
  }
  const dns = findCode(err, ['ENOTFOUND', 'EAI_AGAIN'])
  if (dns) {
    return {
      summary: `${where} could not resolve the host ${target(dns)}`,
      cause: 'The host name in the connection URL does not resolve from here.',
      fix: 'Check the host name in your env — a typo, or a name that only resolves inside another network (a compose service name used from the host).',
    }
  }
  const timeout = findCode(err, ['ETIMEDOUT', 'ECONNRESET'])
  if (timeout) {
    return {
      summary: `${where} lost the connection to ${target(timeout)} (${String(timeout.code)})`,
      cause:
        'The address answered slowly or not at all — a firewall, a security group, or the wrong network.',
      fix: 'Check that this machine is allowed to reach the service, and that TLS and port settings match it.',
    }
  }
  const message = err instanceof Error ? err.message : ''
  if (
    /password authentication failed|access denied for user|authentication failed|NOAUTH|WRONGPASS/i.test(
      message,
    )
  ) {
    return {
      summary: `${where} was refused: the credentials were not accepted`,
      cause: message,
      fix: 'Check the user and password in your connection URL or env, and that the user exists on this server.',
    }
  }
  return undefined
}

/** Render advice for the log. */
export function formatAdvice(advice: FailureAdvice): string {
  return [
    advice.summary,
    ...(advice.cause ? ['', `  Cause: ${advice.cause}`] : []),
    '',
    `  Fix:   ${advice.fix}`,
  ].join('\n')
}
