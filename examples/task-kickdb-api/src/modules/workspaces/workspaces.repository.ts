import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

export interface NewWorkspace {
  name: string
  slug: string
  description?: string | null
  ownerId: string
}

@Service()
export class WorkspacesRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  list() {
    return this.db.selectFrom('workspaces').selectAll().orderBy('createdAt', 'asc').execute()
  }

  findById(id: string) {
    return this.db.selectFrom('workspaces').selectAll().where('id', '=', id).executeTakeFirst()
  }

  // Single round-trip fetch of a workspace plus its members + projects
  // via the relational query layer. Replaces the three-query N+1
  // (workspace → workspaceMembers → projects) the controller used to
  // assemble for the "workspace overview" view.
  //
  // The `with` keys are checked against the `KickDbRelationsRegister`
  // augmentation emitted by `kick typegen` — mistyping a key here is
  // a compile error, not a runtime surprise.
  //
  // Pass `ctx.signal` from the controller to cancel the in-flight
  // query when the HTTP client disconnects mid-request.
  findFullById(id: string, signal?: AbortSignal) {
    return this.db.query.workspaces.findUnique({
      where: (_w, eb) => eb('id', '=', id),
      with: {
        owner: true,
        members: { with: { user: true } },
        projects: true,
      },
      signal,
    })
  }

  // Workspaces a user owns. Same nesting as `findFullById` so the
  // caller can render the same "workspace card" component without
  // round-tripping per row. Accepts `ctx.signal` to cancel the
  // potentially-expensive nested aggregation on client disconnect.
  listOwnedByUser(userId: string, signal?: AbortSignal) {
    return this.db.query.workspaces.findMany({
      where: (_w, eb) => eb('ownerId', '=', userId),
      orderBy: (_w, eb) => eb.ref('createdAt'),
      with: {
        members: { with: { user: true } },
        projects: true,
      },
      signal,
    })
  }

  create(input: NewWorkspace) {
    return this.db
      .insertInto('workspaces')
      .values({
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        ownerId: input.ownerId,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  }
}
