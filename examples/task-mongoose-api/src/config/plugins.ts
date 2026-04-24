import type { KickPlugin } from '@forinda/kickjs';
import { MailerPlugin } from '@/plugins/mailer.plugin';
import { env } from './env';

export const plugins: KickPlugin[] = [
  MailerPlugin({
    provider: env.NODE_ENV === 'production' ? 'resend' : 'console',
    resendApiKey: env.RESEND_API_KEY,
    defaultFrom: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
  }),
];
