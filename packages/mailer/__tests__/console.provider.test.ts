import { describe, it, expect } from 'vitest'
import 'reflect-metadata'
import { ConsoleProvider } from '@forinda/kickjs-mailer'

describe('ConsoleProvider', () => {
  it('has name "console"', () => {
    const provider = new ConsoleProvider()
    expect(provider.name).toBe('console')
  })

  it('returns a result with accepted=true', async () => {
    const provider = new ConsoleProvider()
    const result = await provider.send({
      from: 'test@app.com',
      to: 'alice@test.com',
      subject: 'Test Email',
      text: 'Hello from console provider',
    })

    expect(result.accepted).toBe(true)
    expect(result.messageId).toMatch(/^console-\d+$/)
  })

  it('handles array recipients', async () => {
    const provider = new ConsoleProvider()
    const result = await provider.send({
      to: ['alice@test.com', { name: 'Bob', address: 'bob@test.com' }],
      subject: 'Multi-recipient',
      html: '<p>Hello everyone</p>',
    })

    expect(result.accepted).toBe(true)
  })

  it('handles attachments', async () => {
    const provider = new ConsoleProvider()
    const result = await provider.send({
      to: 'alice@test.com',
      subject: 'With Attachment',
      text: 'See attached',
      attachments: [{ filename: 'report.pdf', content: Buffer.from('pdf-data') }],
    })

    expect(result.accepted).toBe(true)
  })

  it('increments message IDs', async () => {
    const provider = new ConsoleProvider()
    const r1 = await provider.send({ to: 'a@b.com', subject: 'First' })
    const r2 = await provider.send({ to: 'a@b.com', subject: 'Second' })

    expect(r1.messageId).not.toBe(r2.messageId)
  })
})
