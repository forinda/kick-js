export { InertiaAdapter, type InertiaAdapterOptions, type SsrResult } from './adapter'
export {
  inertia,
  redirect,
  back,
  location,
  flash,
  buildPage,
  isInertiaRequest,
  isPageRequest,
  errorPage,
  type Page,
  type PageOptions,
} from './inertia'
export { optional, always, defer, merge, type InertiaProp } from './props'
export { inertiaErrorHandler, inertiaNotFound } from './errors'
export { defaultTemplate, pageBody, type HtmlParts, type HtmlTemplate } from './html'
