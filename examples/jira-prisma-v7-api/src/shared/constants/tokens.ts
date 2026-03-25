export const TOKENS = {
  // Repositories
  USER_REPOSITORY: Symbol('UserRepository'),
  REFRESH_TOKEN_REPOSITORY: Symbol('RefreshTokenRepository'),
  WORKSPACE_REPOSITORY: Symbol('WorkspaceRepository'),
  WORKSPACE_MEMBER_REPOSITORY: Symbol('WorkspaceMemberRepository'),
  PROJECT_REPOSITORY: Symbol('ProjectRepository'),
  TASK_REPOSITORY: Symbol('TaskRepository'),
  TASK_ASSIGNEE_REPOSITORY: Symbol('TaskAssigneeRepository'),
  TASK_LABEL_REPOSITORY: Symbol('TaskLabelRepository'),
  COMMENT_REPOSITORY: Symbol('CommentRepository'),
  LABEL_REPOSITORY: Symbol('LabelRepository'),
  CHANNEL_REPOSITORY: Symbol('ChannelRepository'),
  CHANNEL_MEMBER_REPOSITORY: Symbol('ChannelMemberRepository'),
  MESSAGE_REPOSITORY: Symbol('MessageRepository'),
  NOTIFICATION_REPOSITORY: Symbol('NotificationRepository'),
  ACTIVITY_REPOSITORY: Symbol('ActivityRepository'),
  ATTACHMENT_REPOSITORY: Symbol('AttachmentRepository'),

  // Services
  PRESENCE_SERVICE: Symbol('PresenceService'),
} as const
