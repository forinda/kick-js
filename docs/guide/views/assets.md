# Assets

`@assets('src/client/main.ts')` writes the tags for a Vite entry. Give `createViews` an `assets` function:

```ts
import { assetTags } from '@forinda/kickjs-view'
import manifest from '../dist/client/.vite/manifest.json' with { type: 'json' }

const mode = import.meta.env.DEV ? { dev: true, base: '/' } : { dev: false, manifest, base: '/' }

createViews({
  ...kickViews,
  assets: (entry, data) => assetTags(entry, mode, data.cspNonce as string),
})
```

In dev that's the Vite client plus the module. In a build it's the hashed script, its CSS and preload tags, each with the nonce when there is one.
