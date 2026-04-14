import type { PageObject, SsrConfig, SsrResult } from './types'

export class ServerRenderer {
  private config: SsrConfig
  private runtime: any = null
  private ssrEnvironment: any = null

  constructor(config: SsrConfig) {
    this.config = config
  }

  async render(pageObject: PageObject): Promise<SsrResult | null> {
    if (!this.config.enabled) return null

    const viteServer = (globalThis as any).__kickjs_viteServer

    if (viteServer) {
      return this.devRender(pageObject, viteServer)
    }

    if (this.config.bundle) {
      return this.prodRender(pageObject)
    }

    return null
  }

  private async devRender(pageObject: PageObject, viteServer: any): Promise<SsrResult | null> {
    try {
      const currentEnv = viteServer.environments.ssr

      if (this.ssrEnvironment !== currentEnv) {
        this.ssrEnvironment = currentEnv
        this.runtime = await this.createRuntime(currentEnv)
      }

      const entrypoint = this.config.entrypoint ?? 'src/ssr.tsx'
      const mod = await this.runtime.import(entrypoint)
      return await mod.default(pageObject)
    } catch {
      return null
    }
  }

  private async prodRender(pageObject: PageObject): Promise<SsrResult | null> {
    try {
      const mod = await this.loadProdBundle(this.config.bundle!)
      return await mod.default(pageObject)
    } catch {
      return null
    }
  }

  protected async createRuntime(ssrEnvironment: any): Promise<any> {
    const vite = await import('vite')
    const createRuntime = (vite as any).createViteRuntime
    return createRuntime(ssrEnvironment, { hmr: { logger: false } })
  }

  protected async loadProdBundle(bundlePath: string): Promise<any> {
    const { pathToFileURL } = await import('node:url')
    return import(/* @vite-ignore */ pathToFileURL(bundlePath).href)
  }
}
