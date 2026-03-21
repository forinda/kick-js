import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import { MailerService, type MailProvider, type MailResult, type MailTemplateEngine } from '@forinda/kickjs-mailer'

function mockProvider(overrides?: Partial<MailProvider>): MailProvider {
  return {
    name: 'mock',
    send: vi.fn(async () => ({ messageId: 'msg-123', accepted: true })),
    ...overrides,
  }
}

describe('MailerService', () => {
  it('sends a message through the provider', async () => {
    const provider = mockProvider()
    const mailer = new MailerService({ provider })

    const result = await mailer.send({
      to: 'alice@test.com',
      subject: 'Hello',
      text: 'Hi Alice',
    })

    expect(result.messageId).toBe('msg-123')
    expect(result.accepted).toBe(true)
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@test.com',
        subject: 'Hello',
        text: 'Hi Alice',
      }),
    )
  })

  it('applies defaultFrom when message has no from', async () => {
    const provider = mockProvider()
    const mailer = new MailerService({
      provider,
      defaultFrom: { name: 'App', address: 'noreply@app.com' },
    })

    await mailer.send({ to: 'bob@test.com', subject: 'Test' })

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'App', address: 'noreply@app.com' },
      }),
    )
  })

  it('does not override explicit from', async () => {
    const provider = mockProvider()
    const mailer = new MailerService({
      provider,
      defaultFrom: 'default@app.com',
    })

    await mailer.send({
      from: 'custom@app.com',
      to: 'bob@test.com',
      subject: 'Test',
    })

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'custom@app.com' }),
    )
  })

  it('returns dry-run result when disabled', async () => {
    const provider = mockProvider()
    const mailer = new MailerService({ provider, enabled: false })

    const result = await mailer.send({ to: 'alice@test.com', subject: 'Test' })

    expect(result.messageId).toBe('dry-run')
    expect(result.accepted).toBe(true)
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('propagates provider errors', async () => {
    const provider = mockProvider({
      send: vi.fn(async () => {
        throw new Error('SMTP connection refused')
      }),
    })
    const mailer = new MailerService({ provider })

    await expect(mailer.send({ to: 'a@b.com', subject: 'Fail' })).rejects.toThrow(
      'SMTP connection refused',
    )
  })

  it('getProvider() returns the underlying provider', () => {
    const provider = mockProvider()
    const mailer = new MailerService({ provider })
    expect(mailer.getProvider()).toBe(provider)
  })

  it('shutdown() calls provider.shutdown()', async () => {
    const shutdown = vi.fn()
    const provider = mockProvider({ shutdown })
    const mailer = new MailerService({ provider })

    await mailer.shutdown()
    expect(shutdown).toHaveBeenCalled()
  })
})

describe('MailerService.sendTemplate()', () => {
  it('renders template and sends HTML', async () => {
    const provider = mockProvider()
    const engine: MailTemplateEngine = {
      render: vi.fn(async (template, data) => `<h1>Hello ${data.name}</h1>`),
    }
    const mailer = new MailerService({ provider, templateEngine: engine })

    const result = await mailer.sendTemplate(
      'welcome',
      { to: 'alice@test.com', subject: 'Welcome' },
      { name: 'Alice' },
    )

    expect(engine.render).toHaveBeenCalledWith('welcome', { name: 'Alice' })
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<h1>Hello Alice</h1>',
        subject: 'Welcome',
      }),
    )
    expect(result.accepted).toBe(true)
  })

  it('throws when no templateEngine configured', async () => {
    const mailer = new MailerService({ provider: mockProvider() })

    await expect(
      mailer.sendTemplate('welcome', { to: 'a@b.com', subject: 'Hi' }, {}),
    ).rejects.toThrow('templateEngine is required')
  })
})
