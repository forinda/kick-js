/**
 * Module-augmentable registry for the typed KickJS-DB surface. Adopters
 * declare:
 *
 *   declare module '@forinda/kickjs-db' {
 *     interface Register {
 *       db: typeof appDbClient
 *     }
 *   }
 *
 * Once the augmentation is in scope, `KickDbClient` (with no explicit
 * generic) widens to `KickDbClient<KickDbSchemaFromRegister>` everywhere —
 * `@Inject(DB_PRIMARY) private db!: KickDbClient` produces the typed
 * client with no manual cast at the call site.
 *
 * `kick db typegen` (M2.B-T9) emits this declaration into
 * `.kickjs/types/kick__db.d.ts` for adopters who opt into codegen. Adopters
 * who prefer to declare it by hand do so once in any module that's reached
 * by their tsconfig.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}

/**
 * Pull the registered DB shape out of the augmentable Register interface.
 * `unknown` when the adopter hasn't declared an augmentation — keeps the
 * M1-permissive fallback intact.
 */
export type RegisteredDB = Register extends { db: { kysely: { __DB__?: never } } }
  ? unknown // Register['db'] is a phantom shape; this branch is unreachable.
  : Register extends { db: infer D }
    ? D extends { kysely: import('kysely').Kysely<infer X> }
      ? X
      : unknown
    : unknown
