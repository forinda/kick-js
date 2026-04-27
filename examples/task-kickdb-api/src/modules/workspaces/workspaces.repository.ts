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
