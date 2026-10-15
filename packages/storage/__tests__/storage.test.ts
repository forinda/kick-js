import { mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { checkKey, memoryStorage, type Storage } from '../src/index'
import { diskStorage } from '../src/disk'

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : bytes)

describe.each([
  ['memoryStorage', async () => memoryStorage({ baseUrl: 'https://cdn.test/' })],
  [
    'diskStorage',
    async () =>
      diskStorage({
        root: await mkdtemp(join(tmpdir(), 'kick-storage-')),
        baseUrl: 'https://cdn.test/',
      }),
  ],
] as const)('%s', (_name, make: () => Promise<Storage>) => {
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

  it('writes a stream as it arrives', async () => {
    const files = await make()
    const body = Readable.from([new TextEncoder().encode('ab'), new TextEncoder().encode('cd')])
    await files.put('streamed.txt', body)
    expect(text(await files.get('streamed.txt'))).toBe('abcd')
    await files.put('web.txt', new Blob(['ef']).stream())
    expect(text(await files.get('web.txt'))).toBe('ef')
  })

  it('lists by prefix in key order, a page at a time', async () => {
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

  it('putIfAbsent stores once, and only one of several racing callers wins', async () => {
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
  })

  it('lists in the same order as plain string sorting, across folders', async () => {
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

  it('builds a URL from baseUrl, encoding each segment', async () => {
    const files = await make()
    expect(await files.url('my docs/r&d (1).pdf')).toBe(
      'https://cdn.test/my%20docs/r%26d%20%281%29.pdf',
    )
  })

  it('refuses keys that could escape or alias', async () => {
    const files = await make()
    for (const key of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', 'a/./b', 'a\\b', 'a/']) {
      await expect(files.put(key, 'x')).rejects.toThrow('invalid key')
    }
  })
})

describe('diskStorage', () => {
  it('never follows a symbolic link out of the root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'kick-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    const root = await mkdtemp(join(tmpdir(), 'kick-storage-'))
    await symlink(outside, join(root, 'link'))
    await symlink(join(outside, 'secret.txt'), join(root, 'file-link'))
    const files = diskStorage({ root })

    await expect(files.get('link/secret.txt')).rejects.toThrow('symbolic link')
    await expect(files.stat('link/secret.txt')).rejects.toThrow('symbolic link')
    await expect(files.put('link/secret.txt', 'pwned')).rejects.toThrow('symbolic link')
    await expect(files.put('link/new/deep.txt', 'x')).rejects.toThrow('symbolic link')
    await expect(files.delete('link/secret.txt')).rejects.toThrow('symbolic link')
    await expect(files.get('file-link')).rejects.toThrow('symbolic link')
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret')
    expect(await readdir(outside)).toEqual(['secret.txt'])
    expect((await files.list()).files).toEqual([])

    // Removing the link removes the link, not the file it points to.
    await files.delete('file-link')
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret')
  })

  it('follows a root that is itself a link', async () => {
    const real = await mkdtemp(join(tmpdir(), 'kick-real-'))
    const link = join(await mkdtemp(join(tmpdir(), 'kick-root-')), 'root')
    await symlink(real, link)
    const files = diskStorage({ root: link })
    await files.put('a/b.txt', 'ok')
    expect(text(await files.get('a/b.txt'))).toBe('ok')
  })

  it('explains a key that clashes with a file or folder', async () => {
    const files = diskStorage({ root: await mkdtemp(join(tmpdir(), 'kick-storage-')) })
    await files.put('a', 'file')
    await expect(files.put('a/b', 'x')).rejects.toThrow("'a/b' clashes")
    expect(await files.get('a/b')).toBeNull()
    await files.put('d/e', 'x')
    await expect(files.put('d', 'x')).rejects.toThrow("'d' clashes")
    expect(await files.get('d')).toBeNull()
  })

  it('lists nothing for a root not created yet', async () => {
    const root = join(await mkdtemp(join(tmpdir(), 'kick-storage-')), 'later')
    expect(await diskStorage({ root }).list()).toEqual({ files: [] })
  })

  it('leaves no temp files behind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kick-storage-'))
    await diskStorage({ root }).put('x.txt', 'x')
    expect(await readdir(root)).toEqual(['x.txt'])
  })

  it('needs a baseUrl for url()', async () => {
    await expect(diskStorage({ root: tmpdir() }).url('x')).rejects.toThrow('baseUrl')
  })
})

describe('memoryStorage', () => {
  it('keeps the content type', async () => {
    const files = memoryStorage()
    await files.put('k', 'x', { contentType: 'text/plain' })
    expect((await files.stat('k'))!.contentType).toBe('text/plain')
  })

  it('keeps its own copy of the bytes', async () => {
    const files = memoryStorage()
    const bytes = new TextEncoder().encode('abc')
    await files.put('k', bytes)
    bytes[0] = 0
    ;(await files.get('k'))![1] = 0
    expect(text(await files.get('k'))).toBe('abc')
  })
})

it('checkKey passes good keys through', () => {
  expect(checkKey('avatars/42.png')).toBe('avatars/42.png')
})
