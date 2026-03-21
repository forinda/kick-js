import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import {
  NotificationService,
  ConsoleChannel,
  WebhookChannel,
  SlackChannel,
  DiscordChannel,
  EmailChannel,
  type NotificationChannel,
  type Notification,
} from '@forinda/kickjs-notifications'

describe('NotificationService', () => {
  it('sends through all default channels', async () => {
    const ch1: NotificationChannel = { name: 'ch1', send: vi.fn() }
    const ch2: NotificationChannel = { name: 'ch2', send: vi.fn() }

    const service = new NotificationService({ channels: [ch1, ch2] })
    const results = await service.send({
      to: 'user@test.com',
      subject: 'Test',
      message: 'Hello',
    })

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.success)).toBe(true)
    expect(ch1.send).toHaveBeenCalledTimes(1)
    expect(ch2.send).toHaveBeenCalledTimes(1)
  })

  it('sends through specified channels only', async () => {
    const ch1: NotificationChannel = { name: 'slack', send: vi.fn() }
    const ch2: NotificationChannel = { name: 'email', send: vi.fn() }

    const service = new NotificationService({ channels: [ch1, ch2] })
    await service.send({
      to: '#ops',
      subject: 'Alert',
      message: 'Server down',
      channels: ['slack'],
    })

    expect(ch1.send).toHaveBeenCalledTimes(1)
    expect(ch2.send).not.toHaveBeenCalled()
  })

  it('handles channel errors gracefully', async () => {
    const failing: NotificationChannel = {
      name: 'broken',
      send: vi.fn().mockRejectedValue(new Error('Network error')),
    }

    const service = new NotificationService({ channels: [failing] })
    const results = await service.send({
      to: 'user',
      subject: 'Test',
      message: 'Hi',
    })

    expect(results[0].success).toBe(false)
    expect(results[0].error).toBe('Network error')
  })

  it('reports missing channels', async () => {
    const service = new NotificationService({ channels: [] })
    const results = await service.send({
      to: 'user',
      subject: 'Test',
      message: 'Hi',
      channels: ['nonexistent'],
    })

    expect(results[0].success).toBe(false)
    expect(results[0].error).toBe('Channel not found')
  })

  it('sendTo sends to a specific channel', async () => {
    const ch: NotificationChannel = { name: 'slack', send: vi.fn() }
    const service = new NotificationService({ channels: [ch] })

    const result = await service.sendTo('slack', {
      to: '#general',
      subject: 'Hi',
      message: 'Hello',
    })

    expect(result.success).toBe(true)
    expect(ch.send).toHaveBeenCalledTimes(1)
  })

  it('getChannelNames returns all registered channels', () => {
    const service = new NotificationService({
      channels: [
        { name: 'email', send: vi.fn() },
        { name: 'slack', send: vi.fn() },
      ],
    })
    expect(service.getChannelNames()).toEqual(['email', 'slack'])
  })

  it('addChannel adds at runtime', async () => {
    const service = new NotificationService({ channels: [] })
    const ch: NotificationChannel = { name: 'sms', send: vi.fn() }

    service.addChannel(ch)

    const results = await service.send({
      to: '+1234',
      subject: 'Code',
      message: '123456',
      channels: ['sms'],
    })
    expect(results[0].success).toBe(true)
  })

  it('uses defaultChannels when specified', async () => {
    const ch1: NotificationChannel = { name: 'slack', send: vi.fn() }
    const ch2: NotificationChannel = { name: 'email', send: vi.fn() }

    const service = new NotificationService({
      channels: [ch1, ch2],
      defaultChannels: ['slack'],
    })

    await service.send({ to: 'user', subject: 'Test', message: 'Hi' })

    expect(ch1.send).toHaveBeenCalledTimes(1)
    expect(ch2.send).not.toHaveBeenCalled()
  })
})

describe('ConsoleChannel', () => {
  it('does not throw', async () => {
    const channel = new ConsoleChannel()
    expect(channel.name).toBe('console')
    await expect(
      channel.send({ to: 'user', subject: 'Test', message: 'Hello' }),
    ).resolves.not.toThrow()
  })
})

describe('WebhookChannel', () => {
  it('POSTs notification to URL', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as any

    const channel = new WebhookChannel({ url: 'https://hooks.example.com/notify' })
    await channel.send({ to: 'ops', subject: 'Alert', message: 'Server down' })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.example.com/notify',
      expect.objectContaining({ method: 'POST' }),
    )

    globalThis.fetch = originalFetch
  })

  it('uses custom transform', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as any

    const channel = new WebhookChannel({
      url: 'https://hooks.example.com',
      transform: (n) => ({ text: n.message }),
    })
    await channel.send({ to: 'ops', subject: 'Alert', message: 'Down' })

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
    expect(body).toEqual({ text: 'Down' })

    globalThis.fetch = originalFetch
  })

  it('throws on failed webhook', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Error' }) as any

    const channel = new WebhookChannel({ url: 'https://hooks.example.com' })
    await expect(
      channel.send({ to: 'ops', subject: 'Test', message: 'Hi' }),
    ).rejects.toThrow('Webhook failed')

    globalThis.fetch = originalFetch
  })
})

describe('SlackChannel', () => {
  it('formats as Slack message', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as any

    const channel = new SlackChannel({ url: 'https://hooks.slack.com/xxx' })
    expect(channel.name).toBe('slack')

    await channel.send({ to: '#ops', subject: 'Alert', message: 'Server down' })
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
    expect(body.text).toContain('*Alert*')
    expect(body.text).toContain('Server down')

    globalThis.fetch = originalFetch
  })
})

describe('EmailChannel', () => {
  it('sends through mailer', async () => {
    const mailer = { send: vi.fn() }
    const channel = new EmailChannel({ mailer, defaultFrom: 'noreply@app.com' })
    expect(channel.name).toBe('email')

    await channel.send({
      to: 'user@test.com',
      subject: 'Welcome',
      message: 'Hello',
      html: '<h1>Hello</h1>',
    })

    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@app.com',
        to: ['user@test.com'],
        subject: 'Welcome',
        text: 'Hello',
        html: '<h1>Hello</h1>',
      }),
    )
  })
})
