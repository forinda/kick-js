// Concrete-module imports (NOT the `../core` barrel): the barrel re-exports
// the asset manager, whose eager `node:fs` import would poison the edge-safe
// `@forinda/kickjs/web` entry graph that flows through this file.
import {
  buildPipeline,
  splitBeforeValidation,
  type SourcedRegistration,
} from '../core/contributor-pipeline'
import { runContributors } from '../core/contributor-runner'
import { Container } from '../core/container'
import { METADATA } from '../core/interfaces'
import type { ContributorRegistration } from '../core/context-decorator'
import type { FileUploadConfig, MiddlewareHandler, RouteDefinition } from '../core/decorators'
import { getClassMeta, getMethodMeta, getMethodMetaOrUndefined } from '../core/metadata'
import {
  getClassFlagDeclarations,
  getMethodFlagDeclarations,
  registerMountFlags,
  resolveRouteFlags,
  toFlagDeclarations,
  type RouteFlagDeclarations,
} from '../core/route-flag'
import { duplicateRouteError } from '../core/kick-errors'
import type { CtxHandler, RouteContributor, RouteEntry, RouteMethod } from './runtime'

/**
 * Per-module SourcedRegistration[] threaded through the route-mount loop by
 * Application.setup(). Carries module + adapter + global contributors so
 * buildRouteTable() can merge them with class + method ones into a single pipeline.
 *
 * Module setup is sequential, so this slot is race-free. Cleared in a finally
 * block after each module mounts. Outside of Application setup the slot is
 * empty — direct buildRouteTable()/buildRoutes() callers (mostly tests) see only
 * class + method contributors unless they pass `externalSources` explicitly.
 *
 * Same idiom as `Container._requestStoreProvider`: an internal escape hatch for
 * cross-module wiring without inversion-of-control gymnastics.
 *
 * @internal
 */
let _externalContributorSources: readonly SourcedRegistration[] = []

/** @internal — set by Application.setup() before each `mod.routes()` call. */
export function _setExternalContributorSources(sources: readonly SourcedRegistration[]): void {
  _externalContributorSources = sources
}

/**
 * Boot-time duplicate-route guard shared by the node and web mount loops.
 *
 * Registers `METHOD /mounted/path` into `registry` and throws
 * {@link duplicateRouteError} (KICK006) if another handler already claimed
 * it. Param *names* are ignored — `/tasks/:id` and `/tasks/:taskId` are the
 * same route at dispatch time, so they collide here too.
 *
 * @internal
 */
export function assertRouteUnique(
  registry: Map<string, string>,
  method: string,
  fullPath: string,
  owner: string,
): void {
  const key = `${method.toUpperCase()} ${fullPath.replace(/:[^/]+/g, ':*')}`
  const prior = registry.get(key)
  if (prior !== undefined) {
    throw duplicateRouteError(method.toUpperCase(), fullPath, owner, prior)
  }
  registry.set(key, owner)
}

export interface BuildRoutesOptions {
  /**
   * Extra contributors to merge into the per-route pipeline at their declared
   * precedence levels. Pass explicitly when calling buildRouteTable/buildRoutes
   * outside the Application route-mount loop (typically in tests). When omitted,
   * falls back to the slot set by Application.setup().
   */
  externalSources?: readonly SourcedRegistration[]
  /**
   * Flags the mounting module declares for every route on this controller
   * (`ModuleRoutes.flags`). Lowest precedence — a class or method declaration
   * of the same name wins, and `@Flag.off` on a method removes it.
   */
  mountFlags?: RouteFlagDeclarations
}

/**
 * Turn a controller class decorated with @Get, @Post, etc. into a plain-data
 * {@link RouteEntry}[] — the engine-neutral route table an {@link HttpRuntime}
 * materializes.
 *
 * What used to be per-handler Express `(req, res, next)` closures is now
 * captured as data: `middlewares` keep their `(ctx, next)` shape, the contributor
 * pipeline is pre-built into a `contributorRunner` closure, validation / upload
 * stay as metadata, and the terminal `handler` resolves the controller per-request
 * (to respect DI scoping) and invokes it. The runtime owns how these get wrapped
 * onto its engine.
 *
 * Routes use only the method-level decorator paths (e.g. @Get('/me') → '/me').
 * The @Controller path is NOT baked in — it is metadata for Swagger/introspection.
 * The module's routes().path is the single source of truth for the mount prefix,
 * which avoids path doubling when both the module and controller specify the path.
 *
 * The contributor pipeline is built here, so a cycle or missing `dependsOn`
 * throws at table-build time (boot) rather than on first request.
 */
export function buildRouteTable(
  controllerClass: any,
  options: BuildRoutesOptions = {},
): RouteEntry[] {
  const container = Container.getInstance()
  const externalSources = options.externalSources ?? _externalContributorSources
  const routes: RouteDefinition[] = getClassMeta<RouteDefinition[]>(
    METADATA.ROUTES,
    controllerClass,
    [],
  )

  // Class-level middleware
  const classMiddlewares: MiddlewareHandler[] = getClassMeta<MiddlewareHandler[]>(
    METADATA.CLASS_MIDDLEWARES,
    controllerClass,
    [],
  )

  // Class-level Context Contributors (#107) — applied to every method on the
  // controller. Method-level contributors are added per-route below.
  const classContributors: ContributorRegistration[] = getClassMeta<ContributorRegistration[]>(
    METADATA.CLASS_CONTRIBUTORS,
    controllerClass,
    [],
  )

  // Route flags declared on the controller — inherited by every method below
  // unless a method declares the same flag `false` (see core/route-flag.ts).
  const classFlagDeclarations = getClassFlagDeclarations(controllerClass)

  // Flags the module declared for this whole mount. Recorded against the class
  // so `getRouteFlags()` — the resolver Swagger and DevTools use, which sees no
  // mount — reports what the runtime actually resolved.
  const mountFlagDeclarations = toFlagDeclarations(
    options.mountFlags,
    `${controllerClass?.name ?? 'controller'} mount flags`,
  )
  registerMountFlags(controllerClass, mountFlagDeclarations)

  const entries: RouteEntry[] = []

  for (const route of routes) {
    const method = route.method.toUpperCase() as RouteMethod
    const fullPath = route.path || '/'

    // Method-level middleware
    const methodMiddlewares: MiddlewareHandler[] = getMethodMeta<MiddlewareHandler[]>(
      METADATA.METHOD_MIDDLEWARES,
      controllerClass,
      route.handlerName,
      [],
    )

    // @FileUpload decorator — runtime supplies the upload backend.
    const fileUploadConfig = getMethodMetaOrUndefined<FileUploadConfig>(
      METADATA.FILE_UPLOAD,
      controllerClass,
      route.handlerName,
    )

    // Context Contributor pipeline (#107) — class + method contributors,
    // built once at mount time so cycle/missing-dep failures abort boot.
    const methodContributors: ContributorRegistration[] = getMethodMeta<ContributorRegistration[]>(
      METADATA.METHOD_CONTRIBUTORS,
      controllerClass,
      route.handlerName,
      [],
    )

    // Flags in force for THIS route: class declarations overridden by method
    // ones. Resolved at build time so the per-request cost is a map lookup.
    const flags = resolveRouteFlags(
      classFlagDeclarations,
      getMethodFlagDeclarations(controllerClass, route.handlerName),
      mountFlagDeclarations,
    )

    let contributorRunner: CtxHandler | null = null
    let earlyContributorRunner: CtxHandler | null = null
    let contributors: RouteContributor[] | undefined
    if (
      classContributors.length > 0 ||
      methodContributors.length > 0 ||
      externalSources.length > 0
    ) {
      // Labels are surfaced in DuplicateContributorError messages — include
      // the registration's key + the original index so a same-key collision
      // at one precedence level points at the conflicting decorator slot,
      // not just the host method/class.
      const sources: SourcedRegistration[] = [
        ...methodContributors.map((registration, i): SourcedRegistration => ({
          source: 'method',
          registration,
          label: `${controllerClass.name}.${String(route.handlerName)}#${i}(${registration.key})`,
        })),
        ...classContributors.map((registration, i): SourcedRegistration => ({
          source: 'class',
          registration,
          label: `${controllerClass.name}.@class#${i}(${registration.key})`,
        })),
        ...externalSources,
      ]
      const routeLabel = `${method} ${fullPath}`
      const pipeline = buildPipeline(sources, { route: routeLabel })
      contributors = describePipeline(pipeline.contributors, sources)
      const { early, late } = splitBeforeValidation(pipeline, routeLabel)
      if (early) {
        earlyContributorRunner = (ctx) =>
          runContributors({ pipeline: early, ctx, container, flags })
      }
      if (late) {
        contributorRunner = (ctx) => runContributors({ pipeline: late, ctx, container, flags })
      }
    }

    // Terminal handler — resolve controller per-request to respect DI scoping.
    const handler: CtxHandler = (ctx) => container.resolve(controllerClass)[route.handlerName](ctx)

    entries.push({
      method,
      path: fullPath,
      middlewares: [...classMiddlewares, ...methodMiddlewares],
      contributorRunner,
      earlyContributorRunner,
      handler,
      meta: {
        controller: controllerClass,
        handlerName: route.handlerName,
        validation: route.validation,
        upload: fileUploadConfig,
        flags,
        ...(contributors ? { contributors } : {}),
      },
    })
  }

  return entries
}

/**
 * The pipeline as introspection shows it. The built pipeline keeps only the
 * registrations; their sources and labels are recovered from the inputs by
 * identity, along with the lower-precedence registrations each one replaced.
 */
function describePipeline(
  ordered: readonly SourcedRegistration['registration'][],
  sources: readonly SourcedRegistration[],
): RouteContributor[] {
  const bySource = new Map(sources.map((s) => [s.registration, s]))
  // Execution order: the pipeline is split at run time — `beforeValidation`
  // ones run first, ahead of middleware and validation, then the rest. Each
  // half keeps its dependency order.
  const runOrder = [
    ...ordered.filter((r) => r.beforeValidation === true),
    ...ordered.filter((r) => r.beforeValidation !== true),
  ]
  return runOrder.map((registration) => {
    const winner = bySource.get(registration)
    const described: RouteContributor = {
      key: registration.key,
      source: winner?.source ?? 'global',
      dependsOn: registration.dependsOn,
      beforeValidation: registration.beforeValidation === true,
      overrides: sources
        .filter((s) => s.registration !== registration && s.registration.key === registration.key)
        .map((s) => (s.label ? { source: s.source, label: s.label } : { source: s.source })),
    }
    if (winner?.label) described.label = winner.label
    return described
  })
}
