/**
 * The canonical `KickJsPluginRegistry` interface that `kick typegen`
 * augments, for typed `dependsOn` between plugins and adapters.
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
