import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkKey, diskStorage, memoryStorage, type Storage } from '../src/index'

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
