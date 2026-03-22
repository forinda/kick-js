import { Resend } from 'resend';
import { Logger } from '@forinda/kickjs-core';
import type { MailProvider, MailMessage, MailResult } from '@forinda/kickjs-mailer';

const logger = Logger.for('ResendMailProvider');

export class ResendMailProvider implements MailProvider {
  name = 'resend';
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: MailMessage): Promise<MailResult> {
    const to = Array.isArray(message.to)
      ? message.to.map((r) => (typeof r === 'string' ? r : r.address))
      : [typeof message.to === 'string' ? message.to : message.to.address];

    const from = message.from
      ? typeof message.from === 'string'
        ? message.from
        : `${message.from.name} <${message.from.address}>`
      : undefined;

    try {
      const { data, error } = await this.client.emails.send({
        from: from ?? 'Vibed <noreply@vibed.app>',
        to,
        subject: message.subject,
        html: message.html ?? '',
        text: message.text,
        headers: message.headers,
      } as any);

      if (error) {
        logger.error(error, 'Resend API error');
        return { messageId: '', accepted: false, raw: error };
      }

      logger.info(`Email sent: ${data?.id}`);
      return { messageId: data?.id ?? '', accepted: true, raw: data };
    } catch (err) {
      logger.error(err, 'Failed to send email');
      return { messageId: '', accepted: false, raw: err };
    }
  }

  async shutdown() {
    // No cleanup needed for Resend
  }
}
