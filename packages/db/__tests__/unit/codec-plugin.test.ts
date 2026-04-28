import { describe, it, expect } from 'vitest'
import type { PluginTransformResultArgs, QueryResult, UnknownRow } from 'kysely'

import { CodecResultPlugin, buildDecoderMap } from '../../src/client/codec-plugin'
import { customType, table, serial, varchar } from '../../src/index'

type Encrypted = string & { readonly __brand: 'Encrypted' }

const fakeArgs = (rows: UnknownRow[]): PluginTransformResultArgs => ({
  result: { rows } as QueryResult<UnknownRow>,
  queryId: { queryId: 'test' } as never,
})

describe('CodecResultPlugin', () => {
  it('applies fromDriver to matching column on every row', async () => {
    const decoders = new Map<string, (v: unknown) => unknown>([
      ['secret', (v) => `dec:${String(v)}`],
    ])
    const plugin = new CodecResultPlugin(decoders)
    const result = await plugin.transformResult(
      fakeArgs([
        { id: 1, secret: 'enc:hello' },
        { id: 2, secret: 'enc:world' },
      ]),
    )
    expect(result.rows).toEqual([
      { id: 1, secret: 'dec:enc:hello' },
      { id: 2, secret: 'dec:enc:world' },
    ])
  })

  it('passes null + undefined through untouched (preserves nullable column semantics)', async () => {
    const decoders = new Map<string, (v: unknown) => unknown>([
      ['secret', (v) => `dec:${String(v)}`],
    ])
    const plugin = new CodecResultPlugin(decoders)
    const result = await plugin.transformResult(
      fakeArgs([
        { id: 1, secret: null },
        { id: 2, secret: undefined },
      ]),
    )
    expect(result.rows).toEqual([
      { id: 1, secret: null },
      { id: 2, secret: undefined },
    ])
  })

  it('returns the original result reference when decoders map is empty (zero overhead)', async () => {
    const plugin = new CodecResultPlugin(new Map())
    const args = fakeArgs([{ id: 1 }])
    const result = await plugin.transformResult(args)
    expect(result).toBe(args.result)
  })

  it('leaves unknown columns untouched', async () => {
    const decoders = new Map<string, (v: unknown) => unknown>([
      ['secret', (v) => `dec:${String(v)}`],
    ])
    const plugin = new CodecResultPlugin(decoders)
    const result = await plugin.transformResult(
      fakeArgs([{ id: 1, name: 'alice', secret: 'x' }]),
    )
    expect(result.rows[0]).toEqual({ id: 1, name: 'alice', secret: 'dec:x' })
  })
})

describe('buildDecoderMap()', () => {
  it('walks a schema record and collects fromDriver codecs from CustomColumnBuilder columns', () => {
    const encrypted = customType<Encrypted>({
      dataType: () => 'text',
      fromDriver: (raw) => `dec:${String(raw)}` as Encrypted,
    })
    const users = table('users', {
      id: serial().primaryKey(),
      name: varchar(255).notNull(),
      secret: encrypted().notNull(),
      hint: encrypted(), // nullable, same codec
    })
    const schema = { users }
    const map = buildDecoderMap(schema)

    expect(map.size).toBe(2)
    expect(map.has('secret')).toBe(true)
    expect(map.has('hint')).toBe(true)
    expect(map.has('id')).toBe(false)
    expect(map.has('name')).toBe(false)
  })

  it('skips CustomColumnBuilder columns with no fromDriver set', () => {
    const opaque = customType<string>({ dataType: () => 'text' })
    const t = table('t', {
      id: serial().primaryKey(),
      payload: opaque().notNull(),
    })
    expect(buildDecoderMap({ t }).size).toBe(0)
  })

  it('skips non-table entries (relations, helpers, etc.)', () => {
    const map = buildDecoderMap({
      notATable: { __isTable: false, x: 1 },
      stillNot: 'string',
      andNot: () => null,
    })
    expect(map.size).toBe(0)
  })

  it('returns an empty map for null / non-object schemas', () => {
    expect(buildDecoderMap(null).size).toBe(0)
    expect(buildDecoderMap('schema').size).toBe(0)
  })
})
