/**
 * The connect middleware types are kick's own, so an app on Fastify or h3 needs
 * no `express` — and Express middleware still fits them.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import express from 'express'
import multer from 'multer'
import type { NextFunction, Request, Response } from 'express'
import type {
  AdapterMiddleware,
  ConnectHandler,
  ConnectMiddleware,
  MiddlewareEntry,
  UploadOptions,
  UploadedFile,
} from '@forinda/kickjs'

// Compile-time: checked by `pnpm typecheck` (tsconfig.typetests.json).
const expressTyped = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('x-seen', req.path)
  next()
}
const expressError = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err.message })
}
export const entries: MiddlewareEntry[] = [
  express.json(),
  expressTyped,
  { path: '/api', handler: express.urlencoded({ extended: true }) },
]
export const connect: ConnectMiddleware[] = [expressTyped, expressError, express.Router()]
export const handler: ConnectHandler = (req, res, next) => {
  // Node's members are there; the ones Express adds are optional.
  res.setHeader('x-method', req.method)
  const body: unknown = req.body
  void body
  next()
}
export const adapterMw: AdapterMiddleware = { handler: expressTyped, phase: 'beforeRoutes' }
// multer's own storage engines and files fit the upload types.
export const storage: UploadOptions[] = [
  { storage: multer.diskStorage({ destination: '/tmp' }) },
  { storage: multer.memoryStorage() },
]
export const fromMulter = (file: Express.Multer.File): UploadedFile => file

const dist = join(import.meta.dirname, '..', 'dist')

describe('published typings', () => {
  // CI builds before testing; an unbuilt checkout has nothing to look at.
  it.skipIf(!existsSync(dist))(
    "don't need express or multer outside @forinda/kickjs/express",
    () => {
      const offenders: string[] = []
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) walk(path)
          else if (
            path.endsWith('.d.mts') &&
            // An import, or a global namespace @types/express / @types/multer declares.
            /from "(express|multer)"|\bExpress\.[A-Z]/.test(readFileSync(path, 'utf8'))
          ) {
            offenders.push(path.slice(dist.length + 1))
          }
        }
      }
      walk(dist)
      expect(offenders).toEqual(['http/runtimes/express.d.mts'])
    },
  )

  it.skipIf(!existsSync(dist))(
    "the root entry doesn't load express — only a dynamic import() reaches it",
    () => {
      // Follow static imports from dist/index.mjs; dynamic ones are left out.
      const seen = new Set<string>()
      const loadsExpress: string[] = []
      const visit = (file: string) => {
        if (seen.has(file)) return
        seen.add(file)
        const code = readFileSync(file, 'utf8')
        if (/from\s*"express"|import\s*"express"/.test(code)) loadsExpress.push(file)
        for (const m of code.matchAll(/(?:from|import)\s*"(\.[^"]+)"/g)) {
          visit(join(file, '..', m[1]!))
        }
      }
      visit(join(dist, 'index.mjs'))
      expect(seen.size).toBeGreaterThan(5)
      expect(loadsExpress).toEqual([])
    },
  )
})
