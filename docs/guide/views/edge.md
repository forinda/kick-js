# Views on the Edge

On Workers and Vercel Edge, `@forinda/kickjs-view` resolves to a build without file access: templates come from `virtual:kick-views`, checked when you build. Use `viewsMiddleware(views)` with the [web entry](../edge-deployment.md):

```ts
import kickViews from 'virtual:kick-views'
import { createViews, viewsMiddleware } from '@forinda/kickjs-view'

const views = createViews({ ...kickViews })
export default createWebApp({ h3, modules, middlewares: [viewsMiddleware(views)] })
```
