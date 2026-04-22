# Authorization

KickJS provides two levels of authorization:

- **Role-based** — `@Roles('admin')` checks string roles on the user
- **Policy-based** — `@Policy` + `@Can` checks resource-level permissions

Both work through `@forinda/kickjs-auth` and are enforced by `AuthAdapter` middleware.

## Role-Based Access Control

`@Roles()` checks that the authenticated user has at least one of the required roles:

```ts
@Delete('/:id')
@Roles('admin')
deleteUser(ctx) { ... }

@Get('/dashboard')
@Roles('admin', 'manager')   // Any of these roles
dashboard(ctx) { ... }
```

The user object must have a `roles: string[]` property.

### Tenant-Scoped Roles

When using multi-tenancy, roles can be resolved per-tenant:

```ts
new AuthAdapter({
  strategies,
  roleResolver: async (user, tenantId) => {
    const roles = await db.userRoles
      .where({ userId: user.id, tenantId })
      .select('role')
    return roles.map(r => r.role)
  },
})
```

When `roleResolver` is set and `req.tenant` exists, `@Roles()` checks the tenant-scoped roles instead of the user's global roles.

### Type-narrowing roles via `AuthUser` augmentation

`@Roles()` is generic over `AuthUser['roles'][number]`. Augment `AuthUser` to a literal-string array and typos at decoration sites become compile errors — no runtime check needed:

```ts
declare module '@forinda/kickjs-auth' {
  interface AuthUser {
    id: string
    email: string
    roles: ('admin' | 'editor' | 'viewer')[]
  }
}

@Roles('admin', 'editor')   // ✓ typechecks
@Roles('typo')              // ✗ TS error: 'typo' is not assignable to '"admin" | "editor" | "viewer"'
```

Apps that don't augment `AuthUser['roles']` get the loose `string[]` fallback — full backwards compatibility.

## Policy-Based Authorization

For resource-level permissions ("can this user edit THIS post?"), use policies.

### Defining Policies

A policy is a class with methods for each action:

```ts
import { Policy } from '@forinda/kickjs-auth'

@Policy('post')
class PostPolicy {
  view(user: AuthUser, post: Post) {
    return post.published || user.id === post.authorId
  }

  update(user: AuthUser, post: Post) {
    return user.id === post.authorId || user.roles.includes('admin')
  }

  delete(user: AuthUser) {
    return user.roles.includes('admin')
  }

  create(user: AuthUser) {
    return user.roles.includes('author') || user.roles.includes('admin')
  }
}
```

Each method receives the authenticated user and optionally the resource instance. Return `true` to allow, `false` to deny.

### Auto-Discovering Policies

`@Policy()` decorators only register when their file is imported. If you forget to import a policy file, `@Can()` checks will silently deny (policy not found = deny by default).

Use `loadPolicies()` with `import.meta.glob` to auto-discover all policy files:

```ts
// src/index.ts — before bootstrap()
import { loadPolicies } from '@forinda/kickjs-auth'

// Eagerly import all *.policy.ts files across all modules
loadPolicies(import.meta.glob('./modules/**/*.policy.ts', { eager: true }))

// Or if policies live in a dedicated folder
loadPolicies(import.meta.glob('./policies/**/*.ts', { eager: true }))
```

This uses Vite's `import.meta.glob` with `{ eager: true }` to import all matching files at startup. The `@Policy()` decorators fire as a side effect, registering each class in the global policy registry.

> **Recommended convention:** Name policy files `*.policy.ts` (e.g., `post.policy.ts`, `user.policy.ts`) so the glob pattern is specific and predictable.

### @Can() Decorator

Use `@Can()` on controller methods to enforce a policy check before the handler runs:

```ts
import { Can } from '@forinda/kickjs-auth'

@Controller('/posts')
@Authenticated()
class PostController {
  @Get('/')
  @Can('view', 'post')
  list(ctx) { ... }

  @Delete('/:id')
  @Can('delete', 'post')
  remove(ctx) { ... }
}
```

`@Can()` implies `@Authenticated()` — no need to add both. If the policy returns `false`, the request gets a 403 Forbidden response.

### Type-narrowing `@Can` and `AuthorizationService.can` via `PolicyRegistry`

`@Can(action, resource)` is generic over `PolicyRegistry`. Augment the registry with the (resource → actions) map and both arguments narrow at decoration sites:

```ts
declare module '@forinda/kickjs-auth' {
  interface PolicyRegistry {
    post: 'create' | 'update' | 'delete' | 'publish'
    user: 'invite' | 'suspend'
  }
}

@Can('delete', 'post')      // ✓ typechecks
@Can('typo', 'post')        // ✗ TS error: 'typo' is not assignable to '"create" | "update" | "delete" | "publish"'
@Can('delete', 'unknown')   // ✗ TS error: 'unknown' is not assignable to '"post" | "user"'
@Can('invite', 'post')      // ✗ TS error: 'invite' is not assignable to actions of 'post' (it's on 'user')
```

The same `PolicyRegistry`-based narrowing also applies to `AuthorizationService.can()` and `AuthorizationService.listObjects()`, so the runtime checks stay type-safe too:

```ts
const allowed = await authz.can(user, 'delete', 'post')     // ✓
const ids = await authz.listObjects(user, 'delete', 'post') // ✓
```

Apps that don't augment `PolicyRegistry` get the loose `(string, string)` fallback — full backwards compatibility.

### Programmatic Checks

Use `AuthorizationService` for checks inside services:

```ts
import { AuthorizationService } from '@forinda/kickjs-auth'

@Service()
class PostService {
  @Autowired() private authz!: AuthorizationService

  async update(user: AuthUser, postId: string, data: UpdateDto) {
    const post = await this.repo.findById(postId)

    if (!await this.authz.can(user, 'update', 'post', post)) {
      throw new HttpException(HttpStatus.FORBIDDEN, 'Cannot update this post')
    }

    return this.repo.update(postId, data)
  }
}
```

### How Policies Are Resolved

1. `@Policy('name')` registers the class in a global policy registry
2. `@Can('action', 'resource')` stores metadata on the controller method
3. `AuthAdapter` middleware reads the metadata after authentication
4. It instantiates the policy class and calls the named method
5. If the method returns `false`, a 403 response is sent

Missing policy or missing action both result in denial (deny by default).

## Combining Roles and Policies

You can use `@Roles()` and `@Can()` together. Roles are checked first:

```ts
@Delete('/:id')
@Roles('editor', 'admin')       // Must have editor or admin role
@Can('delete', 'post')          // AND pass the policy check
remove(ctx) { ... }
```

## Guards (Custom Middleware)

`kick g guard <name>` generates a middleware function for custom authorization logic that doesn't fit `@Roles()` or `@Can()`. Guards are raw Express middleware applied via `@Middleware()`.

```bash
kick g guard ip-whitelist
```

```ts
// src/guards/ip-whitelist.guard.ts
export async function ipWhitelistGuard(ctx: RequestContext, next: () => void) {
  const allowed = ['10.0.0.0/8', '192.168.1.0/24']
  if (!allowed.some(range => isInSubnet(ctx.req.ip, range))) {
    ctx.res.status(403).json({ message: 'IP not allowed' })
    return
  }
  next()
}
```

Apply it with `@Middleware()`:

```ts
import { Middleware } from '@forinda/kickjs'
import { ipWhitelistGuard } from '../guards/ip-whitelist.guard'

@Controller('/internal')
@Middleware(ipWhitelistGuard)
class InternalController {
  @Get('/metrics')
  metrics(ctx) { ... }
}
```

### When to Use What

| Mechanism | Use When | Example |
|-----------|----------|---------|
| `@Roles('admin')` | Check user has a string role | Admin panel access |
| `@Can('update', 'post')` | Check user can act on a specific resource | "Can this user edit THIS post?" |
| `@Middleware(guard)` | Custom logic not tied to roles or resources | IP whitelist, feature flags, API versioning |
| `@RateLimit()` | Throttle specific endpoints | Login endpoint, search API |

**Precedence in the auth middleware:**
1. `@Public()` — skips all auth
2. `@Authenticated()` / `defaultPolicy` — user must be authenticated
3. `@Roles()` — user must have at least one required role
4. `@Can()` — policy method must return `true`
5. `@RateLimit()` — request count within window
6. `@Middleware()` guards — run as Express middleware (before or after auth depending on order)

## See Also

- [Authentication](/guide/authentication) — strategies, decorators, events
- [Multi-Tenancy](/guide/multi-tenancy) — tenant-scoped role resolution
- [Middleware](/guide/middleware) — custom middleware and guards
