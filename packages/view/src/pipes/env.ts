import type { Pipe } from '../render/render'
import { SafeHtml } from '../render/safe'
import { builtinPipes, type PipeEnv } from './builtins'

export { BUILTIN_PIPES, builtinPipes, type PipeEnv } from './builtins'

const ENV_PIPE = Symbol.for('kickjs.view.envPipe')

/** A pipe built per render from the render's locale and time zone. */
export interface EnvPipe {
  [ENV_PIPE]: (env: PipeEnv) => Pipe
}

/**
 * A pipe that needs the render's locale or time zone:
 * `export const ago = withEnv(({ locale }) => (date: Date) => …)`.
 */
export function withEnv(make: (env: PipeEnv) => Pipe): EnvPipe {
  return { [ENV_PIPE]: make }
}

/** Mark HTML as trusted: a pipe returning it prints unescaped, in text only. */
export const safeHtml = (html: string): SafeHtml => new SafeHtml(html)

const isEnvPipe = (p: unknown): p is EnvPipe => typeof p === 'object' && p !== null && ENV_PIPE in p

/** The pipes for one render: the built-ins and the app's, with env pipes built for `env`. */
export function pipesFor(app: Record<string, Pipe | EnvPipe>, env: PipeEnv): Record<string, Pipe> {
  const out = builtinPipes(env)
  for (const [name, p] of Object.entries(app)) {
    if (isEnvPipe(p)) out[name] = p[ENV_PIPE](env)
    else if (typeof p === 'function') out[name] = p
  }
  return out
}
