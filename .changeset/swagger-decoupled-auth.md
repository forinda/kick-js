---
'@forinda/kickjs-swagger': minor
---

Decouple `@forinda/kickjs-swagger` from `@forinda/kickjs-auth`. Swagger now ships its own auth-metadata surface — `@ApiSecurity()`, `@ApiPublic()`, `securityResolver` hook, declarative `securitySchemes` config — and no longer reads the `kick:auth:*` metadata keys from the auth package implicitly.

## Why

The previous behavior had Swagger silently reading `kick:auth:authenticated` / `kick:auth:public` metadata keys set by `@forinda/kickjs-auth`'s decorators. That implicit bridge:

- Coupled Swagger conceptually to one specific auth library by knowing its metadata key strings.
- Broke for adopters using a different auth library — their decorators wouldn't show up in the generated spec without monkey-patching.
- Hid configuration mistakes — typos in scheme names silently produced empty `bearer` schemes.

## What's new

### `@ApiSecurity(requirement)` — generic security decorator

Replaces the implicit fallback for adopter-driven security:

```ts
import { ApiSecurity } from '@forinda/kickjs-swagger'

@Controller('/users')
@ApiSecurity('BearerAuth')                              // class default
class UsersController {
  @Get('/me')
  @ApiSecurity({ name: 'OAuth2', scopes: ['users:read'] }) // override + scopes
  me() { ... }

  @Get('/multi')
  @ApiSecurity(['BearerAuth', { name: 'ApiKey' }])         // multiple alternatives
  multi() { ... }
}
```

Accepts a string, `{ name, scopes? }` object, or array of either. Class-level cascades; method-level overrides win.

### `@ApiPublic()` — explicit opt-out

Mirrors `@Public` from auth packages but in Swagger's namespace:

```ts
@Controller('/internal')
@ApiSecurity('BearerAuth')
class Internal {
  @Get('/health')
  @ApiPublic()
  health() { ... }
}
```

### `SwaggerOptions.securitySchemes` — declarative scheme registry

```ts
SwaggerAdapter({
  securitySchemes: {
    OAuth2: {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          scopes: { 'users:read': 'Read user profile' },
        },
      },
    },
    ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
  },
})
```

Custom scheme names referenced via `@ApiSecurity('MyScheme')` MUST be declared here — the builder no longer auto-synthesizes a bearer scheme for arbitrary names. The literal `BearerAuth` name keeps its auto-synth fallback for back-compat with `@ApiBearerAuth()` / `bearerAuth: true`.

### `SwaggerOptions.securityResolver` — bridge hook

For adopters who want their own auth library's metadata to drive Swagger without touching every controller:

```ts
SwaggerAdapter({
  securityResolver: ({ controllerClass, handlerName }) => {
    const proto = controllerClass.prototype
    if (Reflect.getMetadata('kick:auth:public', proto, handlerName)) return null
    const secured =
      Reflect.getMetadata('kick:auth:authenticated', controllerClass) ||
      Reflect.getMetadata('kick:auth:authenticated', proto, handlerName)
    return secured ? 'BearerAuth' : undefined
  },
})
```

Returns:

- A scheme name (or `ApiSecurityRequirement` / array) → emit those requirements.
- `null` → mark explicitly public (overrides class-level security).
- `undefined` → fall through to decorator-driven resolution.

This is the documented escape hatch for adopters who relied on the implicit bridge — same behavior, opt-in.

## Migration

Adopters using `@forinda/kickjs-auth` + Swagger together previously got security-marked routes for free. After this change:

- **Most adopters** can switch to `@ApiSecurity('BearerAuth')` on the class (or `bearerAuth: true` global).
- **Adopters who want to keep auth-library-driven detection** copy the `securityResolver` snippet above into their `SwaggerAdapter({...})` call. Behavior matches the historical implicit bridge exactly.

## Resolution order

1. `@ApiPublic()` on the method → no security emitted.
2. `securityResolver({controllerClass, handlerName})` returns a value (or `null` for public).
3. `@ApiSecurity` on the method.
4. `@ApiBearerAuth` on the method.
5. `@ApiSecurity` on the class.
6. `@ApiBearerAuth` on the class.

First match wins.

## Tests

7 new tests covering: `@ApiSecurity` (string/object/array shapes), class→method cascade + override, `@ApiPublic` opt-out, `securityResolver` happy path + `null` → public, `securitySchemes` config respected, custom-scheme refusal-to-auto-synth. The two former `kick:auth:*` bridge tests were dropped since the bridge no longer exists.
