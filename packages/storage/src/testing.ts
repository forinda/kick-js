/**
 * The behaviour every {@link Storage} driver shares, as a Vitest suite — the
 * same one the built-in drivers run. Point it at your own driver:
 *
 * ```ts
 * import { storageContract } from '@forinda/kickjs-storage/testing'
 *
 * storageContract('cloudinaryStorage', async () =>
 *   cloudinaryStorage({ folder: `test-${crypto.randomUUID()}` }),
 * )
 * ```
 *
 * `make` is called once per test: return an empty storage each time (a fresh
 * folder or prefix on a real service). Leave out what the backend can't do
 * with `skip`, and have the driver throw for it instead of weakening it.
 *
 * @module @forinda/kickjs-storage/testing
 */
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { Storage } from './types'

/** Groups of checks a driver can leave out, when its backend can't do them. */
export type StorageCapability = 'putIfAbsent' | 'range' | 'list' | 'delimiter' | 'url' | 'keys'

export interface StorageContractOptions {
  /** Checks to leave out. */
  skip?: readonly StorageCapability[]
  /**
   * The `baseUrl` the driver was made with, for drivers that build URLs from
   * one (disk, memory): `url()` is checked against it exactly. Without it,
   * `url()` only has to return an absolute URL.
   */
  baseUrl?: string
}

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : bytes)

/** Register the shared storage checks as a `describe` block named `name`. */
export function storageContract(
  name: string,
  make: () => Promise<Storage> | Storage,
  options: StorageContractOptions = {},
): void {
  const skip = new Set(options.skip)
  const can = (capability: StorageCapability) => (skip.has(capability) ? it.skip : it)

  describe(name, () => {
    it('puts, gets, replaces and deletes', async () => {
      const files = await make()
      expect(await files.get('a/b.txt')).toBeNull()
      expect(await files.exists('a/b.txt')).toBe(false)
      await files.put('a/b.txt', 'one')
      await files.put('a/b.txt', new TextEncoder().encode('two'))
      expect(text(await files.get('a/b.txt'))).toBe('two')
      expect(await files.exists('a/b.txt')).toBe(true)
      expect(await files.exists('a')).toBe(false)
      await files.delete('a/b.txt')
      await files.delete('a/b.txt')
      expect(await files.get('a/b.txt')).toBeNull()
    })

    it('stats and streams a file', async () => {
      const files = await make()
      await files.put('s/x.txt', 'hello', { contentType: 'text/plain' })
      expect(await files.stat('s/x.txt')).toMatchObject({ key: 's/x.txt', size: 5 })
      expect((await files.stat('s/x.txt'))!.lastModified).toBeInstanceOf(Date)
      expect(await files.stat('s')).toBeNull()
      expect(await new Response(await files.getStream('s/x.txt')).text()).toBe('hello')
      expect(await files.getStream('nope')).toBeNull()
    })

    can('range')('streams a byte range', async () => {
      const files = await make()
      await files.put('r.txt', '0123456789')
      const read = async (range: { start?: number; end?: number }) =>
        new Response(await files.getStream('r.txt', range)).text()
      expect(await read({ start: 2, end: 4 })).toBe('234')
      expect(await read({ start: 7 })).toBe('789')
      expect(await read({ end: 1 })).toBe('01')
      expect(await read({ start: 8, end: 99 })).toBe('89')
      expect(await read({ start: 10 })).toBe('')
      expect(await files.getStream('nope', { start: 1 })).toBeNull()
      await expect(files.getStream('r.txt', { start: 5, end: 4 })).rejects.toThrow('invalid range')
      await expect(files.getStream('r.txt', { start: -1 })).rejects.toThrow('invalid range')
    })

    it('writes a stream as it arrives', async () => {
      const files = await make()
      const body = Readable.from([new TextEncoder().encode('ab'), new TextEncoder().encode('cd')])
      await files.put('streamed.txt', body)
      expect(text(await files.get('streamed.txt'))).toBe('abcd')
      await files.put('web.txt', new Blob(['ef']).stream())
      expect(text(await files.get('web.txt'))).toBe('ef')
    })

    can('list')('lists by prefix in key order, a page at a time', async () => {
      const files = await make()
      for (const key of ['p/b.txt', 'p/a.txt', 'p/sub/c.txt', 'q.txt']) await files.put(key, key)
      const first = await files.list({ prefix: 'p/', limit: 2 })
      expect(first.files.map((f) => f.key)).toEqual(['p/a.txt', 'p/b.txt'])
      expect(first.files[0].size).toBe(7)
      const second = await files.list({ prefix: 'p/', limit: 2, cursor: first.cursor })
      expect(second.files.map((f) => f.key)).toEqual(['p/sub/c.txt'])
      expect(second.cursor).toBeUndefined()
      expect((await files.list()).files).toHaveLength(4)
      await expect(files.list({ limit: 0 })).rejects.toThrow('limit')
    })

    can('putIfAbsent')(
      'putIfAbsent stores once, and only one of several racing callers wins',
      async () => {
        const files = await make()
        expect(await files.putIfAbsent('m/once', 'first')).toBe(true)
        expect(await files.putIfAbsent('m/once', 'second')).toBe(false)
        expect(text(await files.get('m/once'))).toBe('first')
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) => files.putIfAbsent('m/race', `caller ${i}`)),
        )
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(text(await files.get('m/race'))).toBe(`caller ${results.indexOf(true)}`)
        expect(
          await files.putIfAbsent('m/stream', Readable.from([new TextEncoder().encode('s1')])),
        ).toBe(true)
        expect(
          await files.putIfAbsent('m/stream', Readable.from([new TextEncoder().encode('s2')])),
        ).toBe(false)
        expect(text(await files.get('m/stream'))).toBe('s1')
      },
    )

    can('list')('lists in the same order as plain string sorting, across folders', async () => {
      const files = await make()
      const keys = ['a', 'a-b', 'a0', 'a/b', 'a/b/c', 'a/b-c', 'a/b0', 'b', 'Z', 'a/A', '_x']
      // On disk `a` can't be both a file and a folder: use the ones that can coexist there.
      const usable = keys.filter((k) => k !== 'a' && k !== 'a/b')
      for (const key of usable) await files.put(key, key)
      const all: string[] = []
      let cursor: string | undefined
      do {
        const page = await files.list({ limit: 2, cursor })
        all.push(...page.files.map((f) => f.key))
        cursor = page.cursor
      } while (cursor)
      expect(all).toEqual(usable.toSorted())
      expect((await files.list({ prefix: 'a/b' })).files.map((f) => f.key)).toEqual([
        'a/b-c',
        'a/b/c',
        'a/b0',
      ])
      expect((await files.list({ prefix: 'a/b/' })).files.map((f) => f.key)).toEqual(['a/b/c'])
      expect((await files.list({ cursor: 'a/b-c', limit: 1 })).files.map((f) => f.key)).toEqual([
        'a/b/c',
      ])
    })

    can('delimiter')(
      'groups keys into prefixes with a delimiter, paging both together',
      async () => {
        const files = await make()
        for (const key of ['a/1', 'a/b/c', 'a/b/d', 'a/e/f', 'a/z', 'b/x', 'top'])
          await files.put(key, key)
        const root = await files.list({ delimiter: '/' })
        expect(root.files.map((f) => f.key)).toEqual(['top'])
        expect(root.prefixes).toEqual(['a/', 'b/'])

        const first = await files.list({ prefix: 'a/', delimiter: '/', limit: 2 })
        expect([first.files.map((f) => f.key), first.prefixes, first.cursor]).toEqual([
          ['a/1'],
          ['a/b/'],
          'a/b/',
        ])
        const second = await files.list({
          prefix: 'a/',
          delimiter: '/',
          limit: 2,
          cursor: first.cursor,
        })
        expect([second.files.map((f) => f.key), second.prefixes, second.cursor]).toEqual([
          ['a/z'],
          ['a/e/'],
          undefined,
        ])
        // Without a delimiter, nothing changes.
        expect((await files.list({ prefix: 'a/' })).prefixes).toBeUndefined()
        await expect(files.list({ delimiter: '' })).rejects.toThrow('delimiter')
      },
    )

    can('url')('gives a URL for a key, encoding each segment', async () => {
      const files = await make()
      await files.put('my docs/r&d (1).pdf', 'pdf')
      const url = await files.url('my docs/r&d (1).pdf')
      if (options.baseUrl !== undefined) {
        expect(url).toBe(`${options.baseUrl.replace(/\/$/, '')}/my%20docs/r%26d%20%281%29.pdf`)
      } else {
        expect(() => new URL(url)).not.toThrow()
      }
    })

    can('keys')('refuses keys that could escape or alias', async () => {
      const files = await make()
      const calls: ((key: string) => Promise<unknown>)[] = [
        (key) => files.put(key, 'x'),
        (key) => files.get(key),
        (key) => files.getStream(key),
        (key) => files.stat(key),
        (key) => files.exists(key),
        (key) => files.delete(key),
      ]
      if (!skip.has('putIfAbsent')) calls.push((key) => files.putIfAbsent(key, 'x'))
      if (!skip.has('url')) calls.push((key) => files.url(key))
      for (const key of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', 'a/./b', 'a\\b', 'a/']) {
        for (const call of calls) await expect(call(key)).rejects.toThrow('invalid key')
      }
    })
  })
}
