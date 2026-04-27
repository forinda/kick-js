import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

import type { Db } from '../../db/client'

export interface NewWorkspace {
  name: string
  slug: string
  description?: string | null
  ownerId: string
}

@Service()
export class WorkspacesRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  private get typed(): Db {
    return this.db as Db
  }

  async list(): Promise<unknown[]> {
    return this.typed.selectFrom('workspaces').selectAll().orderBy('createdAt', 'asc').execute()
  }

  async findById(id: string): Promise<unknown | undefined> {
    return this.typed.selectFrom('workspaces').selectAll().where('id', '=', id).executeTakeFirst()
  }

  async create(input: NewWorkspace): Promise<unknown> {
    return this.typed
      .insertInto('workspaces')
      .values({
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        ownerId: input.ownerId,
      } as never)
      .returningAll()
      .executeTakeFirstOrThrow()
  }
}
