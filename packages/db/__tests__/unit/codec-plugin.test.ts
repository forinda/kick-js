import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ColumnNode,
  ColumnUpdateNode,
  IdentifierNode,
  InsertQueryNode,
  PrimitiveValueListNode,
  TableNode,
  UpdateQueryNode,
  ValueListNode,
  ValueNode,
  ValuesNode,
  type OperationNode,
  type PluginTransformResultArgs,
  type QueryResult,
  type UnknownRow,
} from 'kysely'

import {
  CodecPlugin,
  buildDecoderMap,
  buildEncoderMap,
  type CodecMap,
} from '../../src/client/codec-plugin'
import { customType, table, serial, varchar } from '../../src/index'

type Encrypted = string & { readonly __brand: 'Encrypted' }

const fakeArgs = (rows: UnknownRow[]): PluginTransformResultArgs => ({
  result: { rows } as QueryResult<UnknownRow>,
  queryId: { queryId: 'test' } as never,
})

const transformQuery = (plugin: CodecPlugin, node: OperationNode) =>
  plugin.transformQuery({
    node: node as never,
    queryId: { queryId: 'test' } as never,
  })

const insert = (
  table: string,
  columns: string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): InsertQueryNode => ({
  kind: 'InsertQueryNode',
  into: TableNode.create(table),
  columns: columns.map((c) => ColumnNode.create(c)),
  values: ValuesNode.create(
    rows.map((row) => ValueListNode.create(row.map((v) => ValueNode.create(v)))),
  ),
})

const insertPrimitive = (
  table: string,
  columns: string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): InsertQueryNode => ({
  kind: 'InsertQueryNode',
  into: TableNode.create(table),
  columns: columns.map((c) => ColumnNode.create(c)),
  values: ValuesNode.create(rows.map((row) => PrimitiveValueListNode.create(row))),
})

const update = (
  tableName: string,
  pairs: ReadonlyArray<readonly [string, unknown]>,
): UpdateQueryNode => ({
  kind: 'UpdateQueryNode',
  table: TableNode.create(tableName),
  updates: pairs.map(([col, value]) =>
    ColumnUpdateNode.create(ColumnNode.create(col), ValueNode.create(value)),
  ),
})

describe('CodecPlugin transformResult (decoders)', () => {
  it('applies fromDriver to matching column on every row', async () => {
    const decoders: CodecMap = new Map([['secret', (v) => `dec:${String(v)}`]])
    const plugin = new CodecPlugin(new Map(), decoders)
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

  it('passes null + undefined through untouched', async () => {
    const decoders: CodecMap = new Map([['secret', (v) => `dec:${String(v)}`]])
    const plugin = new CodecPlugin(new Map(), decoders)
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

  it('returns the original result reference when decoders map is empty', async () => {
    const plugin = new CodecPlugin(new Map(), new Map())
    const args = fakeArgs([{ id: 1 }])
    const result = await plugin.transformResult(args)
    expect(result).toBe(args.result)
  })

  it('leaves unknown columns untouched', async () => {
    const decoders: CodecMap = new Map([['secret', (v) => `dec:${String(v)}`]])
    const plugin = new CodecPlugin(new Map(), decoders)
    const result = await plugin.transformResult(fakeArgs([{ id: 1, name: 'alice', secret: 'x' }]))
    expect(result.rows[0]).toEqual({ id: 1, name: 'alice', secret: 'dec:x' })
  })
})

describe('CodecPlugin transformQuery (encoders)', () => {
  const encoders: CodecMap = new Map([['secret', (v) => `enc:${String(v)}`]])

  it('encodes ValueNode payloads on a single-row insert', () => {
    const plugin = new CodecPlugin(encoders, new Map())
    const node = insert('secrets', ['id', 'secret'], [[1, 'hello']])
    const out = transformQuery(plugin, node) as InsertQueryNode
    const valuesNode = out.values as ValuesNode
    const item = valuesNode.values[0] as ValueListNode
    expect((item.values[0] as ValueNode).value).toBe(1)
    expect((item.values[1] as ValueNode).value).toBe('enc:hello')
  })

  it('encodes ValueNode payloads across multi-row insert', () => {
    const plugin = new CodecPlugin(encoders, new Map())
    const node = insert(
      'secrets',
      ['id', 'secret'],
      [
        [1, 'a'],
        [2, 'b'],
      ],
    )
    const out = transformQuery(plugin, node) as InsertQueryNode
    const items = (out.values as ValuesNode).values as ValueListNode[]
    expect((items[0].values[1] as ValueNode).value).toBe('enc:a')
    expect((items[1].values[1] as ValueNode).value).toBe('enc:b')
  })

  it('encodes PrimitiveValueListNode rows (Kysely fast path for primitives)', () => {
    const plugin = new CodecPlugin(encoders, new Map())
    const node = insertPrimitive('secrets', ['id', 'secret'], [[1, 'hello']])
    const out = transformQuery(plugin, node) as InsertQueryNode
    const item = (out.values as ValuesNode).values[0] as PrimitiveValueListNode
    expect(item.values).toEqual([1, 'enc:hello'])
  })

  it('passes null + undefined values through untouched on insert', () => {
    const plugin = new CodecPlugin(encoders, new Map())
    const node = insert(
      'secrets',
      ['id', 'secret'],
      [
        [1, null],
        [2, undefined],
      ],
    )
    const out = transformQuery(plugin, node) as InsertQueryNode
    const items = (out.values as ValuesNode).values as ValueListNode[]
    expect((items[0].values[1] as ValueNode).value).toBeNull()
    expect((items[1].values[1] as ValueNode).value).toBeUndefined()
  })

  it('encodes ValueNode targeted by ColumnUpdateNode on UPDATE', () => {
    const plugin = new CodecPlugin(encoders, new Map())
    const node = update('secrets', [
      ['id', 7],
      ['secret', 'world'],
    ])
    const out = transformQuery(plugin, node) as UpdateQueryNode
    const updates = out.updates as ReadonlyArray<ColumnUpdateNode>
    expect((updates[0].value as ValueNode).value).toBe(7)
    expect((updates[1].value as ValueNode).value).toBe('enc:world')
  })

  it('returns the same node reference when no column matches an encoder', () => {
    const plugin = new CodecPlugin(encoders, new Map())
    const node = insert('secrets', ['id', 'name'], [[1, 'alice']])
    expect(transformQuery(plugin, node)).toBe(node)
  })

  it('returns the same node reference when no encoded value actually changed', () => {
    // Encoder is identity for the bound column — node tree should be
    // shared, no allocation cost on the hot path.
    const identity: CodecMap = new Map([['secret', (v) => v]])
    const plugin = new CodecPlugin(identity, new Map())
    const node = insert('secrets', ['id', 'secret'], [[1, 'hello']])
    expect(transformQuery(plugin, node)).toBe(node)
  })

  it('skips insert-from-select (values is not a ValuesNode)', () => {
    const plugin = new CodecPlugin(encoders, new Map())
    const fakeSelect: OperationNode = {
      kind: 'SelectQueryNode',
    } as never
    const node: InsertQueryNode = {
      kind: 'InsertQueryNode',
      into: TableNode.create('secrets'),
      columns: [ColumnNode.create('id'), ColumnNode.create('secret')],
      values: fakeSelect,
    }
    expect(transformQuery(plugin, node)).toBe(node)
  })

  it('returns the original node when encoders map is empty (zero overhead)', () => {
    const plugin = new CodecPlugin(new Map(), new Map())
    const node = insert('secrets', ['id', 'secret'], [[1, 'hello']])
    expect(transformQuery(plugin, node)).toBe(node)
  })

  it('passes through update set values that are not ValueNodes (e.g. references)', () => {
    const plugin = new CodecPlugin(encoders, new Map())
    const ref: OperationNode = {
      kind: 'ReferenceNode',
      column: ColumnNode.create('other'),
    } as never
    const node: UpdateQueryNode = {
      kind: 'UpdateQueryNode',
      table: TableNode.create('secrets'),
      updates: [ColumnUpdateNode.create(ColumnNode.create('secret'), ref)],
    }
    const out = transformQuery(plugin, node) as UpdateQueryNode
    expect(out).toBe(node)
  })

  it('does not touch SELECT, DELETE, or other root nodes', () => {
    const plugin = new CodecPlugin(encoders, new Map())
    const select: OperationNode = {
      kind: 'SelectQueryNode',
      from: { kind: 'FromNode', froms: [TableNode.create('secrets')] },
    } as never
    expect(transformQuery(plugin, select)).toBe(select)
  })

  it('IdentifierNode reference holds the column name as a plain string', () => {
    // Defends the lookup path: ColumnNode → IdentifierNode → name. If
    // Kysely changes shape, this breaks loud at the seam rather than
    // silently producing unencoded values.
    const idNode = ColumnNode.create('secret')
    expect(IdentifierNode.is(idNode.column)).toBe(true)
    expect(idNode.column.name).toBe('secret')
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
      hint: encrypted(),
    })
    const map = buildDecoderMap({ users })

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

describe('codec column-name collision detection', () => {
  it('warns and keeps the first when two tables map the same column to different codecs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const codecA = customType<string>({
      dataType: () => 'text',
      fromDriver: (r) => `a:${String(r)}`,
    })
    const codecB = customType<string>({
      dataType: () => 'text',
      fromDriver: (r) => `b:${String(r)}`,
    })
    const users = table('users', { id: serial().primaryKey(), token: codecA().notNull() })
    const orders = table('orders', { id: serial().primaryKey(), token: codecB().notNull() })

    const map = buildDecoderMap({ users, orders })

    expect(map.size).toBe(1)
    // First table wins — deterministic regardless of how the row arrives.
    expect(map.get('token')!('x')).toBe('a:x')
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = warn.mock.calls[0][0] as string
    expect(msg).toContain("column 'token'")
    expect(msg).toContain('users')
    expect(msg).toContain('orders')
  })

  it('does NOT warn when the SAME customType is shared across tables', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const shared = customType<string>({ dataType: () => 'text', fromDriver: (r) => String(r) })
    const a = table('a', { id: serial().primaryKey(), meta: shared().notNull() })
    const b = table('b', { id: serial().primaryKey(), meta: shared().notNull() })

    const map = buildDecoderMap({ a, b })

    expect(map.size).toBe(1) // one codec, shared — fine
    expect(warn).not.toHaveBeenCalled()
  })

  afterEach(() => vi.restoreAllMocks())
})

describe('buildEncoderMap()', () => {
  it('collects toDriver codecs from CustomColumnBuilder columns', () => {
    const encrypted = customType<Encrypted>({
      dataType: () => 'text',
      toDriver: (s) => `enc:${s}`,
    })
    const t = table('secrets', {
      id: serial().primaryKey(),
      value: encrypted().notNull(),
    })
    const map = buildEncoderMap({ t })

    expect(map.size).toBe(1)
    expect(map.has('value')).toBe(true)
    expect(map.get('value')?.('hello')).toBe('enc:hello')
  })

  it('skips CustomColumnBuilder columns with no toDriver set (decode-only codecs)', () => {
    const decodeOnly = customType<string>({
      dataType: () => 'text',
      fromDriver: (raw) => String(raw),
    })
    const t = table('t', {
      id: serial().primaryKey(),
      val: decodeOnly().notNull(),
    })
    expect(buildEncoderMap({ t }).size).toBe(0)
  })

  it('returns an empty map for null / non-object schemas', () => {
    expect(buildEncoderMap(null).size).toBe(0)
    expect(buildEncoderMap(undefined).size).toBe(0)
  })
})
