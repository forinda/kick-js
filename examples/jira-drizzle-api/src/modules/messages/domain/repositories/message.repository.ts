import type { messages } from '@/db/schema'
import type { ParsedQuery } from '@forinda/kickjs-http'

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert

export interface IMessageRepository {
  findById(id: string): Promise<Message | null>
  findByChannel(channelId: string, cursor?: string, limit?: number): Promise<Message[]>
  findPaginated(parsed: ParsedQuery, channelId: string): Promise<{ data: Message[]; total: number }>
  create(data: NewMessage): Promise<Message>
  update(id: string, data: Partial<NewMessage>): Promise<Message>
  delete(id: string): Promise<void>
}

export const MESSAGE_REPOSITORY = Symbol('IMessageRepository')
