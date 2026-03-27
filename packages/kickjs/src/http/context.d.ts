import type { Request, Response, NextFunction } from 'express';
import { type ParsedQuery, type QueryFieldConfig } from './query';
/**
 * Unified request/response abstraction passed to every controller method.
 * Shields handlers from raw Express objects and provides convenience methods.
 */
export declare class RequestContext<TBody = any, TParams = any, TQuery = any> {
    readonly req: Request;
    readonly res: Response;
    readonly next: NextFunction;
    constructor(req: Request, res: Response, next: NextFunction);
    /**
     * Per-request metadata map shared across all RequestContext instances
     * for the same request. Stored on `req` so middleware can pass data
     * to handlers via `ctx.set()` / `ctx.get()`.
     */
    private get metadata();
    get body(): TBody;
    get params(): TParams;
    get query(): TQuery;
    get headers(): import("node:http").IncomingHttpHeaders;
    get requestId(): string | undefined;
    /** Session data (requires session middleware) */
    get session(): any;
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
    qs(fieldConfig?: QueryFieldConfig): ParsedQuery;
    /** Single uploaded file (requires @FileUpload({ mode: 'single' })) */
    get file(): any;
    /** Array of uploaded files (requires @FileUpload({ mode: 'array' })) */
    get files(): any[] | undefined;
    get<T = any>(key: string): T | undefined;
    set(key: string, value: any): void;
    json(data: any, status?: number): Response<any, Record<string, any>>;
    created(data: any): Response<any, Record<string, any>>;
    noContent(): Response<any, Record<string, any>>;
    notFound(message?: string): Response<any, Record<string, any>>;
    badRequest(message: string): Response<any, Record<string, any>>;
    html(content: string, status?: number): Response<any, Record<string, any>>;
    download(buffer: Buffer, filename: string, contentType?: string): Response<any, Record<string, any>>;
    /**
     * Render a template using the registered view engine (EJS, Pug, Handlebars, etc.).
     * Requires a ViewAdapter to be configured in bootstrap().
     *
     * @param template - Template name (without extension, relative to viewsDir)
     * @param data - Data to pass to the template
     *
     * @example
     * ```ts
     * ctx.render('dashboard', { user, title: 'Dashboard' })
     * ctx.render('emails/welcome', { name: 'Alice' })
     * ```
     */
    render(template: string, data?: Record<string, any>): void;
    /**
     * Parse query params and return a standardized paginated response.
     * Calls `ctx.qs()` internally, then wraps your data with pagination meta.
     *
     * @param fetcher - Async function that receives ParsedQuery and returns `{ data, total }`
     * @param fieldConfig - Optional whitelist for filterable, sortable, searchable fields
     *
     * @example
     * ```ts
     * @Get('/')
     * async list(ctx: RequestContext) {
     *   return ctx.paginate(
     *     async (parsed) => {
     *       const data = await db.select().from(users)
     *         .where(query.where).limit(parsed.pagination.limit)
     *         .offset(parsed.pagination.offset).all()
     *       const total = await db.select({ count: count() }).from(users).get()
     *       return { data, total: total?.count ?? 0 }
     *     },
     *     { filterable: ['name', 'role'], sortable: ['createdAt'] },
     *   )
     * }
     * ```
     */
    paginate<T>(fetcher: (parsed: ParsedQuery) => Promise<{
        data: T[];
        total: number;
    }>, fieldConfig?: QueryFieldConfig): Promise<Response<any, Record<string, any>>>;
    /**
     * Start an SSE (Server-Sent Events) stream.
     * Sets the correct headers and returns helpers to send events.
     *
     * @example
     * ```ts
     * @Get('/events')
     * async stream(ctx: RequestContext) {
     *   const sse = ctx.sse()
     *
     *   const interval = setInterval(() => {
     *     sse.send({ time: new Date().toISOString() }, 'tick')
     *   }, 1000)
     *
     *   sse.onClose(() => clearInterval(interval))
     * }
     * ```
     */
    sse(): {
        /** Send an SSE event with optional event name and id */
        send: (data: any, event?: string, id?: string) => void;
        /** Send a comment (keeps connection alive) */
        comment: (text: string) => void;
        /** Register a callback when the client disconnects */
        onClose: (fn: () => void) => void;
        /** End the SSE stream */
        close: () => void;
    };
}
//# sourceMappingURL=context.d.ts.map