/**
 * @deprecated Use `@forinda/kickjs` instead of `@forinda/kickjs-core`.
 * This package is a compatibility shim that re-exports from the unified package.
 * It will be removed in v3.0.
 *
 * Migration:
 *   - import { Controller, Service } from '@forinda/kickjs-core'
 *   + import { Controller, Service } from '@forinda/kickjs'
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
warnOnce('core')

export * from '@forinda/kickjs'
