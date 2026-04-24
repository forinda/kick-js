import type { KickPlugin } from '@forinda/kickjs'
import { MailerPlugin } from '@/plugins/mailer.plugin'
import { env } from './env'

export const plugins: KickPlugin[] = [
  MailerPlugin({
    defaultFrom: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
  }),
]
