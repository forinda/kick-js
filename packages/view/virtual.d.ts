/**
 * `virtual:kick-views`, from `@forinda/kickjs-vite`: the build's checked
 * templates (`null` in dev, where the file loader reads them) and the app's
 * pipes. Pass both to `createViews`:
 *
 * ```ts
 * /// <reference types="@forinda/kickjs-view/virtual" />
 * import kickViews from 'virtual:kick-views'
 * const views = createViews({ ...kickViews, layout: 'layouts/main' })
 * ```
 */
declare module 'virtual:kick-views' {
  import type { EnvPipe, Pipe, ViewsBundle } from '@forinda/kickjs-view'
  export const bundle: ViewsBundle | null
  export const pipes: Record<string, Pipe | EnvPipe>
  const views: { bundle: ViewsBundle | null; pipes: Record<string, Pipe | EnvPipe> }
  export default views
}
