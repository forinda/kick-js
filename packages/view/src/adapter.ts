/**
 * `KickView`: makes `ctx.render()` render `.kick` templates on every
 * runtime. It binds a renderer onto each request through the slot core reads
 * (`Symbol.for('kickjs.viewRenderer')`), so this module never imports
 * `@forinda/kickjs` at runtime — it stays edge-safe.
 */
import { createViews, type Views, type ViewsOptions } from './views'

const VIEW_RENDERER = Symbol.for('kickjs.viewRenderer')

type Next = (err?: unknown) => void

/** What `ctx.render` passes a bound renderer. Mirrors core's `ViewRenderOptions`. */
interface ViewRenderOptions {
  status?: number
  headers?: Record<string, string>
  layout?: boolean
  locale?: string
  timeZone?: string
}

type Renderer = (
  name: string,
  data: Record<string, unknown>,
  opts: ViewRenderOptions,
  ctx: unknown,
) => Promise<string | undefined>

function rendererFor(views: Views): Renderer {
  return async (name, data, opts, ctx) =>
    (await views.has(name))
      ? views.render(name, data, {
          layout: opts.layout,
          locale: opts.locale,
          timeZone: opts.timeZone,
          ctx,
        })
      : undefined
}

/** Connect middleware binding `views` to each request (what the adapter mounts). */
function bindViews(views: Views): (req: object, res: unknown, next: Next) => void {
  const renderer = rendererFor(views)
  return (req, _res, next) => {
    ;(req as Record<symbol, unknown>)[VIEW_RENDERER] = renderer
    next()
  }
}

/**
 * The web fetch entry's middleware (`createWebApp({ middlewares: [viewsMiddleware(views)] })`),
 * which takes `(ctx, next)` middleware rather than adapters.
 */
export function viewsMiddleware(
  views: Views,
): (ctx: { req: object }, next: () => unknown) => unknown {
  const renderer = rendererFor(views)
  return (ctx, next) => {
    ;(ctx.req as Record<symbol, unknown>)[VIEW_RENDERER] = renderer
    return next()
  }
}

export interface KickViewOptions extends ViewsOptions {
  /** A views instance to use — share it with error pages and emails. */
  views?: Views
}

/**
 * The `.kick` view engine for `bootstrap({ adapters })`.
 *
 * ```ts
 * const views = createViews({ layout: 'layouts/main' })
 * bootstrap({ modules, adapters: [KickView({ views })] })
 * // in a controller
 * await ctx.render('users/show', { user })
 * ```
 */
export function KickView(options: KickViewOptions = {}) {
  const views =
    options.views ??
    createViews({ dev: globalThis.process?.env?.NODE_ENV !== 'production', ...options })
  const handler = bindViews(views)
  return {
    name: 'KickView',
    views,
    // Before any other middleware, so error pages and early answers can render too.
    middleware: () => [{ handler, phase: 'beforeGlobal' as const }],
  }
}
