import { Service, Inject } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

export interface NewUser {
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  avatarUrl?: string | null
}

@Service()
export class UsersRepository {
  // KickDbRegister augmentation in src/db/register.ts widens KickDbClient to the
  // schema-derived shape automatically — no Db cast needed at the call site.
  // id, isActive, createdAt are Generated<T> in the schema (serial PK +
  // boolean default + timestamp defaultNow), so insert values can omit them.
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  list() {
    return this.db.selectFrom('users').selectAll().orderBy('createdAt', 'asc').execute()
  }

  findById(id: string) {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
  }

  findByEmail(email: string) {
    return this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
  }

  create(input: NewUser) {
    return this.db
      .insertInto('users')
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        avatarUrl: input.avatarUrl ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  }
}
