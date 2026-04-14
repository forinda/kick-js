import type { RequestContext } from '@forinda/kickjs'

export interface PageObject {
  component: string
  props: Record<string, any>
  url: string
  version: string
  deferredProps: Record<string, string[]>
  mergeProps: string[]
}

export interface SsrResult {
  head: string[]
  body: string
}

export interface SsrConfig {
  enabled?: boolean
  entrypoint?: string
  bundle?: string
}

export interface InertiaConfig {
  rootView: string | RootViewFunction
  version?: () => string
  ssr?: SsrConfig
  share?: (ctx: RequestContext) => Promise<Record<string, any>> | Record<string, any>
}

export type RootViewFunction = (page: PageObject, html: { head: string; body: string }) => string

export interface InertiaRequestInfo {
  isInertiaRequest: boolean
  clientVersion: string | undefined
  partialComponent: string | undefined
  partialData: string[]
}
