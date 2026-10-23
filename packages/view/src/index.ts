/**
 * The Node entry (Node, Bun, Deno): everything, plus the file loader as the
 * default template source. Edge runtimes resolve `./edge` instead.
 */
import { stripTypes } from './strip-types'
import { readFile } from 'node:fs/promises'
import { useClientFiles, useFileLoader, useStripTypes } from './views'

useFileLoader(() => import('./loaders/file'))
useStripTypes(stripTypes)
useClientFiles((url) => readFile(url))

export * from './exports'
export { format, type FormatOptions } from './format'
