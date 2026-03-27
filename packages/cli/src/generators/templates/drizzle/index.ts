import type { TemplateContext } from '../types'

export function generateDrizzleRepository(ctx: TemplateContext): string {
  const {
    pascal,
    kebab,
    repoPrefix = '../../domain/repositories',
    dtoPrefix = '../../application/dtos',
  } = ctx
  return `/**
 * Drizzle ${pascal} Repository
 *
 * Implements the repository interface using Drizzle ORM.
 * Uses buildFromColumns() with Column objects for type-safe query building.
 *
 * TODO: Update the schema import to match your Drizzle schema file.
 * TODO: Replace DRIZZLE_DB injection token with your actual database token.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc, count, sql } from 'drizzle-orm'
import { Repository, HttpException, Inject } from '@forinda/kickjs'
import { DRIZZLE_DB, DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'
import type { ParsedQuery } from '@forinda/kickjs'
import type { I${pascal}Repository } from '${repoPrefix}/${kebab}.repository'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'
import { ${pascal.toUpperCase()}_QUERY_CONFIG } from '../../constants'

// TODO: Import your Drizzle schema table — e.g.:
// import { ${kebab}s } from '@/db/schema'

const queryAdapter = new DrizzleQueryAdapter({
  eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc,
})

@Repository()
export class Drizzle${pascal}Repository implements I${pascal}Repository {
  constructor(@Inject(DRIZZLE_DB) private db: any) {}

  async findById(id: string): Promise<${pascal}ResponseDTO | null> {
    // TODO: Implement with Drizzle
    // const row = this.db.select().from(${kebab}s).where(eq(${kebab}s.id, id)).get()
    // return row ?? null
    throw new Error('Drizzle ${pascal} repository not yet implemented — update schema imports and queries')
  }

  async findAll(): Promise<${pascal}ResponseDTO[]> {
    // TODO: Implement with Drizzle
    // return this.db.select().from(${kebab}s).all()
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
    // TODO: Use buildFromColumns() with your query config for type-safe filtering
    // const query = queryAdapter.buildFromColumns(parsed, ${pascal.toUpperCase()}_QUERY_CONFIG)
    //
    // const data = this.db
    //   .select().from(${kebab}s).$dynamic()
    //   .where(query.where).orderBy(...query.orderBy)
    //   .limit(query.limit).offset(query.offset).all()
    //
    // const totalResult = this.db
    //   .select({ count: count() }).from(${kebab}s)
    //   .$dynamic().where(query.where).get()
    //
    // return { data, total: totalResult?.count ?? 0 }
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with Drizzle
    // return this.db.insert(${kebab}s).values(dto).returning().get()
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
    // TODO: Implement with Drizzle
    // const row = this.db.update(${kebab}s).set(dto).where(eq(${kebab}s.id, id)).returning().get()
    // if (!row) throw HttpException.notFound('${pascal} not found')
    // return row
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }

  async delete(id: string): Promise<void> {
    // TODO: Implement with Drizzle
    // this.db.delete(${kebab}s).where(eq(${kebab}s.id, id)).run()
    throw new Error('Drizzle ${pascal} repository not yet implemented')
  }
}
`
}

export function generateDrizzleConstants(ctx: TemplateContext): string {
  const { pascal, kebab } = ctx
  return `import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
// TODO: Import your schema table and reference actual columns for type safety
// import { ${kebab}s } from '@/db/schema'

export const ${pascal.toUpperCase()}_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    // Replace with actual Drizzle Column references for type-safe filtering:
    // name: ${kebab}s.name,
    // status: ${kebab}s.status,
  },
  sortable: {
    // name: ${kebab}s.name,
    // createdAt: ${kebab}s.createdAt,
  },
  searchColumns: [
    // ${kebab}s.name,
  ],
}
`
}
