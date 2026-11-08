import { createHash, randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { md5 } from '../src/md5'

it('matches node:crypto across lengths around every padding boundary', () => {
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
  expect(hex(md5(new Uint8Array()))).toBe('d41d8cd98f00b204e9800998ecf8427e')
  expect(hex(md5(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')))).toBe(
    '9e107d9d372bb6826bd81d3542a419d6',
  )
  for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70_000]) {
    const data = new Uint8Array(randomBytes(length))
    expect(hex(md5(data))).toBe(createHash('md5').update(data).digest('hex'))
  }
})
