# AdonisJS Inertia.js Integration — Architecture Analysis

## Overview

AdonisJS's Inertia package (`@adonisjs/inertia`) is the most complete server-side Inertia implementation outside of Laravel. It features dual-mode rendering (SSR + client-only), lazy/deferred/optional props, shared data, type-safe page components, Edge.js template integration, and testing helpers. All 602 lines of core logic in a single `Inertia` class.

## Architecture Diagram

```
Request Flow:

  Browser → GET /users
    │
    ├── Has X-Inertia header?
    │     │
    │     ├── NO (first visit):
    │     │     Controller: ctx.inertia.render('Users/Index', { users })
    │     │       ↓
    │     │     Inertia.render():
    │     │       1. Build props (shared + page + resolve lazy)
    │     │       2. Create PageObject { component, props, url, version }
    │     │       3. SSR enabled?
    │     │          YES → ServerRenderer.render(PageObject)
    │     │                  Dev: Vite ModuleRunner.import(ssr-entry)
    │     │                  Prod: import(pre-built bundle)
    │     │                  Returns: { head: string[], body: string }
    │     │          NO  → Skip SSR
    │     │       4. Render Edge template (inertia_layout.edge):
    │     │          <html>
    │     │            <head>@inertiaHead(page)</head>
    │     │            <body>@inertia(page)</body>
    │     │              → <div id="app" data-page="{encoded PageObject}">
    │     │                  {SSR body or empty}
    │     │                </div>
    │     │            <script src="/src/app.tsx"> (Vite client entry)
    │     │          </html>
    │     │
    │     └── YES (subsequent navigation):
    │           Controller: same code
    │             ↓
    │           Inertia.#handleInertiaRequest():
    │             1. Set X-Inertia: true response header
    │             2. Return JSON PageObject:
    │                { component: 'Users/Index', props: { users }, url: '/users', version: 'abc' }
    │             3. Client swaps component (no page reload)
    │
    ├── Version mismatch? (X-Inertia-Version ≠ server version)
    │     → 409 Conflict + X-Inertia-Location header
    │     → Client does full page reload
    │
    └── Mutation redirect? (PUT/PATCH/DELETE → 302)
          → Upgrade to 303 (browser uses GET)
```

## Core Components

### 1. Inertia Class (602 lines)
**File:** `src/inertia.ts`

The central class. One instance per HTTP request (created by middleware).

**Key decision point** (`render()` lines 520-542):
```typescript
async render(page, pageProps, viewProps) {
  const pageObject = {
    component: page,
    version: this.getVersion(),
    props: await this.#buildPageProps(page, requestInfo, pageProps),
    url: this.#ctx.request.url(true),
    encryptHistory: this.#config.encryptHistory,
    clearHistory: false,
    deferredProps: { /* deferred prop groups */ },
    mergeProps: [ /* props marked for merge */ ],
  }

  if (requestInfo.isInertiaRequest) {
    return this.#handleInertiaRequest(pageObject)  // → JSON
  }

  if (await this.ssrEnabled(page)) {
    return this.#renderWithSSR(pageObject, viewProps)  // → Full HTML (SSR)
  }

  return this.#renderClientSide(pageObject, viewProps) // → Shell HTML (CSR)
}
```

### 2. ServerRenderer (135 lines)
**File:** `src/server_renderer.ts`

**Dev mode:** Uses Vite's `ModuleRunner` (Runtime API):
```typescript
// Lines 99-119
async #devRender(pageObject) {
  // Detect Vite restart — recreate runner if environment changed
  if (this.#ssrEnvironment !== currentEnv) {
    this.#ssrEnvironment = currentEnv
    this.#runtime = createViteRuntime(currentEnv, { hmr: { logger: false } })
  }
  
  const mod = await this.#runtime.import(this.#config.ssr.entrypoint!)
  return mod.default(pageObject)  // → { head: string[], body: string }
}
```

**Prod mode:** Direct import of pre-built SSR bundle:
```typescript
// Lines 120-126
async #prodRender(pageObject) {
  const bundlePath = pathToFileURL(this.#config.ssr.bundle)
  const mod = await import(bundlePath)
  return mod.default(pageObject)
}
```

### 3. Middleware (193 lines)
**File:** `src/inertia_middleware.ts`

Three phases:
1. **Init:** Create Inertia instance, attach to `ctx.inertia`, call `share()`
2. **Handler runs** (controller calls `ctx.inertia.render()`)
3. **Dispose:**
   - Version check → 409 if mismatch
   - Mutation redirect → 302→303 upgrade
   - Validation errors → extract from session flash

### 4. Prop System (614 lines)
**File:** `src/props.ts`

Four prop types using Symbol branding:
```typescript
defer(fn, group?)   // Computed lazily, grouped for bulk loading
optional(fn)        // Only computed when explicitly requested via header
always(value)       // Never filtered by cherry-picking
merge(value)        // Merged with existing client data (not replaced)
```

**Partial request flow:**
- Client sends `X-Inertia-Partial-Data: users,roles` header
- Server only computes `users` and `roles` props (skips heavy props)
- Returns subset → faster response

### 5. Shared Data
```typescript
// In middleware:
share(ctx) {
  return {
    auth: { user: ctx.auth.user },       // Available on every page
    flash: ctx.session.flashMessages,     // Flash messages
    errors: this.extractErrors(ctx),      // Validation errors
  }
}
```

Shared state providers are async functions resolved in parallel.

### 6. Asset Versioning
```typescript
getVersion() {
  if (this.#cachedVersion) return this.#cachedVersion
  
  // Default: MD5 hash of Vite manifest file
  const manifest = this.#vite.manifest()
  this.#cachedVersion = md5(JSON.stringify(manifest))
  return this.#cachedVersion
}
```

On mismatch: middleware returns 409 + `X-Inertia-Location` → client full-reloads.

### 7. Type Generation
**File:** `src/index_pages.ts` (119 lines)

Scans `src/pages/` for components, generates TypeScript declarations:
```typescript
// .adonisjs/server/pages.d.ts
declare module '@adonisjs/inertia/types' {
  interface InertiaPages {
    'Users/Index': { users: User[] }
    'Users/Show': { user: User }
  }
}
```

This gives `ctx.inertia.render()` full type checking on component names and props.

### 8. Client-Side Helpers

**React** (`src/client/react/`):
- `<Link route="users.show" routeParams={{ id: 1 }}>` — type-safe route links
- `<Form route="users.store">` — type-safe form submission
- `useRouter()` — programmatic navigation
- `useTuyau()` — access type-safe API client

**Vue** (`src/client/vue/`):
- Same API surface but Vue 3 composition API
- `<Link>`, `<Form>`, `useRouter()`, `useTuyau()`

### 9. Edge.js Template Tags

```edge
{{-- Root layout (inertia_layout.edge) --}}
<!DOCTYPE html>
<html>
<head>
  @inertiaHead(page)     {{-- SSR head tags (title, meta) --}}
  @vite(['src/app.tsx'])  {{-- Vite client entry --}}
</head>
<body>
  @inertia(page)          {{-- <div id="app" data-page="{...}">{SSR body}</div> --}}
</body>
</html>
```

### 10. Testing Helpers
**File:** `src/plugins/japa/api_client.ts`

```typescript
// In tests:
const response = await client.get('/users').withInertia()
response.assertInertiaComponent('Users/Index')
response.assertInertiaPropsContains({ users: expect.any(Array) })

// Partial reload test:
const partial = await client
  .get('/users')
  .withInertiaPartialReload('Users/Index', ['users'])
```

## Key Patterns for KickJS

### 1. One Inertia Instance Per Request
Created in middleware, attached to context. Carries shared state, request info, config. Garbage collected after response. **KickJS should do the same** — `ctx.inertia` as a request-scoped instance.

### 2. Symbol-Branded Props
`defer()`, `optional()`, `always()`, `merge()` use Symbols to tag props without changing their type. The prop builder checks symbols to decide inclusion/exclusion. **Elegant pattern for KickJS** — no runtime overhead, just Symbol checks.

### 3. SSR via Vite ModuleRunner (Not ssrLoadModule)
AdonisJS uses `createViteRuntime()` from Vite's Runtime API — newer and more efficient than `ssrLoadModule()`. Detects environment restarts and recreates runner. **KickJS should use this same API** for both Inertia SSR and general server code.

### 4. Version = MD5 of Vite Manifest
Simple, deterministic, no manual bumping. Client sends version, server compares, 409 on mismatch. **KickJS can enhance this** with reactive container: controller change → manifest changes → version changes → automatic 409.

### 5. Edge.js Template → KickJS Equivalent
AdonisJS uses Edge.js for the root HTML shell. KickJS doesn't have a template engine — we'll need a simple HTML template function or allow user-provided template string.

### 6. Type Generation for Page Components
Scanning `src/pages/` and generating TypeScript declarations for `render()` type checking. **KickJS can use the Vite `transform()` hook** (from Step 4) to do this at dev time.

### 7. Partial Reload via Headers
Client sends `X-Inertia-Partial-Data: users,roles` → server only computes those props. **Huge performance win** for pages with many expensive props. KickJS should implement this.

### 8. Middleware Handles Protocol
The middleware handles 409 version conflicts, 302→303 redirect upgrades, and validation error extraction. Controller code stays clean — just `ctx.inertia.render()`. **KickJS should use the same middleware-handles-protocol pattern.**

## Critical File References

| Component | Path | Lines |
|-----------|------|-------|
| Core Inertia | `src/inertia.ts` | 1-602 (render: 513-543, props: 221-262, version: 365-379) |
| Server Renderer | `src/server_renderer.ts` | 1-135 (dev: 99-119, prod: 120-126) |
| Middleware | `src/inertia_middleware.ts` | 1-193 (409: 181-191, 303: 170-174) |
| Props System | `src/props.ts` | 1-614 (defer: 68-80, optional: 107-112, build: 356-473) |
| Provider | `providers/inertia_provider.ts` | 1-152 (register: 122-128) |
| Manager | `src/inertia_manager.ts` | 1-76 (factory: 58) |
| Type Gen | `src/index_pages.ts` | 1-119 |
| Config | `src/define_config.ts` | 1-56 |
| Headers | `src/headers.ts` | 1-77 |
| Edge Plugin | `src/plugins/edge/plugin.ts` | 1-83 |
| React Client | `src/client/react/` | Link, Form, useRouter, context |
| Vue Client | `src/client/vue/` | Link, Form, useRouter, context |
| Vite Plugin | `src/client/vite.ts` | 1-117 |
| Testing | `src/plugins/japa/api_client.ts` | 1-256 |
| Symbols | `src/symbols.ts` | 1-38 |
