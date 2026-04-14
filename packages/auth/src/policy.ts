import { Service } from '@forinda/kickjs'
import type { AuthUser } from './types'

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

// ── AuthorizationService ──────────────────────────────────────────────

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
  /**
   * Check if a user can perform an action on a resource.
   *
   * @param user - The authenticated user
   * @param action - The action to check (method name on the policy class)
   * @param resource - The resource name (matches @Policy('name'))
   * @param resourceInstance - Optional resource instance passed to the policy method
   * @returns `true` if allowed, `false` if denied or no policy found
   */
  async can(
    user: AuthUser,
    action: string,
    resource: string,
    resourceInstance?: any,
  ): Promise<boolean> {
    const PolicyClass = policyRegistry.get(resource)
    if (!PolicyClass) return false

    const policy = new PolicyClass()
    const method = policy[action]
    if (typeof method !== 'function') return false

    return method.call(policy, user, resourceInstance)
  }
}
