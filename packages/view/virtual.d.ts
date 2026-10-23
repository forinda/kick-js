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
  /** Where component scripts are served: the Vite plugin's `clientScriptPath`. */
  export const clientScriptPath: string
  /** A `file:` URL of the folder `kick build` wrote client files to; `undefined` in dev. */
  export const clientDir: string | undefined
  const views: {
    bundle: ViewsBundle | null
    pipes: Record<string, Pipe | EnvPipe>
    clientScriptPath: string
    clientDir: string | undefined
  }
  export default views
}
