import type { LabelEntity } from '../entities/label.entity';

export interface ILabelRepository {
  findById(id: string): Promise<LabelEntity | null>;
  findByWorkspace(workspaceId: string): Promise<LabelEntity[]>;
  findByNameAndWorkspace(name: string, workspaceId: string): Promise<LabelEntity | null>;
  create(data: Partial<LabelEntity>): Promise<LabelEntity>;
  update(id: string, data: Partial<LabelEntity>): Promise<LabelEntity | null>;
  delete(id: string): Promise<boolean>;
}
