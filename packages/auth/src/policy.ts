import { Logger, Service } from '@forinda/kickjs'
import type { AuthUser } from './types'

const log = Logger.for('AuthorizationService')

// ── Policy Registry ───────────────────────────────────────────────────

/** Global registry mapping resource names to their policy classes. */
export const policyRegistry = new Map<string, any>()

/**
 * Register a class as a policy for a named resource.
 *
 * Each method on the class represents an action (view, update, delete, etc.)
 * and receives the authenticated user and (optionally) the resource instance.
 *
 * @example
 * ```ts
 * @Policy('post')
 * class PostPolicy {
 *   view(user: AuthUser, post: Post) {
 *     return post.published || user.id === post.authorId
 *   }
 *
 *   update(user: AuthUser, post: Post) {
 *     return user.id === post.authorId || user.roles.includes('admin')
 *   }
 *
 *   delete(user: AuthUser, _post: Post) {
 *     return user.roles.includes('admin')
 *   }
 * }
 * ```
 */
export function Policy(resource: string): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata('policy:resource', resource, target)
    policyRegistry.set(resource, target)
    return target
  }
}

// ── Policy Auto-Discovery ────────────────────────────────────────────

/**
 * Eagerly import all policy files so `@Policy()` decorators fire and
 * register in the global `policyRegistry`. Without this, policy classes
 * that are never explicitly imported remain unregistered.
 *
 * Uses `import.meta.glob` (Vite) for zero-config discovery.
 *
 * @example
 * ```ts
 * // src/index.ts — call before bootstrap()
 * import { loadPolicies } from '@forinda/kickjs-auth'
 *
 * // Eagerly import all *.policy.ts files under src/
 * loadPolicies(import.meta.glob('./modules/** /*.policy.ts', { eager: true }))
 *
 * // Or use a custom pattern
 * loadPolicies(import.meta.glob('./policies/** /*.ts', { eager: true }))
 * ```
 *
 * @param modules - The result of `import.meta.glob(..., { eager: true })`
 * @returns The number of policy classes discovered
 */
export function loadPolicies(modules: Record<string, any>): number {
  const before = policyRegistry.size
  // Eager glob imports are already executed — the @Policy() decorators
  // have fired and registered themselves. We just need to iterate to
  // ensure the modules are referenced (prevents tree-shaking).
  for (const mod of Object.values(modules)) {
    // Touch each export to ensure side effects ran
    if (mod && typeof mod === 'object') {
      Object.keys(mod)
    }
  }
  return policyRegistry.size - before
}

// ── AuthorizationService ──────────────────────────────────────────────

/**
 * How `AuthorizationService` responds when a `@Can(action, resource)` call
 * targets a resource with no registered policy, or a policy class with no
 * matching action method.
 *
 * - `'warn'` (default) — log once per (resource, action) and deny. Catches
 *   typos and renamed methods without breaking prod traffic.
 * - `'error'` — throw a `PolicyMissingError`. Use in strict CI/test builds
 *   to fail loud on missing coverage.
 * - `'silent'` — deny with no log. Matches legacy behavior.
 */
export type PolicyMissBehavior = 'warn' | 'error' | 'silent'

export interface AuthorizationServiceOptions {
  /** How to handle `@Can()` calls that reference a missing policy or action. Default: `'warn'`. */
  onMiss?: PolicyMissBehavior
  /**
   * Short-circuit list. Any `can(user, action, resource)` whose
   * `'resource.action'` (or bare `'resource'`) appears here returns `true`
   * without consulting the policy registry. Useful in tests and for
   * feature-flag overrides.
   */
  allow?: string[]
  /**
   * Short-circuit list. Any `can(user, action, resource)` whose
   * `'resource.action'` (or bare `'resource'`) appears here returns `false`
   * without consulting the policy registry. `deny` takes precedence over
   * `allow` when an entry matches both.
   */
  deny?: string[]
  /**
   * Resolve the set of resource IDs a user can `action`. The mirror
   * operation of `can()` — used by list endpoints that need
   * `WHERE id IN (...)` pushdown instead of fetching everything and
   * filtering with `can()` row-by-row.
   *
   * Intended for ReBAC engines (OpenFGA, SpiceDB, Cedar). Callers that
   * only use class-based `@Policy` (attribute checks, no ID enumeration)
   * should leave this unset — `AuthorizationService.listObjects()` then
   * throws `NotImplementedError` so callers can fall back to a
   * find-all + `.can()` loop.
   */
  listObjects?: (user: AuthUser, action: string, resource: string) => Promise<readonly string[]>
}

/**
 * Thrown by `AuthorizationService.listObjects()` when no `listObjects`
 * implementation was provided. Callers should catch this and fall back
 * to `findAll + filter with can()`.
 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotImplementedError'
  }
}

/**
 * Thrown by `AuthorizationService.can()` when `onMiss: 'error'` is configured
 * and a policy or action method is missing.
 */
export class PolicyMissingError extends Error {
  readonly resource: string
  readonly action: string
  constructor(message: string, resource: string, action: string) {
    super(message)
    this.name = 'PolicyMissingError'
    this.resource = resource
    this.action = action
  }
}

/**
 * Programmatic authorization checks against registered policies.
 *
 * @example
 * ```ts
 * @Service()
 * class PostService {
 *   @Autowired() private authz!: AuthorizationService
 *
 *   async update(user: AuthUser, postId: string, data: UpdateDto) {
 *     const post = await this.repo.findById(postId)
 *     if (!await this.authz.can(user, 'update', 'post', post)) {
 *       throw new HttpException(HttpStatus.FORBIDDEN, 'Cannot update this post')
 *     }
 *     return this.repo.update(postId, data)
 *   }
 * }
 * ```
 */
@Service()
export class AuthorizationService {
  private readonly onMiss: PolicyMissBehavior
  private readonly allow: ReadonlySet<string>
  private readonly deny: ReadonlySet<string>
  private readonly warnedMisses = new Set<string>()
  private readonly listObjectsImpl?: (
    user: AuthUser,
    action: string,
    resource: string,
  ) => Promise<readonly string[]>

  constructor(options: AuthorizationServiceOptions = {}) {
    this.onMiss = options.onMiss ?? 'warn'
    this.allow = new Set(options.allow ?? [])
    this.deny = new Set(options.deny ?? [])
    this.listObjectsImpl = options.listObjects
  }

  /**
   * Check if a user can perform an action on a resource.
   *
   * @param user - The authenticated user
   * @param action - The action to check (method name on the policy class)
   * @param resource - The resource name (matches @Policy('name'))
   * @param resourceInstance - Optional resource instance passed to the policy method
   * @returns `true` if allowed, `false` if denied or no policy found
   *
   * @throws {PolicyMissingError} when `onMiss: 'error'` and the policy class
   *   or action method is missing.
   */
  async can(
    user: AuthUser,
    action: string,
    resource: string,
    resourceInstance?: any,
  ): Promise<boolean> {
    const qualified = `${resource}.${action}`
    if (this.deny.has(qualified) || this.deny.has(resource)) return false
    if (this.allow.has(qualified) || this.allow.has(resource)) return true

    const PolicyClass = policyRegistry.get(resource)
    if (!PolicyClass) {
      this.reportMiss(
        resource,
        action,
        `No @Policy('${resource}') registered — denying ${resource}.${action}. ` +
          `Check that the policy file is imported (use loadPolicies()) and the resource name matches.`,
      )
      return false
    }

    const policy = new PolicyClass()
    const method = policy[action]
    if (typeof method !== 'function') {
      this.reportMiss(
        resource,
        action,
        `@Policy('${resource}') has no '${action}' method — denying ${resource}.${action}. ` +
          `Add \`${action}(user, instance)\` to ${PolicyClass.name} or rename the @Can() action.`,
      )
      return false
    }

    return method.call(policy, user, resourceInstance)
  }

  /**
   * Return the set of resource IDs the user can `action`. Requires a
   * `listObjects` implementation to be supplied via constructor options
   * — typically backed by a ReBAC engine (OpenFGA, SpiceDB, Cedar).
   *
   * @throws {NotImplementedError} when no implementation is registered.
   *   Callers should catch and fall back to `findAll + filter with can()`.
   */
  async listObjects(user: AuthUser, action: string, resource: string): Promise<readonly string[]> {
    if (!this.listObjectsImpl) {
      throw new NotImplementedError(
        `listObjects(${resource}.${action}) is not implemented — ` +
          'supply AuthorizationServiceOptions.listObjects (e.g. an OpenFGA client) ' +
          'or fall back to findAll + can().',
      )
    }
    return this.listObjectsImpl(user, action, resource)
  }

  /** True iff a `listObjects` implementation was supplied. */
  supportsListObjects(): boolean {
    return !!this.listObjectsImpl
  }

  private reportMiss(resource: string, action: string, message: string): void {
    if (this.onMiss === 'error') {
      throw new PolicyMissingError(message, resource, action)
    }
    if (this.onMiss === 'warn') {
      const key = `${resource}.${action}`
      if (this.warnedMisses.has(key)) return
      this.warnedMisses.add(key)
      log.warn(message)
    }
  }
}
