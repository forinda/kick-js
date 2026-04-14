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

## See Also

- [Authentication](/guide/authentication) — strategies, decorators, events
- [Multi-Tenancy](/api/multi-tenant) — tenant-scoped role resolution
