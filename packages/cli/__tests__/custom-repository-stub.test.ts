/**
 * A repository named after a database must not secretly be a Map.
 *
 * With `modules.repo: { name: 'postgres' }` the generator emitted
 * `postgres-audit.repository.ts` whose every method read and wrote an in-memory
 * `Map`, and the module bound it as the live implementation. The filename and
 * the class name both assert Postgres, so an app could be wired, booted and
 * manually tested against `PostgresAuditRepository` while every write went to a
 * store that empties on restart — with nothing in the types or the logs saying
 * so. The project also ended up with two in-memory repositories, one of them
 * named after a database.
 *
 * @module @forinda/kickjs-cli/__tests__/custom-repository-stub.test
 */

import { describe, expect, it } from 'vitest'

import { generateCustomRepository } from '../src/generators/templates/repository'

const source = generateCustomRepository({
  pascal: 'Audit',
  kebab: 'audit',
  repoType: 'postgres',
  repoPrefix: '.',
  dtoPrefix: './dtos',
})

describe('generated custom repository', () => {
  it('is named for the module, not the backing store', () => {
    // `PostgresAuditRepository` asserts a technology the stub does not
    // implement, and the module folder already carries the name. The store
    // survives only in prose and error text, where it is guidance.
    expect(source).toContain('export class AuditRepository')
    expect(source).not.toContain('PostgresAuditRepository')
    expect(source).toContain('postgres')
  })

  it('does not fake persistence with a Map', () => {
    expect(source).not.toContain('new Map')
    expect(source).not.toContain('this.store')
  })

  it('throws from every method of the interface', () => {
    for (const method of ['findById', 'findAll', 'findPaginated', 'create', 'update', 'delete']) {
      expect(source).toContain(`notImplemented('${method}')`)
    }
  })

  it('names the class and the method, and offers the working alternative', () => {
    // A failure that does not say which method still needs writing, or what to
    // use meanwhile, just moves the confusion somewhere else.
    expect(source).toContain('AuditRepository.${method}() is not implemented')
    expect(source).toContain('InMemoryAuditRepository')
  })

  it('still implements the interface, so the shape is type-checked', () => {
    // The stub has to keep the contract — otherwise tsc stops verifying the
    // signatures the real implementation must satisfy.
    expect(source).toContain('implements IAuditRepository')
    expect(source).toContain('@Repository()')
  })
})
