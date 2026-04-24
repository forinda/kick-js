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
 *
 * `description` and `example` may both be multi-line — typegen preserves
 * line breaks when rendering them as JSDoc. There is no upper limit on
 * the example size; entire shape definitions or worked snippets are fine.
 */
export interface AugmentationMeta {
  /**
   * Free-form description of what the augmentation customises. May be
   * multi-line — newlines are preserved in the generated JSDoc.
   */
  description?: string
  /**
   * TS snippet showing a typical shape. May be multi-line; rendered
   * inside a fenced code block in the generated catalogue. Use this
   * for anything from `'{ foo: string }'` up to a full interface body
   * — typegen no longer flattens newlines.
   */
  example?: string
}

/**
 * Advertise an augmentable interface so `kick typegen` can list it in
 * `.kickjs/types/augmentations.d.ts` for project-wide discovery.
 *
 * **This function is a runtime AND type-level no-op.** It does NOT
 * augment the interface for TypeScript. The actual augmentation is
 * the `declare module` block — `defineAugmentation` only adds an
 * entry to the typegen catalogue so other contributors / adopters
 * can find the interface and know its expected shape.
 *
 * Both calls are needed:
 *
 * ```ts
 * import { defineAugmentation } from '@forinda/kickjs'
 *
 * // (1) The actual TS augmentation — what `ctx.get('tenant')` reads.
 * declare module '@forinda/kickjs' {
 *   interface ContextMeta {
 *     tenant: { id: string; name: string }
 *   }
 * }
 *
 * // (2) Catalogue entry — what `kick typegen` lists in
 * //     `.kickjs/types/augmentations.d.ts` for browseability.
 * defineAugmentation('ContextMeta', {
 *   description: 'Tenant resolved from x-tenant-id by TenantAdapter',
 *   example: `{
 *     tenant: {
 *       id: string
 *       name: string
 *       plan: 'free' | 'pro' | 'enterprise'
 *       featureFlags: Record<string, boolean>
 *     }
 *   }`,
 * })
 * ```
 *
 * Skip `defineAugmentation` if you don't care about the catalogue — the
 * `declare module` block alone is enough for runtime + type behaviour.
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
