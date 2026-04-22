export interface WorkspaceStats {
  memberCount: number
  projectCount: number
  taskCount: number
  openTasks: number
  completedTasks: number
  channelCount: number
}

export interface ProjectStats {
  taskCount: number
  tasksByStatus: Record<string, number>
  completionPercent: number
  commentCount: number
  attachmentCount: number
}

export interface IStatsRepository {
  getWorkspaceStats(workspaceId: string): Promise<WorkspaceStats>
  getProjectStats(projectId: string): Promise<ProjectStats>
}

export const STATS_REPOSITORY = Symbol('IStatsRepository')
