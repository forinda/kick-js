/**
 * The built-in health endpoints, as a module you can see.
 *
 * These used to be mounted straight onto the engine with `http.route()` before
 * the middleware chain. That worked, but it made them invisible in two ways
 * that matter:
 *
 * 1. **Swagger never saw them.** The OpenAPI spec is built by scanning
 *    controller decorators, and a raw `http.route()` carries none — so the two
 *    routes the framework itself serves were missing from every generated spec.
 * 2. **Nothing in an adopter's code said they existed.** `kick g adapter`
 *    documents `onHealthCheck`, but the endpoint consuming it appeared nowhere,
 *    so people wrote their own `/health/ready` beside the built-in one.
 *
 * As a module it is registered like any other, appears in the boot module list,
 * shows up in the spec, and can be replaced — pass your own module and set
 * `health: false`.
 *
 * Mounting it with the other modules also puts it INSIDE the middleware chain,
 * where it was previously ahead of it. That is deliberate: an app controls its
 * own auth, and a framework route quietly bypassing it is the surprise, not the
 * other way round. An app that wants its probes unauthenticated exempts them —
 * `health: { flags: ['auth.public'] }` puts the app's own flag on both routes,
 * and whatever already skips on that flag skips these too.
 *
 * @module @forinda/kickjs/http/health-module
 */
import { Controller, Get } from '../core/decorators'
import { createToken } from '../core/token'
import { defineModule } from '../core/define-module'
import type { Container } from '../core/container'
import type { RouteFlagDeclarations } from '../core/route-flag'
import { reply } from './reply'

/** One adapter's answer to `onHealthCheck()`. */
export interface HealthCheckResult {
  name: string
  status: 'up' | 'down'
}

/**
 * What the health routes need from the running Application.
 *
 * A controller cannot reach `Application` internals, and should not: this is
 * the whole surface the endpoints depend on, so a replacement module can
 * satisfy it without knowing anything else.
 */
export interface HealthProbe {
  /** True once shutdown has begun and traffic should drain away. */
  isDraining(): boolean
  /** Aggregated `onHealthCheck()` results from every adapter that has one. */
  checks(): Promise<HealthCheckResult[]>
}

export const HEALTH_PROBE = createToken<HealthProbe>('kick/Health/probe')

/** Config for {@link healthModule}. */
export interface HealthModuleConfig {
  /**
   * Route flags to put on `GET /health/live` and `GET /health/ready`.
   *
   * The framework names no flags, so it cannot decide these probes are
   * "public" on your behalf — the name is yours, and every consumer that
   * already reads it (an auth contributor's `skipWhen`, a guard's
   * `exemptWhen`, `SwaggerAdapter({ publicFlag })`) then covers health with no
   * further wiring:
   *
   * ```ts
   * bootstrap({ health: { flags: ['auth.public'] } })
   * ```
   *
   * This replaces exempting `/health/live` and `/health/ready` by pathname,
   * which silently stops matching if the probe paths ever move.
   */
  flags?: RouteFlagDeclarations
}

@Controller()
export class HealthController {
  constructor(private readonly probe: HealthProbe) {}

  /** Liveness: is the process up and not shutting down. */
  @Get('/live')
  live() {
    return this.probe.isDraining()
      ? reply(503, { status: 'draining', uptime: process.uptime() })
      : reply(200, { status: 'ok', uptime: process.uptime() })
  }

  /** Readiness: is every adapter's dependency answering. */
  @Get('/ready')
  async ready() {
    if (this.probe.isDraining()) {
      return reply(503, { status: 'draining', checks: [] })
    }
    const checks = await this.probe.checks()
    const healthy = checks.every((c) => c.status === 'up')
    return reply(healthy ? 200 : 503, {
      status: healthy ? 'ready' : 'degraded',
      checks,
    })
  }
}

/**
 * `GET /health/live` and `GET /health/ready`, mounted at the root.
 *
 * A `defineModule` factory like any other module — the framework's own routes
 * should be declared the way it asks adopters to declare theirs, not through a
 * shape only the framework can produce.
 *
 * Registered automatically unless the app passes `health: false` or supplies a
 * module of its own. Pass `health: { flags: [...] }` to `bootstrap()` to flag
 * both probes — see {@link HealthModuleConfig}.
 */
export const healthModule = defineModule<HealthModuleConfig>({
  name: 'HealthModule',
  build: (config) => ({
    register(container: Container) {
      // Resolve through the token so a replacement probe — or a test double —
      // can be bound before this runs.
      container.registerFactory(HealthController, () => {
        const probe = container.resolve<HealthProbe>(HEALTH_PROBE)
        return new HealthController(probe)
      })
    },
    routes() {
      // Root-mounted and unversioned: the probe URL an orchestrator is
      // configured against must not move when the API prefix or version does.
      return {
        path: '/health',
        controller: HealthController,
        version: false,
        prefix: false,
        // Declared at the mount rather than on HealthController: the class is
        // the framework's, the flag names are the app's.
        flags: config.flags,
      }
    },
  }),
})
