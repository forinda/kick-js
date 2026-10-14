import { describe, expect, it } from 'vitest'
import { parseByteSize, parseForm, readBodyText } from '../src/http/body-policy'

describe('parseByteSize', () => {
  it('reads the forms express.json({ limit }) accepts', () => {
    expect(parseByteSize(500)).toBe(500)
    expect(parseByteSize('1kb')).toBe(1024)
    expect(parseByteSize('1.5MB')).toBe(1572864)
    expect(() => parseByteSize('lots')).toThrow(/Invalid body size limit/)
  })
})

describe('readBodyText', () => {
  it('refuses a declared Content-Length over the limit before reading', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      body: 'x'.repeat(20),
      headers: { 'content-length': '20' },
    })
    await expect(readBodyText(req, 10)).rejects.toMatchObject({ status: 413 })
  })

  it('stops a streamed body without a length once it passes the limit', async () => {
    const chunks = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode('xxxx'))
        c.close()
      },
    })
    const req = new Request('http://x/', {
      method: 'POST',
      body: chunks,
      duplex: 'half',
    } as RequestInit)
    await expect(readBodyText(req, 10)).rejects.toMatchObject({ status: 413 })
    const ok = new Request('http://x/', { method: 'POST', body: 'héllo' })
    expect(await readBodyText(ok, 10)).toBe('héllo')
  })
})

describe('parseForm', () => {
  it('turns repeated keys into arrays and cannot set the prototype', () => {
    const form = parseForm('a=1&a=2&a=3&b=x&__proto__=p')
    expect(form.a).toEqual(['1', '2', '3'])
    expect(form.b).toBe('x')
    expect(Object.getPrototypeOf(form)).toBe(Object.prototype)
  })
})
