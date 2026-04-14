import type { Inertia } from './inertia'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    inertia: Inertia
  }
}
