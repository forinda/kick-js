# Repositories

KickJS generators produce a **repository interface** plus a DI token for every module, and a default in-memory implementation. This page shows how to implement that interface against a real `@forinda/kickjs-db` client — the persistence story that replaces the old built-in ORM repo presets.

## What the generator produces

`kick g module users` emits a repository contract like this:

```ts
// src/modules/users/domain/repositories/user.repository.ts
import { createToken } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { UserResponseDTO } from '../../application/dtos/user-response.dto'
import type { CreateUserDTO } from '../../application/dtos/create-user.dto'
import type { UpdateUserDTO } from '../../application/dtos/update-user.dto'

export interface IUserRepository {
  findById(id: string): Promise<UserResponseDTO | null>
  findAll(): Promise<UserResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: UserResponseDTO[]; total: number }>
  create(dto: CreateUserDTO): Promise<UserResponseDTO>
  update(id: string, dto: UpdateUserDTO): Promise<UserResponseDTO>
  delete(id: string): Promise<void>
}

export const USER_REPOSITORY = createToken<IUserRepository>('app/User/repository')
```

The service depends on `IUserRepository` (via `USER_REPOSITORY`), never on a concrete implementation. To swap from the in-memory default to a database-backed one, you write a class that implements the interface and bind it to the token in the module's `register()`.

## The schema

Declare the table the repository reads and writes (see [Schema](./schema)):

```ts
// src/db/schema.ts
import { table, uuid, varchar, timestamp } from '@forinda/kickjs-db'

export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  name: varchar(120).notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
})
```

## A database-backed repository

Implement `IUserRepository` against the injected `KickDbClient`. Inject the client through `DB_PRIMARY` and use the typed query builder:

```ts
// src/modules/users/infrastructure/repositories/db-user.repository.ts
import { Repository, Inject, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import { DB_PRIMARY, type KickDbClient } from '@forinda/kickjs-db'

import type { IUserRepository } from '../../domain/repositories/user.repository'
import type { UserResponseDTO } from '../../application/dtos/user-response.dto'
import type { CreateUserDTO } from '../../application/dtos/create-user.dto'
import type { UpdateUserDTO } from '../../application/dtos/update-user.dto'

@Repository()
export class DbUserRepository implements IUserRepository {
  @Inject(DB_PRIMARY) private db!: KickDbClient

  async findById(id: string): Promise<UserResponseDTO | null> {
    const row = await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? toDTO(row) : null
  }

  async findAll(): Promise<UserResponseDTO[]> {
    const rows = await this.db
      .selectFrom('users')
      .selectAll()
      .orderBy('createdAt', 'desc')
      .execute()
    return rows.map(toDTO)
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: UserResponseDTO[]; total: number }> {
    const data = await this.db
      .selectFrom('users')
      .selectAll()
      .orderBy('createdAt', 'desc')
      .limit(parsed.pagination.limit)
      .offset(parsed.pagination.offset)
      .execute()

    const totalRow = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()

    return { data: data.map(toDTO), total: Number(totalRow.count) }
  }

  async create(dto: CreateUserDTO): Promise<UserResponseDTO> {
    const row = await this.db
      .insertInto('users')
      .values({ email: dto.email, name: dto.name }) // id / timestamps are generated
      .returningAll()
      .executeTakeFirstOrThrow()
    return toDTO(row)
  }

  async update(id: string, dto: UpdateUserDTO): Promise<UserResponseDTO> {
    const row = await this.db
      .updateTable('users')
      .set({ ...dto, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst()
    if (!row) throw HttpException.notFound('User not found')
    return toDTO(row)
  }

  async delete(id: string): Promise<void> {
    const result = await this.db.deleteFrom('users').where('id', '=', id).executeTakeFirst()
    if (Number(result.numDeletedRows) === 0) throw HttpException.notFound('User not found')
  }
}
```

`@Repository()` registers the class as a DI singleton, and the query builder rows are typed straight from your schema. The `toDTO` mapper converts the row (where `createdAt` is a `Date`) into the response DTO shape (where it's typically an ISO string):

```ts
function toDTO(row: {
  id: string
  email: string
  name: string
  createdAt: Date
  updatedAt: Date
}): UserResponseDTO {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
```

::: tip Keep the mapper at the boundary
The repository is where the row shape (snake/camel, `Date` vs string) meets the DTO the rest of the app speaks. Doing the mapping here keeps services and controllers free of database concerns.
:::

## Binding the implementation

In the module's `register()`, bind the token to your DB-backed class so everything that injects `USER_REPOSITORY` (or `IUserRepository`) gets it. The only change from the generated module is swapping the implementation class:

```ts
// src/modules/users/users.module.ts
import { defineModule } from '@forinda/kickjs'
import { USER_REPOSITORY } from './domain/repositories/user.repository'
import { DbUserRepository } from './infrastructure/repositories/db-user.repository'
import { UsersService } from './application/users.service'
import { UsersController } from './presentation/users.controller'

export const UsersModule = defineModule({
  name: 'users',
  controllers: [UsersController],
  build: () => ({
    register(container) {
      // Was InMemoryUserRepository — now DB-backed.
      container.registerClass(USER_REPOSITORY, DbUserRepository)
    },
  }),
})
```

Because the service only ever depends on the interface + token, no service or controller code changes when you swap implementations — the in-memory repo from the generator and this DB repo are interchangeable.

## Transactions across repositories

When a use case spans multiple repositories, run them inside a single transaction. The transaction client (`tx`) is a fully-scoped `KickDbClient`, so a repository method can accept it instead of using the injected `this.db`:

```ts
await this.db.transaction(async (tx) => {
  const user = await tx
    .insertInto('users')
    .values({ email, name })
    .returningAll()
    .executeTakeFirstOrThrow()

  await tx.insertInto('profiles').values({ userId: user.id }).execute()
})
```

A common pattern is to make repository methods accept an optional client (`db: KickDbClient = this.db`) so they can be called either standalone or inside a transaction. See [Queries → Transactions](./queries#transactions) for the full transaction and savepoint surface.

## Repositories vs `$extends`

For simple, table-local query helpers you can also reach for `db.$extends({ model })` (see [Queries → Per-table methods](./queries#per-table-methods-with-extends)). The repository-interface approach is the right fit when you want:

- a stable contract the rest of the app depends on (the interface + token),
- DTO mapping at the persistence boundary,
- the ability to swap implementations (in-memory for tests, DB for production) without touching consumers.

Both can coexist — repositories for the persistence contract, `$extends` for ad-hoc reusable query shapes.
