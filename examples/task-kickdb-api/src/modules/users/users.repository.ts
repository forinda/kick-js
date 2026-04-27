import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

import type { Db } from '../../db/client'

export interface NewUser {
  email: string
  firstName: string
  lastName: string
  avatarUrl?: string | null
}

@Service()
export class UsersRepository {
  // Constructor parameter injection — @Inject is a ParameterDecorator.
  // The Db cast narrows the M1-permissive `unknown` columns to the schema
  // declared in src/db/client.ts; M2-S1 tightens via column-builder generics
  // and the cast goes away.
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  private get typed(): Db {
    return this.db as Db
  }

  async list(): Promise<unknown[]> {
    return this.typed.selectFrom('users').selectAll().orderBy('createdAt', 'asc').execute()
  }

  async findById(id: string): Promise<unknown | undefined> {
    return this.typed.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
  }

  async findByEmail(email: string): Promise<unknown | undefined> {
    return this.typed.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
  }

  async create(input: NewUser): Promise<unknown> {
    return this.typed
      .insertInto('users')
      .values({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        avatarUrl: input.avatarUrl ?? null,
        isActive: true,
      } as never)
      .returningAll()
      .executeTakeFirstOrThrow()
  }
}
