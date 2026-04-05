import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import { MailerService, type MailProvider, type MailMessage, type MailResult } from '@forinda/kickjs-mailer'

describe('Custom MailProvider', () => {
  it('works with a Resend-style provider', async () => {
    // Simulates how someone would implement a Resend provider
    const resendProvider: MailProvider = {
      name: 'resend',
      send: vi.fn(async (message: MailMessage): Promise<MailResult> => {
        // In real code: const { data } = await resend.emails.send(...)
        return {
          messageId: 'resend-id-abc',
          accepted: true,
          raw: { id: 'resend-id-abc' },
        }
      }),
    }

    const mailer = new MailerService({
      provider: resendProvider,
      defaultFrom: 'noreply@myapp.com',
    })

    const result = await mailer.send({
      to: 'user@example.com',
      subject: 'Welcome to MyApp',
      html: '<h1>Welcome!</h1>',
    })

    expect(result.messageId).toBe('resend-id-abc')
    expect(resendProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@myapp.com',
        to: 'user@example.com',
        subject: 'Welcome to MyApp',
      }),
    )
  })

  it('works with an SES-style provider', async () => {
    const sesProvider: MailProvider = {
      name: 'ses',
      send: vi.fn(async (message: MailMessage): Promise<MailResult> => {
        return {
          messageId: 'ses-msg-id-xyz',
          accepted: true,
          raw: { MessageId: 'ses-msg-id-xyz' },
        }
      }),
      shutdown: vi.fn(),
    }

    const mailer = new MailerService({ provider: sesProvider })

    const result = await mailer.send({
      from: 'notifications@myapp.com',
      to: ['admin@myapp.com', 'ops@myapp.com'],
      subject: 'Alert',
      text: 'Server health degraded',
      metadata: { configurationSet: 'production-alerts' },
    })

    expect(result.accepted).toBe(true)
    expect(sesProvider.send).toHaveBeenCalled()

    await mailer.shutdown()
    expect(sesProvider.shutdown).toHaveBeenCalled()
  })

  it('works with a SendGrid-style provider', async () => {
    const sendgridProvider: MailProvider = {
      name: 'sendgrid',
      send: vi.fn(async (): Promise<MailResult> => ({
        messageId: 'sg-id-123',
        accepted: true,
      })),
    }

    const mailer = new MailerService({ provider: sendgridProvider })

    await mailer.send({
      to: { name: 'Alice', address: 'alice@example.com' },
      subject: 'Newsletter',
      html: '<p>Monthly update</p>',
      headers: { 'X-Campaign': 'march-2026' },
    })

    expect(sendgridProvider.send).toHaveBeenCalled()
  })
})
