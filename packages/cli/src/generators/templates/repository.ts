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
      const all = [...store.values()]
      const { offset, limit } = parsed.pagination
      return { data: all.slice(offset, offset + limit), total: all.length }
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
import type { ParsedQuery } from '@forinda/kickjs'
import type { ${pascal}ResponseDTO } from '${dtoPrefix}/${kebab}-response.dto'
import type { Create${pascal}DTO } from '${dtoPrefix}/create-${kebab}.dto'
import type { Update${pascal}DTO } from '${dtoPrefix}/update-${kebab}.dto'

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
