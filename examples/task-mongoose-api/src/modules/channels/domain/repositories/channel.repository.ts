import type { ChannelEntity } from '../entities/channel.entity';

export interface IChannelRepository {
  findById(id: string): Promise<ChannelEntity | null>;
  findByWorkspace(workspaceId: string): Promise<ChannelEntity[]>;
  findByNameAndWorkspace(name: string, workspaceId: string): Promise<ChannelEntity | null>;
  create(data: Partial<ChannelEntity>): Promise<ChannelEntity>;
  update(id: string, data: Partial<ChannelEntity>): Promise<ChannelEntity | null>;
  delete(id: string): Promise<boolean>;
  addMember(channelId: string, userId: string): Promise<void>;
  removeMember(channelId: string, userId: string): Promise<void>;
}
