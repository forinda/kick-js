import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkKey, memoryStorage } from '../src/index'
import { diskStorage } from '../src/disk'
import { storageContract } from '../src/testing'

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : bytes)

storageContract('memoryStorage', () => memoryStorage({ baseUrl: 'https://cdn.test/' }), {
  baseUrl: 'https://cdn.test/',
})
storageContract(
  'diskStorage',
  async () =>
    diskStorage({
      root: await mkdtemp(join(tmpdir(), 'kick-storage-')),
      baseUrl: 'https://cdn.test/',
    }),
  { baseUrl: 'https://cdn.test/' },
)

describe('diskStorage', () => {
  it('never follows a symbolic link out of the root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'kick-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    const root = await mkdtemp(join(tmpdir(), 'kick-storage-'))
    await symlink(outside, join(root, 'link'))
    await symlink(join(outside, 'secret.txt'), join(root, 'file-link'))
    const files = diskStorage({ root })

    // Reads see a link as missing — a 404, not a 500.
    expect(await files.get('link/secret.txt')).toBeNull()
    expect(await files.stat('link/secret.txt')).toBeNull()
    expect(await files.getStream('link/secret.txt')).toBeNull()
    await expect(files.put('link/secret.txt', 'pwned')).rejects.toThrow('symbolic link')
    await expect(files.put('link/new/deep.txt', 'x')).rejects.toThrow('symbolic link')
    await expect(files.delete('link/secret.txt')).rejects.toThrow('symbolic link')
    expect(await files.get('file-link')).toBeNull()
    expect(await files.exists('file-link')).toBe(false)
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

  it('lists an empty folder as nothing, not as a prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kick-storage-'))
    const files = diskStorage({ root })
    await files.put('full/x', 'x')
    await mkdir(join(root, 'empty'))
    expect((await files.list({ delimiter: '/' })).prefixes).toEqual(['full/'])
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
