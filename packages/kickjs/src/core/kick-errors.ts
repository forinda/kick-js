/**
 * Catalog of framework errors with structured cause + fix hints.
 *
 * Each factory function returns a {@link KickError} with a stable
 * `code` (KICK001, KICK002, …), a human-readable summary, an
 * explanation of the likely cause, an actionable fix, and a docs URL.
 *
 * Adding a new error: pick the next free code, add the factory below,
 * call it from the framework site that used to throw a bare `Error`.
 * Keep the public function name descriptive — `noProviderError`,
 * `envValueMissingError` — so call sites grep cleanly.
 *
 * Codes are stable. Reordering or renumbering breaks adopters whose
 * tools key on `err.code`.
 */
import { KickError } from './kick-error'

const DOCS_BASE = 'https://kickjs.app'

// ── DI container ──────────────────────────────────────────────────────

/**
 * KICK001 — No provider registered for a token.
 *
 * Thrown by `Container.resolve()` when no binding can be found for the
 * requested token. The most common cause is forgetting to add the
 * enclosing module to `bootstrap({ modules })`.
 */
export function noProviderError(tokenName: string): KickError {
  return new KickError({
    code: 'KICK001',
    summary: `No provider for ${tokenName}`,
    cause: `\`${tokenName}\` was requested from the DI container but no binding is registered.
This usually means one of:
  • The class is decorated with @Service() / @Repository() / @Controller(),
    but its enclosing module isn't passed to bootstrap({ modules: [...] }).
  • The class isn't decorated at all (decorators register the binding).
  • You're injecting a token (created with createToken()) that nothing
    provides — add a Container.register(TOKEN, ...) call or a module that
    binds it.`,
    fix: `If \`${tokenName}\` lives in a module, add the module to bootstrap:

      bootstrap({
        modules: [
          UsersModule,        // add this
          OtherModule,
        ],
      })

If it's a custom token, register it explicitly:

      const TENANT_REPO = createToken<TenantRepo>('TENANT_REPO')
      Container.getInstance().register(TENANT_REPO, { useClass: PrismaTenantRepo })`,
    docsUrl: `${DOCS_BASE}/guide/dependency-injection#registering-services`,
    context: { token: tokenName },
  })
}

/**
 * KICK002 — REQUEST-scoped binding resolved without a request store
 * provider configured.
 */
export function requestScopeMiddlewareMissingError(tokenName: string): KickError {
  return new KickError({
    code: 'KICK002',
    summary: `Cannot resolve REQUEST-scoped "${tokenName}" — request scope middleware not mounted`,
    cause: `\`${tokenName}\` has \`scope: Scope.REQUEST\` but no AsyncLocalStorage frame is wired.
The framework's request-scope middleware sets up that frame; without it,
REQUEST-scoped resolutions have nowhere to cache the per-request instance.`,
    fix: `Add \`requestScopeMiddleware()\` to your global middleware pipeline,
or let the framework auto-mount it by using \`contextStore: 'auto'\`
(the default — only check this if you set it to 'manual' explicitly):

      bootstrap({
        modules,
        // contextStore: 'auto',  // default; no need to set
      })

If you set \`contextStore: 'manual'\` deliberately (rare), you own the
ALS wrapping — call \`requestStore.run({...}, () => ...)\` around the
code that resolves the binding.`,
    docsUrl: `${DOCS_BASE}/guide/dependency-injection#scopes`,
    context: { token: tokenName },
  })
}

/**
 * KICK003 — REQUEST-scoped binding resolved outside any HTTP request
 * context (no ALS store active).
 */
export function requestScopeOutsideRequestError(tokenName: string): KickError {
  return new KickError({
    code: 'KICK003',
    summary: `Cannot resolve REQUEST-scoped "${tokenName}" outside an HTTP request`,
    cause: `\`${tokenName}\` has \`scope: Scope.REQUEST\` and was resolved outside
any HTTP request context. The request-scope middleware is wired, but
the call happened before a request started (e.g. in a top-level
import, a constructor, a cron job, a test without setup).`,
    fix: `If the caller is request-scoped (controller, request-scoped service),
make sure the call happens inside the request lifecycle, not at module
load time.

In tests, wrap setup in an ALS frame manually:

      import { requestStore } from '@forinda/kickjs'

      requestStore.run(
        { requestId: 'test', instances: new Map(), values: new Map() },
        () => {
          const svc = container.resolve(MyRequestScopedService)
          // ...
        },
      )

If the caller is a SINGLETON, change \`${tokenName}\` to TRANSIENT or
SINGLETON scope, or inject a factory instead of the instance directly.`,
    docsUrl: `${DOCS_BASE}/guide/dependency-injection#scopes`,
    context: { token: tokenName },
  })
}

// ── Config / env wiring ───────────────────────────────────────────────

/**
 * KICK004 — `@Value('X')` resolved but the env var isn't set and no
 * default was provided.
 *
 * This is the canonical "you forgot to wire env" symptom — surfaces
 * when ConfigService can't find the key. The fix usually involves
 * either setting the env var or wiring `loadEnv(envSchema)` at startup.
 */
export function envValueMissingError(envKey: string): KickError {
  return new KickError({
    code: 'KICK004',
    summary: `@Value('${envKey}'): environment variable not set and no default provided`,
    cause: `\`@Value('${envKey}')\` resolved but the env var isn't present and the
decorator didn't declare a default. Possible reasons:
  • The variable is genuinely missing from your environment / .env file.
  • Your \`src/env.ts\` calls \`loadEnv(envSchema)\` but \`src/index.ts\`
    doesn't import \`./env\` before \`bootstrap()\`. Without that import
    the schema never runs and ConfigService stays empty — \`@Value\`
    only finds the var via the \`process.env\` fallback.`,
    fix: `Either set the variable in your shell / .env file:

      ${envKey}=...

Or add a default at the decorator:

      @Value('${envKey}', { default: 'fallback' })
      private value!: string

If you're using a schema, make sure \`src/env.ts\` is imported from
\`src/index.ts\` BEFORE bootstrap runs:

      // src/index.ts
      import 'reflect-metadata'
      import './env'                  // ← this line is required
      import { bootstrap } from '@forinda/kickjs'
      // ...`,
    docsUrl: `${DOCS_BASE}/guide/configuration#wiring-the-schema-at-startup`,
    context: { envKey },
  })
}

// ── Module setup ──────────────────────────────────────────────────────

/**
 * KICK005 — A module's `routes()` return value declares a mount path
 * but provides neither a `controller` class nor a pre-built `router`.
 */
export function moduleRouteMissingControllerError(mountPath: string): KickError {
  return new KickError({
    code: 'KICK005',
    summary: `Module route at ${mountPath} requires either 'controller' or 'router'`,
    cause: `A module's \`routes()\` returned an entry for \`${mountPath}\` but didn't
specify how to build the router. The framework needs either a decorated
controller class (it calls \`buildRoutes()\` internally) or a hand-built
Express Router.`,
    fix: `Pass \`controller:\` for the common case:

      routes() {
        return {
          path: '${mountPath}',
          controller: UsersController,
        }
      }

Or pass \`router:\` for full control:

      routes() {
        return {
          path: '${mountPath}',
          router: myExpressRouter,
        }
      }`,
    docsUrl: `${DOCS_BASE}/guide/modules`,
    context: { mountPath },
  })
}

/**
 * KICK006 — Two handlers claim the same HTTP verb + mounted path. The
 * engine would silently dispatch one of them (Express/h3: first wins,
 * Fastify: its own throw), while typegen and the typed client may
 * describe the other — so this fails at boot instead.
 */
export function duplicateRouteError(
  method: string,
  path: string,
  owner: string,
  prior: string,
): KickError {
  return new KickError({
    code: 'KICK006',
    summary: `Duplicate route: ${method} ${path} is registered twice`,
    cause: `\`${owner}\` registers \`${method} ${path}\`, but that verb + path is
already claimed by \`${prior}\`. Only one handler can win at dispatch
time, and which one depends on the engine — while \`kick typegen\` and
the typed client may describe the other. Param names are ignored when
comparing (\`/:id\` and \`/:taskId\` are the same route).`,
    fix: `Change one of the two paths, remove the duplicate handler, or mount
the second controller under a different module path / version:

      routes() {
        return { path: '/tasks', controller: TasksController, version: 2 }
      }`,
    docsUrl: `${DOCS_BASE}/guide/modules`,
    context: { method, path, owner, prior },
  })
}
