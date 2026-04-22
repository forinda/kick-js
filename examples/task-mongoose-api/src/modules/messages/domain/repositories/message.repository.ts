import type { MessageEntity } from '../entities/message.entity';

export interface IMessageRepository {
  findById(id: string): Promise<MessageEntity | null>;
  findByChannel(channelId: string, options?: { before?: string; after?: string; limit?: number }): Promise<MessageEntity[]>;
  create(data: Partial<MessageEntity>): Promise<MessageEntity>;
  update(id: string, data: Partial<MessageEntity>): Promise<MessageEntity | null>;
  softDelete(id: string): Promise<MessageEntity | null>;
}
