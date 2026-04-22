/**
 * Augmentation registry — runtime no-op + the canonical
 * `KickJsPluginRegistry` interface that `kick typegen` augments.
 *
 * See `architecture.md` §21.2.1 (typegen for `dependsOn`) and §21.3.3
 * (standardized augmentation registry) for the design rationale.
 *
 * @module @forinda/kickjs/core/augmentation
 */

/**
 * Marker interface that lists every plugin/adapter in the project. The
 * keys are the literal `name` field passed to `defineAdapter` /
 * `definePlugin` (or declared on a `class implements AppAdapter`); the
 * values are the kind tag (`'plugin' | 'adapter'`).
 *
 * The framework ships this empty. `kick typegen` augments it from
 * source so `keyof KickJsPluginRegistry` resolves to a string-literal
 * union of every name in scope — and therefore so do `dependsOn`
 * declarations on plugins/adapters.
 */
export interface KickJsPluginRegistry {}

/**
 * Resolves to a string-literal union of every registered plugin/adapter
 * name when the project's typegen has populated `KickJsPluginRegistry`,
 * or to `string` when the registry is empty (no typegen pass yet).
 *
 * Falling back to `string` keeps fresh projects compiling — the typegen
 * narrowing is a progressive enhancement, not a hard prerequisite.
 */
export type KickJsPluginName = keyof KickJsPluginRegistry extends never
  ? string
  : keyof KickJsPluginRegistry & string

/**
 * Metadata attached to a `defineAugmentation` call. The fields are
 * documentation-only — `kick typegen` surfaces them in the generated
 * `.kickjs/types/augmentations.d.ts` so adopters can browse every
 * augmentable interface from one place.
 */
export interface AugmentationMeta {
  /** One-line description of what the augmentation customises. */
  description?: string
  /** Tiny TS snippet showing a typical shape (`'{ foo: string }'`). */
  example?: string
}

/**
 * Advertise an augmentable interface so `kick typegen` can list it in
 * `.kickjs/types/augmentations.d.ts`. Runtime no-op — exists purely as
 * a static marker for the typegen scanner to discover.
 *
 * @example
 * ```ts
 * import { defineAugmentation } from '@forinda/kickjs'
 *
 * export interface FeatureFlags {} // augmentable
 *
 * defineAugmentation('FeatureFlags', {
 *   description: 'Flags consumed by FlagsPlugin',
 *   example: '{ beta: boolean; rolloutPercentage: number }',
 * })
 * ```
 */
export function defineAugmentation(name: string, meta?: AugmentationMeta): void {
  // No-op at runtime — `kick typegen` discovers the call statically and
  // emits the augmentation catalogue. Touch the args so esbuild / tsc
  // don't drop the call as dead code under aggressive minification
  // (the marker has to survive the build for static scanners that look
  // at compiled output, e.g. third-party tools).
  void name
  void meta
}
