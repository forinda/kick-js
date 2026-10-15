import { expect, it, vi } from 'vitest'

it('retries loading multer after a failed import, instead of caching the failure', async () => {
  vi.doMock('multer', () => {
    throw new Error('not installed')
  })
  const { upload } = await import('../src/http/middleware/upload')
  const mw = upload.none() as (req: unknown, res: unknown, next: (err?: unknown) => void) => void
  const run = () => new Promise<unknown>((resolve) => mw({ headers: {} }, {}, resolve))

  expect(String(await run())).toMatch(/require the 'multer' package/)

  vi.doUnmock('multer')
  // A request with no multipart body: multer passes straight through.
  expect(await run()).toBeUndefined()
})
