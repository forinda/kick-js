import type { Inertia } from './inertia'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    inertia: Inertia
  }

  interface RequestContext {
    /** Per-request Inertia instance. Available after InertiaAdapter is registered. */
    readonly inertia: Inertia
  }
}
