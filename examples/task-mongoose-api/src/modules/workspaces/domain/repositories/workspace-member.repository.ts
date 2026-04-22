import type { WorkspaceMemberEntity } from '../entities/workspace-member.entity';

export interface IWorkspaceMemberRepository {
  findByUserAndWorkspace(userId: string, workspaceId: string): Promise<WorkspaceMemberEntity | null>;
  findByWorkspace(workspaceId: string): Promise<WorkspaceMemberEntity[]>;
  findByUser(userId: string): Promise<WorkspaceMemberEntity[]>;
  create(data: Partial<WorkspaceMemberEntity>): Promise<WorkspaceMemberEntity>;
  updateRole(id: string, role: 'admin' | 'member'): Promise<WorkspaceMemberEntity | null>;
  delete(id: string): Promise<boolean>;
  deleteByUserAndWorkspace(userId: string, workspaceId: string): Promise<boolean>;
}
