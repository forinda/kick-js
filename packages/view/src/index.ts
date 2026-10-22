/**
 * The Node entry (Node, Bun, Deno): everything, plus the file loader as the
 * default template source. Edge runtimes resolve `./edge` instead.
 */
import { useFileLoader } from './views'

useFileLoader(() => import('./loaders/file'))

export * from './exports'
