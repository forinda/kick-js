import { resolve } from 'node:path'
import { Logger, type AppAdapter, type AdapterContext } from '../../core'

const log = Logger.for('ViewEngine')

export interface ViewAdapterOptions {
  /**
   * Template engine — pass the engine module or a render function.
   * Supported engines: ejs, pug, handlebars, nunjucks, or any
   * Express-compatible engine with a __express property.
   *
   * @example
   * ```ts
   * import ejs from 'ejs'
   * new ViewAdapter({ engine: ejs, ext: 'ejs' })
   *
   * import pug from 'pug'
   * new ViewAdapter({ engine: pug, ext: 'pug' })
   * ```
   */
  engine: any

  /** File extension for templates (e.g., 'ejs', 'pug', 'hbs') */
  ext: string

  /** Directory containing template files (default: 'src/views') */
  viewsDir?: string

  /** Default layout template (optional — depends on engine) */
  layout?: string
}

/**
 * View/template adapter — pluggable template engine support for KickJS.
 *
 * Registers an Express view engine and sets the views directory.
 * Use `ctx.render()` in controllers to render templates.
 *
 * @example
 * ```ts
 * import ejs from 'ejs'
 * import { ViewAdapter } from '@forinda/kickjs-http/views'
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     new ViewAdapter({ engine: ejs, ext: 'ejs', viewsDir: 'src/views' }),
 *   ],
 * })
 *
 * // In a controller:
 * @Get('/dashboard')
 * async dashboard(ctx: RequestContext) {
 *   ctx.render('dashboard', { user: currentUser, title: 'Dashboard' })
 * }
 * ```
 */
export class ViewAdapter implements AppAdapter {
  name = 'ViewAdapter'

  constructor(private options: ViewAdapterOptions) {}

  beforeMount({ app }: AdapterContext): void {
    const { engine, ext, viewsDir = 'src/views' } = this.options

    // Register the engine
    if (engine.__express) {
      // EJS, Pug — have __express method
      app.engine(ext, engine.__express)
    } else if (typeof engine.renderFile === 'function') {
      // Engines with renderFile (nunjucks-style)
      app.engine(ext, (path: string, options: any, callback: Function) => {
        engine.renderFile(path, options, callback)
      })
    } else if (typeof engine === 'function') {
      // Custom render function: (path, options, callback) => void
      app.engine(ext, engine)
    } else {
      log.warn(`Engine for .${ext} does not have __express or renderFile. Trying as-is.`)
      app.engine(ext, engine)
    }

    app.set('view engine', ext)
    app.set('views', resolve(viewsDir))

    log.debug(`View engine: ${ext} (${resolve(viewsDir)})`)
  }
}
