import type { ProjectEntity } from '../entities/project.entity';

export interface IProjectRepository {
  findById(id: string): Promise<ProjectEntity | null>;
  findByWorkspace(workspaceId: string): Promise<ProjectEntity[]>;
  findByKeyAndWorkspace(key: string, workspaceId: string): Promise<ProjectEntity | null>;
  create(data: Partial<ProjectEntity>): Promise<ProjectEntity>;
  update(id: string, data: Partial<ProjectEntity>): Promise<ProjectEntity | null>;
  delete(id: string): Promise<boolean>;
  incrementTaskCounter(projectId: string): Promise<number>;
}
