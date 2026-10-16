import type { TemplateContext } from './types'

/**
 * The repository, as ONE file: factory, contract, token.
 *
 * The factory's RETURN TYPE is the contract — `${pascal}Repository` is derived
 * from it with `ReturnType`, so an implementation cannot drift from its own
 * interface, and there is no separate declaration to keep in step. Swapping
 * stores means writing another factory with a compatible return type; the
 * module decides which one is bound.
 *
 * That collapses what used to be three files (interface, in-memory class,
 * store-named class) into one, and removes the class named after a technology
 * it did not implement.
 *
 * @param ctx.repoType a store name makes the body an unimplemented stub whose
 * methods throw; omit it for the working in-memory implementation.
 */
export function generateRepositoryFactory(ctx: TemplateContext): string {
  const { pascal, kebab, repoType, dtoPrefix = './dtos', tokenScope = 'app' } = ctx
  const store = repoType && repoType !== 'inmemory' ? repoType : ''
  const factory = `create${pascal}Repository`

  // Always a WORKING implementation. The original bug was the NAME — a
  // `PostgresUserRepository` backed by a Map asserts a technology it does not
  // implement, and an app could boot and pass a smoke test on it. With the
  // store out of the name, an in-memory body is honest: this is the
  // repository, currently in memory, and the TODO says what to swap in.
  //
  // A stub that threw instead would be honest too, but it would leave a
  // generated project that cannot serve a single request.
  const body = `  const store = new Map<string, ${pascal}ResponseDTO>()

  return {
    async findById(id: string): Promise<${pascal}ResponseDTO | null> {
      return store.get(id) ?? null
    },

    async findAll(): Promise<${pascal}ResponseDTO[]> {
      return [...store.values()]
    },

    async findPaginated(
      parsed: ParsedQuery,
    ): Promise<{ data: ${pascal}ResponseDTO[]; total: number }> {
      // The parser already limited fields to ${pascal.toUpperCase()}_QUERY_CONFIG.
      const q = parsed.search.toLowerCase()
      const rows = [...store.values()].filter(
        (row) =>
          parsed.filters.every((f) => matches(field(row, f.field), f)) &&
          (!q || SEARCHABLE.some((name) => String(field(row, name) ?? '').toLowerCase().includes(q))),
      )
      rows.sort((a, b) => {
        for (const { field: name, direction } of parsed.sort) {
          const order = compare(field(a, name), field(b, name))
          if (order) return direction === 'desc' ? -order : order
        }
        return 0
      })
      const { offset, limit } = parsed.pagination
      return { data: rows.slice(offset, offset + limit), total: rows.length }
    },

    async create(dto: Create${pascal}DTO): Promise<${pascal}ResponseDTO> {
      const now = new Date().toISOString()
      const entity = { id: randomUUID(), ...dto, createdAt: now, updatedAt: now } as ${pascal}ResponseDTO
      store.set(entity.id, entity)
      return entity
    },

    async update(id: string, dto: Update${pascal}DTO): Promise<${pascal}ResponseDTO> {
      const existing = store.get(id)
      if (!existing) throw HttpException.notFound('${pascal} not found')
      const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
      store.set(id, updated)
      return updated
    },

    async delete(id: string): Promise<void> {
      if (!store.has(id)) throw HttpException.notFound('${pascal} not found')
      store.delete(id)
    },
  }`

  const imports = `import { randomUUID } from 'node:crypto'
import { createToken, HttpException } from '@forinda/kickjs'`

  const intro = store
    ? `Backed by an in-memory Map so the module works as generated. Replace the
 * body with your ${store} queries — the contract stays whatever this factory
 * returns.`
    : `Backed by an in-memory Map: a working store with no dependencies.`

  return `/**
 * ${pascal} repository.
 *
 * ${intro}
 *
 * The factory's return type IS the contract: \`${pascal}Repository\` is derived
 * from it, so the implementation and its interface cannot drift apart. To swap
 * stores, write another factory returning a compatible shape and bind that one
 * in the module — nothing else has to change.
 */
${imports}
import type { FilterItem, ParsedQuery } from '@forinda/kickjs'
import { ${pascal.toUpperCase()}_QUERY_CONFIG } from './${kebab}.constants'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'

const SEARCHABLE = (${pascal.toUpperCase()}_QUERY_CONFIG.searchable ?? []) as string[]

function field(row: object, name: string): unknown {
  return (row as Record<string, unknown>)[name]
}

/**
 * A stored number compares by value (the query's value is text); everything
 * else, ISO dates included, as text — so a string field keeps '001' ≠ '1'.
 */
function compare(stored: unknown, other: unknown): number {
  if (typeof stored === 'number') return stored - Number(other)
  return String(stored ?? '').localeCompare(String(other ?? ''))
}

/** One \`?filter=field:op:value\` — \`in\` and \`between\` take comma-separated values. */
function matches(value: unknown, { operator, value: raw }: FilterItem): boolean {
  const text = String(value ?? '').toLowerCase()
  const list = raw.split(',')
  switch (operator) {
    case 'eq':
      return compare(value, raw) === 0
    case 'neq':
      return compare(value, raw) !== 0
    case 'gt':
      return compare(value, raw) > 0
    case 'gte':
      return compare(value, raw) >= 0
    case 'lt':
      return compare(value, raw) < 0
    case 'lte':
      return compare(value, raw) <= 0
    case 'between':
      return compare(value, list[0]) >= 0 && compare(value, list[1]) <= 0
    case 'in':
      return list.some((v) => compare(value, v) === 0)
    case 'contains':
      return text.includes(raw.toLowerCase())
    case 'starts':
      return text.startsWith(raw.toLowerCase())
    case 'ends':
      return text.endsWith(raw.toLowerCase())
  }
}

export function ${factory}() {
${body}
}

/** The contract, derived from the factory rather than declared beside it. */
export type ${pascal}Repository = ReturnType<typeof ${factory}>

/**
 * Collision-safe DI token bound to \`${pascal}Repository\`.
 * \`container.resolve(${pascal.toUpperCase()}_REPOSITORY)\` and
 * \`@Inject(${pascal.toUpperCase()}_REPOSITORY)\` both return the typed
 * contract — no manual generic, no \`any\` cast.
 *
 * The \`'${tokenScope}/'\` prefix matches the project scope so
 * \`kick-lint\`'s \`token-reserved-prefix\` rule never fires —
 * adopters must NOT use the reserved \`'kick/'\` namespace.
 */
export const ${pascal.toUpperCase()}_REPOSITORY = createToken<${pascal}Repository>('${tokenScope}/${pascal}/repository')
`
}
