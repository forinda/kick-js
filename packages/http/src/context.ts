import type { Request, Response, NextFunction } from 'express'
import { parseQuery, type ParsedQuery, type QueryFieldConfig } from './query'

/**
 * Unified request/response abstraction passed to every controller method.
 * Shields handlers from raw Express objects and provides convenience methods.
 */
export class RequestContext<TBody = any, TParams = any, TQuery = any> {
  private metadata = new Map<string, any>()

  constructor(
    public readonly req: Request,
    public readonly res: Response,
    public readonly next: NextFunction,
  ) {}

  // ── Request Data ────────────────────────────────────────────────────

  get body(): TBody {
    return this.req.body as TBody
  }

  get params(): TParams {
    return this.req.params as TParams
  }

  get query(): TQuery {
    return this.req.query as TQuery
  }

  get headers() {
    return this.req.headers
  }

  get requestId(): string | undefined {
    return (this.req as any).requestId ?? (this.req.headers['x-request-id'] as string | undefined)
  }

  /** Session data (requires session middleware) */
  get session(): any {
    return (this.req as any).session
  }

  // ── Query String Parsing ───────────────────────────────────────────

  /**
   * Parse the request query string into structured filters, sort, pagination, and search.
   * Pass the result to an ORM query builder adapter (Drizzle, Prisma, Sequelize, etc.).
   *
   * @param fieldConfig - Optional whitelist for filterable, sortable, and searchable fields
   *
   * @example
   * ```ts
   * @Get('/')
   * async list(ctx: RequestContext) {
   *   const parsed = ctx.qs({
   *     filterable: ['status', 'priority'],
   *     sortable: ['createdAt', 'title'],
   *   })
   *   const q = drizzleAdapter.build(parsed, { columns })
   *   // ... use q.where, q.orderBy, q.limit, q.offset
   * }
   * ```
   */
  qs(fieldConfig?: QueryFieldConfig): ParsedQuery {
    return parseQuery(this.req.query as Record<string, any>, fieldConfig)
  }

  // ── File Uploads ────────────────────────────────────────────────────

  /** Single uploaded file (requires @FileUpload({ mode: 'single' })) */
  get file(): any {
    return (this.req as any).file
  }

  /** Array of uploaded files (requires @FileUpload({ mode: 'array' })) */
  get files(): any[] | undefined {
    return (this.req as any).files
  }

  // ── Metadata Store ──────────────────────────────────────────────────

  get<T = any>(key: string): T | undefined {
    return this.metadata.get(key) as T | undefined
  }

  set(key: string, value: any): void {
    this.metadata.set(key, value)
  }

  // ── Response Helpers ────────────────────────────────────────────────

  json(data: any, status = 200) {
    return this.res.status(status).json(data)
  }

  created(data: any) {
    return this.res.status(201).json(data)
  }

  noContent() {
    return this.res.status(204).end()
  }

  notFound(message = 'Not Found') {
    return this.res.status(404).json({ message })
  }

  badRequest(message: string) {
    return this.res.status(400).json({ message })
  }

  html(content: string, status = 200) {
    return this.res.status(status).type('html').send(content)
  }

  download(buffer: Buffer, filename: string, contentType = 'application/octet-stream') {
    this.res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    this.res.setHeader('Content-Type', contentType)
    return this.res.send(buffer)
  }
}
