import { describe, expect, it } from 'vitest'
import { remoteHost } from '../src/cli/push-target'

describe('remoteHost — what kick db push asks about', () => {
  it.each([
    ['postgres://u:p@db.example.com:5432/app', 'db.example.com'],
    ['postgres://u:p@10.2.3.4/app', '10.2.3.4'],
    ['mysql://root@prod-mysql.internal.corp/app', 'prod-mysql.internal.corp'],
    // Postgres connects to ?host= over the URL's own host.
    ['postgres://u:p@localhost/app?host=db.example.com', 'db.example.com'],
    // A libpq host list: any remote entry counts.
    ['postgres://u:p@localhost:5432,db.example.com:5433/app', 'db.example.com'],
  ])('treats %s as remote', (url, host) => {
    expect(remoteHost(url)).toBe(host)
  })

  it.each([
    'postgres://u:p@localhost:5432/app',
    'postgres://u:p@127.0.0.1/app',
    'postgres://u:p@[::1]:5432/app',
    'postgres://u:p@db:5432/app', // a compose service
    'postgres://u:p@pg.localhost/app',
    'postgres://u:p@my-mac.local/app',
    'postgres://u:p@db.example.com/app?host=/var/run/postgresql', // a Unix socket wins
    'postgres://u:p@localhost:5432,db:5433/app',
    'file:./data/app.db',
    'host=db.example.com dbname=app', // not a URL: push can't tell
    undefined, // a db.adapter() factory
  ])('treats %s as local or unknown', (url) => {
    expect(remoteHost(url)).toBeUndefined()
  })
})

describe('kick db push against a remote database', () => {
  it('refuses without --yes when it cannot ask (no terminal)', async () => {
    const { Command } = await import('commander')
    const { registerDbCommands, resolveKickDbConfig } = await import('../src/cli')
    const program = new Command().exitOverride()
    const db = program.command('db')
    registerDbCommands(db, async () =>
      resolveKickDbConfig({
        connectionString: 'postgres://u:p@db.example.com:5432/app',
        schemaPath: 'does-not-exist.ts',
      }),
    )
    await expect(program.parseAsync(['node', 'kick', 'db', 'push'])).rejects.toThrow(
      /refusing to push to db\.example\.com/,
    )
  })
})
