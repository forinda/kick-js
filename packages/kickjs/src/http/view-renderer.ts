import type { RequestContext } from './context'

/**
 * The slot a view engine fills so `ctx.render()` works on every runtime.
 * An adapter binds a renderer onto each request; `ctx.render` asks it first
 * and falls back to the runtime's own engine (Express + ViewAdapter) when it
 * doesn't own the name. `Symbol.for`, so an engine binds it without
 * importing this module.
 */
export const VIEW_RENDERER = Symbol.for('kickjs.viewRenderer')

/**
 * Per-render options for `ctx.render()`: status, headers, layout, locale and time zone.
 *
 * @see https://kickjs.app/guide/views
 */
export interface ViewRenderOptions {
  status?: number
  headers?: Record<string, string>
  /** A layout for this render, or `false` for none — a partial response. */
  layout?: boolean | string
  locale?: string
  timeZone?: string
}

/** Resolves to the HTML, or to `undefined` when the name isn't this engine's. */
export type ViewRenderer = (
  name: string,
  data: Record<string, unknown>,
  opts: ViewRenderOptions,
  ctx: RequestContext,
) => Promise<string | undefined>

/** Attach a view renderer to a request, for {@link viewRendererFor} to find later. */
export function bindViewRenderer(req: object, renderer: ViewRenderer): void {
  ;(req as Record<symbol, unknown>)[VIEW_RENDERER] = renderer
}

/** The view renderer bound to this request by {@link bindViewRenderer}, or `undefined`. */
export function viewRendererFor(req: unknown): ViewRenderer | undefined {
  return (req as Record<symbol, ViewRenderer | undefined> | null)?.[VIEW_RENDERER]
}

const PENDING = Symbol('kickjs.pendingResponse')

/** Remember a response still being produced, so the pipeline waits for it. */
export function setPendingResponse(ctx: object, p: Promise<void>): void {
  ;(ctx as Record<symbol, unknown>)[PENDING] = p
}

/** A response `ctx.render()` is still producing, when the handler didn't await it. */
export function pendingResponse(ctx: object): Promise<void> | undefined {
  return (ctx as Record<symbol, Promise<void> | undefined>)[PENDING]
}
