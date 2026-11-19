# Assets

`@assets('src/client/main.ts')` writes the tags for a Vite entry. Give `createViews` an `assets` function:

```ts
import { assetTags, type AssetsMode } from '@forinda/kickjs-view'

// The manifest exists only after `kick build`, so it's read only then.
const mode: AssetsMode = import.meta.env.DEV
  ? { dev: true, base: '/' }
  : {
      dev: false,
      manifest: (await import('../dist/client/.vite/manifest.json', { with: { type: 'json' } }))
        .default,
      base: '/',
    }

createViews({
  ...kickViews,
  assets: (entry, data) => assetTags(entry, mode, data.cspNonce as string),
})
```

In dev that's the Vite client plus the module. In a build it's the hashed script, its CSS and preload tags, each with the nonce when there is one.
