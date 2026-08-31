/**
 * The repository is one file: factory, contract, token.
 *
 * It used to be three — a hand-declared `IUserRepository`, an
 * `InMemoryUserRepository` class, and, when a store was configured, a
 * `PostgresUserRepository` whose every method read and wrote an in-memory
 * `Map`. The module bound that last one as the live implementation, so an app
 * could be wired, booted and manually tested against `PostgresUserRepository`
 * while every write went to a store that empties on restart.
 *
 * The name was the lie, not the Map. With the store out of the class name, an
 * in-memory body is honest — this is the repository, currently in memory — and
 * the generated module still works as generated, which a throwing stub would
 * not.
 *
 * @module @forinda/kickjs-cli/__tests__/repository-factory.test
 */

import { describe, expect, it } from 'vitest'

import { generateRepositoryFactory } from '../src/generators/templates/repository'

const base = { pascal: 'Audit', kebab: 'audit', dtoPrefix: './dtos' }
const configured = generateRepositoryFactory({ ...base, repoType: 'postgres' })
const plain = generateRepositoryFactory(base)

describe('generated repository', () => {
  it('is named for the module, never the store', () => {
    // `PostgresAuditRepository` asserts a technology the file does not
    // implement, and the module folder already carries the name.
    for (const source of [configured, plain]) {
      expect(source).toContain('export function createAuditRepository')
      expect(source).not.toContain('PostgresAuditRepository')
      expect(source).not.toContain('InMemoryAuditRepository')
    }
  })

  it('derives the contract from the factory instead of declaring it twice', () => {
    // The return type IS the interface, so an implementation cannot drift from
    // its own contract, and there is no second file to keep in step.
    for (const source of [configured, plain]) {
      expect(source).toContain(
        'export type AuditRepository = ReturnType<typeof createAuditRepository>',
      )
      expect(source).toContain('createToken<AuditRepository>')
      expect(source).not.toContain('interface IAuditRepository')
    }
  })

  it('works as generated, whatever store is configured', () => {
    // The point of the rename is that this no longer claims to be Postgres, so
    // a working body is honest — and a generated module that cannot serve a
    // request is worse than one that serves from memory.
    for (const source of [configured, plain]) {
      expect(source).toContain('new Map')
      expect(source).not.toContain('not implemented')
    }
  })

  it('names the configured store where it is guidance, not a claim', () => {
    expect(configured).toContain('postgres')
    // …and says nothing about a store when none was chosen.
    expect(plain).not.toContain('postgres')
  })

  it('keeps the token-scope rule documented inline', () => {
    // Explains why the prefix is what it is; `kick-lint` reserves `kick/`.
    expect(plain).toMatch(/`'app\/'` prefix matches the project scope/)
  })
})
