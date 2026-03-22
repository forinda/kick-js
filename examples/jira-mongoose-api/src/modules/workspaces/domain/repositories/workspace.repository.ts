import type { WorkspaceEntity } from '../entities/workspace.entity';
import type { PaginationQuery, PaginatedResponse } from '@/shared/application/pagination.dto';

export interface IWorkspaceRepository {
  findById(id: string): Promise<WorkspaceEntity | null>;
  findBySlug(slug: string): Promise<WorkspaceEntity | null>;
  create(data: Partial<WorkspaceEntity>): Promise<WorkspaceEntity>;
  update(id: string, data: Partial<WorkspaceEntity>): Promise<WorkspaceEntity | null>;
  delete(id: string): Promise<boolean>;
  findByOwner(ownerId: string): Promise<WorkspaceEntity[]>;
}
