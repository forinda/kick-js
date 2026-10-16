export { InertiaAdapter, type InertiaAdapterOptions, type SsrResult } from './adapter'
export {
  inertia,
  redirect,
  back,
  location,
  flash,
  type RedirectOptions,
  buildPage,
  isInertiaRequest,
  isPageRequest,
  errorPage,
  type Page,
  type PageOptions,
} from './inertia'
export {
  optional,
  always,
  defer,
  merge,
  once,
  scroll,
  type InertiaProp,
  type ScrollMeta,
} from './props'
export { inertiaErrorHandler, inertiaNotFound, precognitive } from './errors'
export { defaultTemplate, pageBody, type HtmlParts, type HtmlTemplate } from './html'
export {
  sitemap,
  robots,
  type PageMeta,
  type MetaDefaults,
  type SitemapEntry,
  type RobotsOptions,
} from './seo'
