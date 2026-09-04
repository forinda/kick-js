/**
 * Derived constraint names and Postgres' 63-byte identifier limit (#647).
 *
 * Postgres does not reject an over-long name — it truncates silently. Two
 * derived names sharing a long prefix therefore become one name, and the
 * migration fails on the second with "constraint … already exists", leaving
 * everything after it unapplied.
 */
import { describe, it, expect } from 'vitest'
import { fitIdentifier, extractSnapshot, renderSchemaSource } from '@forinda/kickjs-db'
import { table, serial, integer, varchar } from '@forinda/kickjs-db'

const bytes = (s: string) => Buffer.byteLength(s)

describe('fitIdentifier()', () => {
  it('leaves a name within the limit exactly as it is', () => {
    // Every existing schema must keep the constraint names it already has.
    expect(fitIdentifier('users_email_unique')).toBe('users_email_unique')
    expect(fitIdentifier('a'.repeat(63))).toBe('a'.repeat(63))
  })

  it('shortens the first name over the limit', () => {
    const long = `${'a'.repeat(64)}_fk`
    expect(bytes(fitIdentifier(long))).toBeLessThanOrEqual(63)
  })

  it('keeps the trailing kind marker, so a reader still sees what it is', () => {
    expect(fitIdentifier(`${'x'.repeat(80)}_fk`)).toMatch(/_fk$/)
    expect(fitIdentifier(`${'x'.repeat(80)}_unique`)).toMatch(/_unique$/)
  })

  it('is stable — the same schema regenerates the same name', () => {
    const long = `${'q'.repeat(80)}_fk`
    expect(fitIdentifier(long)).toBe(fitIdentifier(long))
  })

  it('separates the two names that collided in the reported schema', () => {
    // Both truncate to the same 63 characters under plain truncation.
    const a = 'finance_vote_head_account_reference_ledgers_finance_vote_head_account_id_fk'
    const b = 'finance_vote_head_account_reference_ledgers_finance_vote_head_account_ref_id_fk'
    expect(a.slice(0, 63)).toBe(b.slice(0, 63)) // the bug, stated

    const [fa, fb] = [fitIdentifier(a), fitIdentifier(b)]
    expect(fa).not.toBe(fb)
    expect(bytes(fa)).toBeLessThanOrEqual(63)
    expect(bytes(fb)).toBeLessThanOrEqual(63)
  })

  it('counts bytes, not characters, and never splits one', () => {
    // Postgres truncates at a byte boundary; a multi-byte name runs out sooner
    // than its length suggests.
    const fitted = fitIdentifier(`${'é'.repeat(60)}_fk`)
    expect(bytes(fitted)).toBeLessThanOrEqual(63)
    expect(fitted).not.toContain('�')
  })

  it('still produces something usable when the name is all suffix', () => {
    const fitted = fitIdentifier(`${'z'.repeat(200)}_unique`)
    expect(bytes(fitted)).toBeLessThanOrEqual(63)
    expect(fitted).toMatch(/_unique$/)
  })
})

describe('derived names in a real schema (#647)', () => {
  const longTable = 'finance_vote_head_account_reference_ledgers'
  const owners = table('finance_vote_head_accounts', { id: serial().primaryKey() })
  const ledgers = table(longTable, {
    id: serial().primaryKey(),
    finance_vote_head_account_id: integer().references(() => owners.id),
    finance_vote_head_account_reference_code: varchar(64).unique(),
  })

  const snap = extractSnapshot({ owners, ledgers }, 'postgres')

  it('shortens the derived foreign-key name', () => {
    const fk = snap.tables[longTable].foreignKeys[0]
    expect(bytes(fk.name)).toBeLessThanOrEqual(63)
  })

  it('shortens the derived unique-constraint name', () => {
    const idx = snap.tables[longTable].indexes[0]
    expect(bytes(idx.name)).toBeLessThanOrEqual(63)
  })

  it('still renders both inline — the renderer recognises the shortened name', () => {
    // The derivation and the recognition have to agree, or a shortened name
    // reads as "custom" and the constraint drops to a TODO comment.
    const src = renderSchemaSource(snap)
    expect(src).toContain('.references(')
    expect(src).toContain('.unique()')
    expect(src).not.toContain('TODO')
  })
})
