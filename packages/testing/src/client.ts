import type { Application } from '@forinda/kickjs'

/** A request in flight — supertest's `Test`, chainable and awaitable. */
// supertest stays an optional peer, so its type is described, not imported.
export type TestRequest = any

/** Options for {@link TestClient} and `createTestApp(...).client()`. */
export interface TestClientOptions {
  /** Headers sent with every request: `{ host: 'localhost' }`, a tenant header. */
  headers?: Record<string, string>
  /** Sent as `Authorization: Bearer <token>`. */
  bearer?: string
  /** Prefixed to every path: `basePath: '/api/v1'`, then `.get('/users')`. */
  basePath?: string
  /**
   * Keep cookies between requests, like a browser — for session and CSRF
   * flows. Default `false`: every request starts without cookies.
   */
  cookies?: boolean
}

/**
 * Requests against a test app, through whichever runtime it runs on, with
 * the headers every call needs set once:
 *
 *   const api = client({ headers: { host: 'localhost' }, basePath: '/api/v1' })
 *   await api.as(token).post('/invoices').send(body).expect(201)
 */
export interface TestClient {
  get(path: string): TestRequest
  post(path: string): TestRequest
  put(path: string): TestRequest
  patch(path: string): TestRequest
  delete(path: string): TestRequest
  head(path: string): TestRequest
  options(path: string): TestRequest
  /** The same client, sending `Authorization: Bearer <token>`. */
  as(token: string): TestClient
  /** The same client, with these headers added (or replaced). */
  withHeaders(headers: Record<string, string>): TestClient
}

type Supertest = ((app: unknown) => Record<string, (path: string) => TestRequest>) & {
  agent(app: unknown): Record<string, (path: string) => TestRequest>
}

let supertest: Supertest | null | undefined

/** supertest, if installed. Loaded once, on the first test app. */
export async function loadSupertest(): Promise<Supertest | null> {
  if (supertest !== undefined) return supertest
  try {
    supertest = ((await import('supertest')) as unknown as { default: Supertest }).default
  } catch {
    supertest = null
  }
  return supertest
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

export function createClient(
  app: Application,
  request: Supertest | null,
  options: TestClientOptions = {},
  sharedAgent?: Record<string, (path: string) => TestRequest>,
): TestClient {
  if (!request) {
    throw new Error(
      "createTestApp: client() sends requests with supertest, which isn't installed — add it as a dev dependency",
    )
  }
  const handler = app.handle.bind(app)
  // One agent per client keeps cookies — shared with the clients scoped from
  // it, so `.as()` / `.withHeaders()` keep the same cookie jar. Otherwise a
  // fresh request each call.
  const agent = options.cookies ? (sharedAgent ?? request.agent(handler)) : undefined
  // Header names are case-insensitive: kept lower-case so a later one replaces an earlier one.
  const headers = lowerCaseKeys(options.headers)
  if (options.bearer) headers.authorization = `Bearer ${options.bearer}`
  const base = options.basePath?.replace(/\/$/, '') ?? ''

  const client = {} as TestClient
  for (const method of METHODS) {
    client[method] = (path: string) => {
      let test = (agent ?? request(handler))[method](`${base}${path}`)
      for (const [name, value] of Object.entries(headers)) test = test.set(name, value)
      return test
    }
  }
  client.as = (token) => createClient(app, request, { ...options, headers, bearer: token }, agent)
  client.withHeaders = (extra) => {
    const added = lowerCaseKeys(extra)
    // An explicit Authorization replaces the inherited bearer token.
    const bearer = 'authorization' in added ? undefined : options.bearer
    return createClient(
      app,
      request,
      { ...options, bearer, headers: { ...headers, ...added } },
      agent,
    )
  }
  return client
}

function lowerCaseKeys(headers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
}
