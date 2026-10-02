import { describe, expect, it } from 'vitest'
import { contentDisposition } from '../src/http/context'

describe('ctx.download Content-Disposition', () => {
  it('keeps a plain name readable', () => {
    expect(contentDisposition('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    )
  })

  it('cannot be broken by quotes or line breaks from an uploaded name', () => {
    const header = contentDisposition('a"b\r\nSet-Cookie: x=1.txt')
    expect(header).not.toMatch(/[\r\n]/)
    expect(header).toBe(
      `attachment; filename="a_b__Set-Cookie: x=1.txt"; filename*=UTF-8''a%22b%0D%0ASet-Cookie%3A%20x%3D1.txt`,
    )
  })

  it('carries a non-Latin name in filename*', () => {
    expect(contentDisposition('résumé.pdf')).toBe(
      `attachment; filename="r_sum_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`,
    )
  })
})
