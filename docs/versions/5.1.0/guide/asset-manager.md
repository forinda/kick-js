# Asset Manager

Type-safe path resolution for files that live near your code in dev but get copied to `dist/` in prod — mail templates, report templates, JSON fixtures, schemas, anything you `fs.readFile()` at runtime.

## The problem it solves

Without the asset manager, every render handler ends up doing some variant of:

```ts
const path =
  process.env.NODE_ENV === 'production'
    ? join(__dirname, '../templates/mails/welcome.ejs')
    : join(__dirname, '../../src/templates/mails/welcome.ejs')
```

Three things go wrong:

- **Typos compile.** `'welcom.ejs'` doesn't fail until the render handler fires.
- **Manual dev/prod branching** at every call site.
- **`__dirname` arithmetic** breaks under monorepos, ESM, worker threads, bundled dist layouts.

## With the asset manager

```ts
import { assets } from '@forinda/kickjs'

const path = assets.mails.welcome() // typed, autocompletes, dev/prod handled
const html = await ejs.renderFile(path, data)
```

One resolver, three accessor variants, full TypeScript autocomplete after `kick typegen` runs.

## Configure

Add `assetMap` to `kick.config.ts`:

```ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  // copyDirs is unchanged — keeps doing raw directory copies for
  // adopters who don't want the typed surface.
  copyDirs: ['src/static'],

  // assetMap drives the typed asset manager.
  assetMap: {
    mails: { src: 'src/templates/mails' },
    reports: { src: 'src/templates/reports', glob: '**/*.{ejs,html}' },
    schemas: { src: 'src/schemas', glob: '**/*.json' },
  },
})
```

Each entry shape:

| Field  | Required | Default        | Notes                                                               |
| ------ | -------- | -------------- | ------------------------------------------------------------------- |
| `src`  | yes      | —              | Source directory, relative to project root.                         |
| `dest` | no       | `dist/<name>/` | Destination inside `dist/`. Useful for matching downstream layouts. |
| `glob` | no       | `**/*`         | File filter. Common forms: `**/*.ejs`, `**/*.{ejs,html}`.           |

`copyDirs` and `assetMap` are independent — you can use both, neither, or only one. `copyDirs` is "copy this verbatim"; `assetMap` adds typed addressing on top of its own copy step.

## Run typegen

```bash
kick typegen
```

This walks every `assetMap.*.src` directory and emits `.kickjs/types/assets.d.ts` augmenting the framework's `KickAssets` interface:

```ts
declare module '@forinda/kickjs' {
  interface KickAssets {
    mails: {
      welcome: () => string
      'password-reset': () => string
      orders: {
        confirmation: () => string
      }
    }
    reports: {
      monthly: () => string
    }
  }
}
```

`kick dev` runs typegen automatically (initial pass + on-change). For one-shot CI builds, `kick build` runs it after the JS build. Adopters who hand-roll their build pipeline can call `kick typegen` themselves.

## Four ways to consume an asset

All four hit the same resolver under the hood — pick whichever fits the call site.

### 1. Proxy ambient — the default

```ts
import { assets } from '@forinda/kickjs'

const path = assets.mails.welcome()
const html = await ejs.renderFile(path, data)
```

Most ergonomic, full IDE autocomplete, works for static call sites.

### 2. Hook factory — class fields + DI

```ts
import { useAssets } from '@forinda/kickjs'

class MailService {
  private assets = useAssets()

  send(name: 'welcome' | 'password-reset', data: unknown) {
    return ejs.renderFile(this.assets.mails[name](), data)
  }
}
```

Same Proxy as `assets`, exposed via factory. Useful when:

- The class wants the asset object as a field.
- Tests need to mock the import (`vi.mock('@forinda/kickjs', () => ({ useAssets: () => fakeAssets }))`).
- DI container should own the assets binding (`container.registerInstance(ASSETS, useAssets())` then inject with `@Inject(ASSETS)`).

### 3. `@Asset` decorator — declarative class field

```ts
import { Service, Asset } from '@forinda/kickjs'

@Service()
class MailService {
  @Asset('mails/welcome')
  private welcomeTemplate!: string

  send(user: User) {
    return ejs.renderFile(this.welcomeTemplate, { user })
  }
}
```

Mirrors `@Value`'s lazy getter. Resolves on every property access through the same cached resolver — tests can swap fixtures + `clearAssetCache()` without re-instantiating the consuming class.

### 4. String resolver — dynamic dispatch

```ts
import { resolveAsset } from '@forinda/kickjs'

function renderTemplate(category: string, slug: string): string {
  // namespace + key not known at compile time
  return resolveAsset(category, slug)
}
```

Escape hatch for cases where the typed Proxy's shape doesn't fit (CMS-style template selection, code generators, dynamic test fixtures). Throws `UnknownAssetError` on miss with `namespace` + `key` fields on the error object so callers can branch.

## How resolution works at runtime

The resolver's discovery pipeline (cached after first call):

1. **`KICK_ASSETS_ROOT` env override** — if set, treated as the manifest directory and loaded directly. Useful for test fixtures and Docker mount overrides.
2. **Built manifest** — first tries the manifest under your configured `build.outDir` (when `kick.config.ts` declares one), then falls back to `dist/`, `build/`, `out/` under `cwd` in order. Manifest existence = "we're running from a built dist"; mapped paths returned verbatim. Fast path; dominant in production.
3. **Dev fallback** — synthesises an in-memory manifest by reading `kick.config.{json,cjs,js}` + walking each assetMap src dir. Cached after the walk.

`kick build` writes the manifest at `<config.build.outDir>/.kickjs-assets.json`. If your project uses a non-default Vite output directory, set it in your config so the resolver lines up:

```ts
export default defineConfig({
  build: { outDir: 'out' }, // or 'build', whatever Vite is set to
  assetMap: { ... },
})
```

## Build pipeline

`kick build` runs these steps in order:

1. JS build via Vite (existing).
2. `copyDirs` — raw directory copies (existing, unchanged).
3. `assetMap` — for each entry: walks `src/...` matching `glob`, copies matches into `dest`.
4. Writes `<outDir>/.kickjs-assets.json` (the manifest).
5. Runs `kick typegen` if the project has a `kick.config.ts`.

For a manifest-only refresh (no JS rebuild), use:

```bash
kick build:assets
```

Useful in dev when you've just added a template and want the manifest to pick it up without running the full Vite build.

## Edge cases

### Same basename in one directory (`index.html` + `index.js`)

Both files copy to dist. The manifest stores the **last-alphabetical winner** under the colliding key (`<namespace>/index`); the build emits a warning naming both files. Two fixes:

- Rename one of them.
- Tighten the `glob` to exclude one extension: `glob: '**/*.html'`.

### Files with non-identifier names

`welcome-email.ejs` becomes `assets.mails['welcome-email']()` — the typegen quotes non-identifier keys. Bracket access works, but it's less ergonomic than bare property access. Rename to `welcomeEmail.ejs` or `welcome_email.ejs` if you want the autocomplete sugar.

### File vs. directory at the same path

If you have both `mails/welcome.ejs` and `mails/welcome/login.ejs`, the typegen renderer promotes `welcome` to a sub-object (the directory wins). The build pipeline still copies both files, but only `welcome.login` is addressable through the Proxy.

### Dev-mode glob

The build uses the full `glob` package. The runtime dev-mode resolver uses a lite matcher covering `**/*`, `**/*.ext`, and `**/*.{a,b}` — anything more exotic warns once and accepts every file. Run `kick build:assets` to use the full glob engine in dev.

## Testing

Tests can swap fixtures by pointing `KICK_ASSETS_ROOT` at a directory containing a `.kickjs-assets.json` they wrote, then calling `clearAssetCache()` to invalidate the resolver:

```ts
import { clearAssetCache } from '@forinda/kickjs'

beforeEach(() => {
  process.env.KICK_ASSETS_ROOT = join(__dirname, 'fixtures/assets')
  clearAssetCache()
})

afterEach(() => {
  delete process.env.KICK_ASSETS_ROOT
  clearAssetCache()
})
```

`@Asset`-decorated classes pick up the new fixtures on the next property access — no need to re-instantiate the class.

## Reference

- `@forinda/kickjs` exports: `assets`, `useAssets`, `resolveAsset`, `Asset`, `ASSETS` (DI token), `clearAssetCache`, `UnknownAssetError`, `KickAssets` (type), `AssetKey` (type), `ASSET_MANIFEST_VERSION`.
- Manifest format: `dist/.kickjs-assets.json` with `{ version: 1, entries: { '<namespace>/<key>': '<relative-path>' } }`.
- DI token name: `'kick/assets/Map'` (per the §22 v4 token convention).

## See also

- [View Engines](view-engines.md) — `assets.views.dashboard()` works inside `ctx.render()` calls when you've named the views directory in `assetMap`.
- [Configuration](configuration.md) — the full `kick.config.ts` schema.
- [Type Generation](typegen.md) — `kick typegen` end-to-end + `KickAssets` augmentation alongside `KickEnv` / `KickJsRegistry`.
