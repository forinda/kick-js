/**
 * The Node entry (Node, Bun, Deno): everything, plus the file loader as the
 * default template source. Edge runtimes resolve `./edge` instead.
 */
import { stripTypes } from './strip-types'
import { useFileLoader, useStripTypes } from './views'

useFileLoader(() => import('./loaders/file'))
useStripTypes(stripTypes)

export * from './exports'
export { format, type FormatOptions } from './format'
