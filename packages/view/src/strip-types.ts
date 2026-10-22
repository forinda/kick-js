/**
 * Node's TypeScript stripper for `<script client>` (Node 22.13+). Only the
 * Node entry registers it: an edge bundle carries plain JS from the build and
 * must not reference `node:module`.
 */
import * as nodeModule from 'node:module'
import { NO_STRIPPER } from './client-scripts'

export function stripTypes(code: string): string {
  const strip = (nodeModule as { stripTypeScriptTypes?: (code: string) => string })
    .stripTypeScriptTypes
  if (!strip) throw new Error(NO_STRIPPER)
  return strip(code)
}
