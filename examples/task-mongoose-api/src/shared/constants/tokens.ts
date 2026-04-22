export const TOKENS = {
  // Repositories
  USER_REPOSITORY: Symbol('UserRepository'),
  REFRESH_TOKEN_REPOSITORY: Symbol('RefreshTokenRepository'),
  WORKSPACE_REPOSITORY: Symbol('WorkspaceRepository'),
  WORKSPACE_MEMBER_REPOSITORY: Symbol('WorkspaceMemberRepository'),
  PROJECT_REPOSITORY: Symbol('ProjectRepository'),
  TASK_REPOSITORY: Symbol('TaskRepository'),
  COMMENT_REPOSITORY: Symbol('CommentRepository'),
  LABEL_REPOSITORY: Symbol('LabelRepository'),
  CHANNEL_REPOSITORY: Symbol('ChannelRepository'),
  MESSAGE_REPOSITORY: Symbol('MessageRepository'),
  NOTIFICATION_REPOSITORY: Symbol('NotificationRepository'),
  ACTIVITY_REPOSITORY: Symbol('ActivityRepository'),
  ATTACHMENT_REPOSITORY: Symbol('AttachmentRepository'),

  // Services
  MAIL_PROVIDER: Symbol('MailProvider'),
  PRESENCE_SERVICE: Symbol('PresenceService'),
  QUEUE_SERVICE: Symbol('QueueService'),

  // Infrastructure
  MONGOOSE: Symbol('Mongoose'),
  REDIS: Symbol('Redis'),
} as const;
