import { DEFERRED_PROP, OPTIONAL_PROP, ALWAYS_PROP, TO_BE_MERGED } from './symbols'
import type { PageObject, InertiaConfig, InertiaRequestInfo, RootViewFunction } from './types'
import type { DeferredProp, OptionalProp, AlwaysProp, MergeProp } from './props'

type SharedProvider = Record<string, any> | (() => Promise<Record<string, any>>)

export class Inertia {
  private ctx: any
  private config: InertiaConfig
  private sharedProviders: SharedProvider[] = []

  constructor(ctx: any, config: InertiaConfig) {
    this.ctx = ctx
    this.config = config
  }

  share(data: Record<string, any> | (() => Promise<Record<string, any>>)): this {
    this.sharedProviders.push(data)
    return this
  }

  getVersion(): string {
    return this.config.version ? this.config.version() : 'dev'
  }

  redirect(url: string, status = 302): void {
    const method = this.ctx.req.method
    if (['PUT', 'PATCH', 'DELETE'].includes(method) && status === 302) {
      status = 303
    }
    this.ctx.res.status(status).setHeader('Location', url).end()
  }

  async buildPageObject(
    component: string,
    pageProps: Record<string, any> = {},
  ): Promise<PageObject> {
    const requestInfo = this.parseRequestHeaders()
    const isPartialReload =
      requestInfo.partialComponent === component && requestInfo.partialData.length > 0

    const sharedData = await this.resolveSharedData()
    const rawProps = { ...sharedData, ...pageProps }

    const resolvedProps: Record<string, any> = {}
    const deferredProps: Record<string, string[]> = {}
    const mergeProps: string[] = []

    for (const [key, value] of Object.entries(rawProps)) {
      if (isPartialReload) {
        const isRequested = requestInfo.partialData.includes(key)
        const isAlways = this.isAlwaysProp(value)

        if (!isRequested && !isAlways) continue

        if (isAlways) {
          resolvedProps[key] = (value as AlwaysProp).value
        } else if (this.isDeferredProp(value)) {
          resolvedProps[key] = await (value as DeferredProp)()
        } else if (this.isOptionalProp(value)) {
          resolvedProps[key] = await (value as OptionalProp)()
        } else if (this.isMergeProp(value)) {
          resolvedProps[key] = (value as MergeProp).value
          mergeProps.push(key)
        } else {
          resolvedProps[key] = await Promise.resolve(value)
        }
      } else {
        if (this.isDeferredProp(value)) {
          const group = (value as DeferredProp)._group ?? 'default'
          if (!deferredProps[group]) deferredProps[group] = []
          deferredProps[group].push(key)
        } else if (this.isOptionalProp(value)) {
          // Skip on full load
        } else if (this.isAlwaysProp(value)) {
          resolvedProps[key] = (value as AlwaysProp).value
        } else if (this.isMergeProp(value)) {
          resolvedProps[key] = (value as MergeProp).value
          mergeProps.push(key)
        } else {
          resolvedProps[key] = await Promise.resolve(value)
        }
      }
    }

    return {
      component,
      props: resolvedProps,
      url: this.ctx.req.url,
      version: this.getVersion(),
      deferredProps,
      mergeProps,
    }
  }

  async render(component: string, pageProps?: Record<string, any>, viewProps?: any): Promise<void> {
    const pageObject = await this.buildPageObject(component, pageProps)
    const requestInfo = this.parseRequestHeaders()

    if (requestInfo.isInertiaRequest) {
      this.ctx.res.setHeader('X-Inertia', 'true')
      this.ctx.res.setHeader('Vary', 'X-Inertia')
      return this.ctx.json(pageObject)
    }

    const html = await this.renderHtml(pageObject, viewProps)
    return this.ctx.html(html)
  }

  private async renderHtml(pageObject: PageObject, viewProps?: any): Promise<string> {
    let head = ''
    let body = ''

    if (this.config.ssr?.enabled) {
      try {
        const { ServerRenderer } = await import('./server-renderer')
        const renderer = new ServerRenderer(this.config.ssr)
        const result = await renderer.render(pageObject)
        if (result) {
          head = result.head.join('\n')
          body = result.body
        }
      } catch {
        // SSR failed — fall back to client-side rendering
      }
    }

    const rootView = this.config.rootView
    if (typeof rootView === 'function') {
      return (rootView as RootViewFunction)(pageObject, { head, body })
    }

    const pageScript = `<script>globalThis.__INERTIA_PAGE__ = ${JSON.stringify(pageObject)}</script>`
    const viteScripts = this.resolveViteScripts()

    let html = rootView
    html = html.replace('<!-- {{HEAD}} -->', head)
    html = html.replace('<!-- {{SSR_CONTENT}} -->', body)
    html = html.replace('<!-- {{INERTIA_PAGE}} -->', pageScript)
    html = html.replace('<!-- {{VITE_SCRIPTS}} -->', viteScripts)

    return html
  }

  resolveViteScripts(): string {
    const ssr = this.config.ssr
    const entrypoint = ssr?.entrypoint ?? 'src/app.tsx'

    if ((globalThis as any).__kickjs_viteServer) {
      return `<script type="module" src="/${entrypoint}"></script>`
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readFileSync, existsSync } = require('node:fs')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolve } = require('node:path')
      const manifestPaths = ['build/client/.vite/manifest.json', 'dist/client/.vite/manifest.json']
      for (const relPath of manifestPaths) {
        const absPath = resolve(relPath)
        if (existsSync(absPath)) {
          const manifest = JSON.parse(readFileSync(absPath, 'utf-8'))
          const entry = manifest[entrypoint]
          if (!entry) break
          const tags: string[] = []
          if (entry.css) {
            for (const css of entry.css) {
              tags.push(`<link rel="stylesheet" href="/${css}">`)
            }
          }
          tags.push(`<script type="module" src="/${entry.file}"></script>`)
          return tags.join('\n')
        }
      }
    } catch {
      // Manifest not found
    }

    return ''
  }

  private parseRequestHeaders(): InertiaRequestInfo {
    const headers = this.ctx.req.headers
    const partialDataHeader = headers['x-inertia-partial-data'] as string | undefined

    return {
      isInertiaRequest: headers['x-inertia'] === 'true',
      clientVersion: headers['x-inertia-version'] as string | undefined,
      partialComponent: headers['x-inertia-partial-component'] as string | undefined,
      partialData: partialDataHeader
        ? partialDataHeader.split(',').map((s: string) => s.trim())
        : [],
    }
  }

  private async resolveSharedData(): Promise<Record<string, any>> {
    let result: Record<string, any> = {}

    if (this.config.share) {
      const data = await this.config.share(this.ctx)
      result = { ...result, ...data }
    }

    for (const provider of this.sharedProviders) {
      const data = typeof provider === 'function' ? await provider() : provider
      result = { ...result, ...data }
    }

    return result
  }

  private isDeferredProp(value: any): boolean {
    return typeof value === 'function' && value[DEFERRED_PROP] === true
  }

  private isOptionalProp(value: any): boolean {
    return typeof value === 'function' && value[OPTIONAL_PROP] === true
  }

  private isAlwaysProp(value: any): boolean {
    return value != null && typeof value === 'object' && value[ALWAYS_PROP] === true
  }

  private isMergeProp(value: any): boolean {
    return value != null && typeof value === 'object' && value[TO_BE_MERGED] === true
  }
}
