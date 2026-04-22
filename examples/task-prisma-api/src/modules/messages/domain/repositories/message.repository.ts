import type { ParsedQuery } from '@forinda/kickjs'
import type { Message } from '@/generated/prisma/client'

export type { Message }
export type NewMessage = {
  channelId: string
  senderId: string
  content: string
  mentions?: any
}

export interface IMessageRepository {
  findById(id: string): Promise<Message | null>
  findByChannel(channelId: string, cursor?: string, limit?: number): Promise<Message[]>
  findPaginated(parsed: ParsedQuery, channelId: string): Promise<{ data: Message[]; total: number }>
  create(data: NewMessage): Promise<Message>
  update(id: string, data: Partial<NewMessage>): Promise<Message>
  delete(id: string): Promise<void>
}

export const MESSAGE_REPOSITORY = Symbol('IMessageRepository')
