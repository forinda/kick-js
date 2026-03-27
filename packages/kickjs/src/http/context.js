import { parseQuery, } from './query';
/**
 * Unified request/response abstraction passed to every controller method.
 * Shields handlers from raw Express objects and provides convenience methods.
 */
export class RequestContext {
    req;
    res;
    next;
    constructor(req, res, next) {
        this.req = req;
        this.res = res;
        this.next = next;
    }
    /**
     * Per-request metadata map shared across all RequestContext instances
     * for the same request. Stored on `req` so middleware can pass data
     * to handlers via `ctx.set()` / `ctx.get()`.
     */
    get metadata() {
        const r = this.req;
        if (!r.__ctxMeta)
            r.__ctxMeta = new Map();
        return r.__ctxMeta;
    }
    // ── Request Data ────────────────────────────────────────────────────
    get body() {
        return this.req.body;
    }
    get params() {
        return this.req.params;
    }
    get query() {
        return this.req.query;
    }
    get headers() {
        return this.req.headers;
    }
    get requestId() {
        return this.req.requestId ?? this.req.headers['x-request-id'];
    }
    /** Session data (requires session middleware) */
    get session() {
        return this.req.session;
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
    qs(fieldConfig) {
        return parseQuery(this.req.query, fieldConfig);
    }
    // ── File Uploads ────────────────────────────────────────────────────
    /** Single uploaded file (requires @FileUpload({ mode: 'single' })) */
    get file() {
        return this.req.file;
    }
    /** Array of uploaded files (requires @FileUpload({ mode: 'array' })) */
    get files() {
        return this.req.files;
    }
    // ── Metadata Store ──────────────────────────────────────────────────
    get(key) {
        return this.metadata.get(key);
    }
    set(key, value) {
        this.metadata.set(key, value);
    }
    // ── Response Helpers ────────────────────────────────────────────────
    json(data, status = 200) {
        return this.res.status(status).json(data);
    }
    created(data) {
        return this.res.status(201).json(data);
    }
    noContent() {
        return this.res.status(204).end();
    }
    notFound(message = 'Not Found') {
        return this.res.status(404).json({ message });
    }
    badRequest(message) {
        return this.res.status(400).json({ message });
    }
    html(content, status = 200) {
        return this.res.status(status).type('html').send(content);
    }
    download(buffer, filename, contentType = 'application/octet-stream') {
        this.res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        this.res.setHeader('Content-Type', contentType);
        return this.res.send(buffer);
    }
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
    render(template, data = {}) {
        return this.res.render(template, data);
    }
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
    async paginate(fetcher, fieldConfig) {
        const parsed = this.qs(fieldConfig);
        const { data, total } = await fetcher(parsed);
        const { page, limit } = parsed.pagination;
        const totalPages = Math.ceil(total / limit) || 1;
        const response = {
            data,
            meta: {
                page,
                limit,
                total,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
            },
        };
        return this.json(response);
    }
    // ── Server-Sent Events ──────────────────────────────────────────────
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
    sse() {
        this.res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        this.res.flushHeaders();
        const closeCallbacks = [];
        this.req.on('close', () => {
            for (const cb of closeCallbacks)
                cb();
        });
        return {
            /** Send an SSE event with optional event name and id */
            send: (data, event, id) => {
                if (id)
                    this.res.write(`id: ${id}\n`);
                if (event)
                    this.res.write(`event: ${event}\n`);
                this.res.write(`data: ${JSON.stringify(data)}\n\n`);
            },
            /** Send a comment (keeps connection alive) */
            comment: (text) => {
                this.res.write(`: ${text}\n\n`);
            },
            /** Register a callback when the client disconnects */
            onClose: (fn) => {
                closeCallbacks.push(fn);
            },
            /** End the SSE stream */
            close: () => {
                this.res.end();
            },
        };
    }
}
//# sourceMappingURL=context.js.map