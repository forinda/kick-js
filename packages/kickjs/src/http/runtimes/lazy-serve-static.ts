import type { ConnectHandler as RequestHandler } from '../connect'
import { withPrecompressed } from './precompressed'

/**
 * `serve-static` as connect middleware, imported on the first request. Only
 * some apps serve files (SpaAdapter), and an `import()`, unlike
 * `createRequire`, is one a bundler follows — so a Netlify or Vercel
 * function carries the package instead of failing to find it.
 */
export function lazyServeStatic(dir: string): RequestHandler {
  let serve: Promise<RequestHandler> | undefined
  return withPrecompressed(dir, (req, res, next) => {
    serve ??= import('serve-static').then((mod) => {
      const factory = ((mod as { default?: unknown }).default ?? mod) as (
        root: string,
      ) => RequestHandler
      return factory(dir)
    })
    serve.then((handler) => handler(req, res, next), next)
  })
}
