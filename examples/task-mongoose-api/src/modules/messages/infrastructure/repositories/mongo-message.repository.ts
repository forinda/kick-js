import { Repository } from '@forinda/kickjs';
import mongoose from 'mongoose';
import type { IMessageRepository } from '../../domain/repositories/message.repository';
import type { MessageEntity } from '../../domain/entities/message.entity';
import { MessageModel } from '../schemas/message.schema';

@Repository()
export class MongoMessageRepository implements IMessageRepository {
  async findById(id: string): Promise<MessageEntity | null> {
    return MessageModel.findById(id).lean() as any;
  }

  async findByChannel(channelId: string, options?: { before?: string; after?: string; limit?: number }): Promise<MessageEntity[]> {
    const filter: any = { channelId, isDeleted: false };
    if (options?.before) {
      filter._id = { $lt: new mongoose.Types.ObjectId(options.before) };
    }
    if (options?.after) {
      filter._id = { ...filter._id, $gt: new mongoose.Types.ObjectId(options.after) };
    }
    const limit = options?.limit ?? 50;
    return MessageModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean() as any;
  }

  async create(data: Partial<MessageEntity>): Promise<MessageEntity> {
    const doc = await MessageModel.create(data);
    return doc.toObject() as any;
  }

  async update(id: string, data: Partial<MessageEntity>): Promise<MessageEntity | null> {
    return MessageModel.findByIdAndUpdate(id, { $set: { ...data, isEdited: true } }, { new: true }).lean() as any;
  }

  async softDelete(id: string): Promise<MessageEntity | null> {
    return MessageModel.findByIdAndUpdate(id, { $set: { isDeleted: true, content: '' } }, { new: true }).lean() as any;
  }
}
