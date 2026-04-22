import type { AppAdapter, ContributorRegistration } from '@forinda/kickjs'
import { LoadFlags } from '../contributors'

/**
 * Demo adapter that ships a single Context Contributor.
 *
 * Adapter-level contributors apply to every route in the application —
 * cross-cutting, like middleware. They lose to module/class/method
 * contributors on the same key but win over global (bootstrap) ones.
 *
 * Real adapters typically also implement `middleware()`, `beforeStart()`,
 * `shutdown()`, etc. This stub only demonstrates the contributors() hook.
 */
export class FlagsAdapter implements AppAdapter {
  name = 'FlagsAdapter'

  contributors(): ContributorRegistration[] {
    return [LoadFlags.registration]
  }
}
