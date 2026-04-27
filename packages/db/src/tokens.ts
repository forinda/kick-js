import { createToken, type InjectionToken } from '@forinda/kickjs'

/**
 * Forward-declared client type. The full surface lands in T19b — until then
 * the token's phantom param is a structural placeholder so adopter code can
 * declare `@Inject(DB_PRIMARY) private db!: KickDbClient` against the same
 * token reference both before and after the wider client surface lands.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface KickDbClient {}

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
