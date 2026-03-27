/**
 * @deprecated Use `@forinda/kickjs` instead of `@forinda/kickjs-http`.
 * This package is a compatibility shim that re-exports from the unified package.
 * It will be removed in v3.0.
 *
 * Migration:
 *   - import { bootstrap, RequestContext } from '@forinda/kickjs-http'
 *   + import { bootstrap, RequestContext } from '@forinda/kickjs'
 */

const _warned = new Set<string>()
function warnOnce(pkg: string) {
  if (_warned.has(pkg)) return
  _warned.add(pkg)
  console.warn(
    `[kickjs] @forinda/kickjs-${pkg} is deprecated. Use @forinda/kickjs instead. ` +
      `This shim will be removed in v3.0.`,
  )
}
warnOnce('http')

export * from '@forinda/kickjs'
