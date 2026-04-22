import type { ActivityEntity } from '../entities/activity.entity';

export interface IActivityRepository {
  create(data: Partial<ActivityEntity>): Promise<ActivityEntity>;
  findByWorkspace(workspaceId: string, parsed: any): Promise<{ data: ActivityEntity[]; total: number }>;
  findByProject(projectId: string, parsed: any): Promise<{ data: ActivityEntity[]; total: number }>;
  findByTask(taskId: string): Promise<ActivityEntity[]>;
}
