/**
 * "Open handler in editor": find a controller method in the project's source
 * from the class and method names the running app knows.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findHandlerLine, locateHandler } from '../src/source-locator'

const source = `import { Controller, Get } from '@forinda/kickjs'

export class Other {
  list() {}
}

@Controller()
export class UsersController {
  // list() in a comment is not the method
  @Get('/')
  async list(ctx) {}

  @Get('/:id')
  private get<T>(ctx) {}
}
`

describe('findHandlerLine', () => {
  it('finds the method inside the named class, not a same-named one before it', () => {
    expect(findHandlerLine(source, 'UsersController', 'list')).toBe(11)
    expect(findHandlerLine(source, 'UsersController', 'get')).toBe(14)
    expect(findHandlerLine(source, 'Other', 'list')).toBe(4)
  })

  it('falls back to the class line, and misses a class that is not declared', () => {
    expect(findHandlerLine(source, 'UsersController', 'missing')).toBe(8)
    expect(findHandlerLine(source, 'Users', 'list')).toBeUndefined()
  })

  it('does not pick a same-named method from a later class', () => {
    // `Other` has no `get`; UsersController (declared after it) does.
    expect(findHandlerLine(source, 'Other', 'get')).toBe(3)
  })
})

describe('locateHandler', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('searches src/, skipping declaration files and node_modules', () => {
    root = mkdtempSync(join(tmpdir(), 'kick-src-'))
    mkdirSync(join(root, 'src/modules/users'), { recursive: true })
    mkdirSync(join(root, 'src/node_modules/x'), { recursive: true })
    writeFileSync(join(root, 'src/types.d.ts'), 'declare class UsersController { list(): void }')
    writeFileSync(join(root, 'src/node_modules/x/index.ts'), source)
    writeFileSync(join(root, 'src/modules/users/users.controller.ts'), source)

    expect(locateHandler(root, 'UsersController', 'get')).toEqual({
      file: join(root, 'src/modules/users/users.controller.ts'),
      relative: 'src/modules/users/users.controller.ts',
      line: 14,
    })
    expect(locateHandler(root, 'NopeController', 'get')).toBeUndefined()
  })
})
