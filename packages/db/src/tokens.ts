import { createToken, type InjectionToken } from '@forinda/kickjs'

import type { KickDbClient } from './client/types'

// First-party tokens own the reserved `kick/` namespace. Adopter-defined
// tokens (e.g. additional shards / read replicas beyond the default pair)
// should use the adopter's own scope (e.g. `app/db/tenants`).
export const DB_PRIMARY: InjectionToken<KickDbClient> = createToken<KickDbClient>('kick/db/primary')
export const DB_REPLICA: InjectionToken<KickDbClient> = createToken<KickDbClient>('kick/db/replica')

/**
 * Alias for the default DB. Adopters who only have one database can inject
 * `DB_CLIENT` instead of remembering whether it's primary/replica.
 */
export const DB_CLIENT = DB_PRIMARY
