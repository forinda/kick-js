import { Logger } from '@forinda/kickjs-core'
import type { MailProvider, MailMessage, MailResult } from '../types'

const log = Logger.for('ConsoleMail')

let counter = 0

/**
 * Console mail provider — logs emails instead of sending them.
 * Perfect for development and testing.
 *
 * @example
 * ```ts
 * new MailerAdapter({
 *   provider: new ConsoleProvider(),
 *   defaultFrom: 'dev@localhost',
 * })
 * ```
 */
export class ConsoleProvider implements MailProvider {
  name = 'console'

  async send(message: MailMessage): Promise<MailResult> {
    const id = `console-${++counter}`
    const to = Array.isArray(message.to)
      ? message.to.map((r) => (typeof r === 'string' ? r : r.address)).join(', ')
      : typeof message.to === 'string'
        ? message.to
        : message.to.address

    log.info(`────────────────────────────────────────`)
    log.info(`From:    ${formatAddr(message.from)}`)
    log.info(`To:      ${to}`)
    if (message.cc) log.info(`CC:      ${formatAddr(message.cc)}`)
    if (message.bcc) log.info(`BCC:     ${formatAddr(message.bcc)}`)
    log.info(`Subject: ${message.subject}`)
    if (message.text)
      log.info(`Text:    ${message.text.slice(0, 200)}${message.text.length > 200 ? '...' : ''}`)
    if (message.html)
      log.info(`HTML:    ${message.html.slice(0, 200)}${message.html.length > 200 ? '...' : ''}`)
    if (message.attachments?.length) {
      log.info(`Attach:  ${message.attachments.map((a) => a.filename).join(', ')}`)
    }
    log.info(`ID:      ${id}`)
    log.info(`────────────────────────────────────────`)

    return { messageId: id, accepted: true }
  }
}

function formatAddr(addr: any): string {
  if (!addr) return '(none)'
  if (typeof addr === 'string') return addr
  if (Array.isArray(addr)) return addr.map(formatAddr).join(', ')
  return addr.name ? `"${addr.name}" <${addr.address}>` : addr.address
}
