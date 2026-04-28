-- REVIEWED: false
CREATE TYPE "channel_type" AS ENUM ('public', 'private', 'direct');
CREATE TYPE "global_role" AS ENUM ('superadmin', 'user');
CREATE TYPE "notification_type" AS ENUM ('task_assigned', 'mentioned', 'workspace_invite', 'task_overdue', 'comment_added');
CREATE TYPE "task_priority" AS ENUM ('critical', 'high', 'medium', 'low', 'none');
CREATE TYPE "workspace_role" AS ENUM ('admin', 'member');
CREATE TABLE "activities" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "projectId" uuid,
  "taskId" uuid,
  "actorId" uuid NOT NULL,
  "action" varchar(100) NOT NULL,
  "changes" jsonb,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "attachments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "taskId" uuid NOT NULL,
  "uploaderId" uuid NOT NULL,
  "fileName" varchar(255) NOT NULL,
  "fileSize" integer NOT NULL,
  "mimeType" varchar(100) NOT NULL,
  "data" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "channel_members" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "channelId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "joinedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "channels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "projectId" uuid,
  "name" varchar(100) NOT NULL,
  "description" text,
  "type" channel_type NOT NULL DEFAULT 'public',
  "createdById" uuid NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "comments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "taskId" uuid NOT NULL,
  "authorId" uuid NOT NULL,
  "content" text NOT NULL,
  "mentions" jsonb NOT NULL DEFAULT '''[]''::jsonb',
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "labels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "color" char(7) NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "messages" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "channelId" uuid NOT NULL,
  "senderId" uuid NOT NULL,
  "content" text NOT NULL,
  "mentions" jsonb NOT NULL DEFAULT '''[]''::jsonb',
  "isEdited" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "notifications" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "recipientId" uuid NOT NULL,
  "type" notification_type NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '''{}''::jsonb',
  "isRead" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "projects" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "key" varchar(10) NOT NULL,
  "description" text,
  "leadId" uuid,
  "taskCounter" integer NOT NULL DEFAULT 0,
  "isArchived" boolean NOT NULL DEFAULT false,
  "statusColumns" jsonb NOT NULL DEFAULT '''[{"name":"todo","order":0,"color":"#94a3b8"},{"name":"in_progress","order":1,"color":"#3b82f6"},{"name":"in_review","order":2,"color":"#f59e0b"},{"name":"done","order":3,"color":"#22c55e"}]''::jsonb',
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "refresh_tokens" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL,
  "token" varchar(255) NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "task_assignees" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "taskId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "assignedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "task_labels" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "taskId" uuid NOT NULL,
  "labelId" uuid NOT NULL,
  "appliedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "tasks" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL,
  "workspaceId" uuid NOT NULL,
  "key" varchar(20) NOT NULL,
  "title" varchar(500) NOT NULL,
  "description" text,
  "status" varchar(50) NOT NULL DEFAULT 'todo',
  "priority" task_priority NOT NULL DEFAULT 'none',
  "reporterId" uuid NOT NULL,
  "parentTaskId" uuid,
  "dueDate" timestamp,
  "estimatePoints" integer,
  "orderIndex" integer NOT NULL DEFAULT 0,
  "attachmentCount" integer NOT NULL DEFAULT 0,
  "commentCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" varchar(255) NOT NULL,
  "passwordHash" varchar(255) NOT NULL,
  "firstName" varchar(100) NOT NULL,
  "lastName" varchar(100) NOT NULL,
  "avatarUrl" text,
  "globalRole" global_role NOT NULL DEFAULT 'user',
  "isActive" boolean NOT NULL DEFAULT true,
  "lastLoginAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "workspace_members" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "role" workspace_role NOT NULL DEFAULT 'member',
  "joinedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "workspaces" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "slug" varchar(255) NOT NULL,
  "description" text,
  "ownerId" uuid NOT NULL,
  "logoUrl" text,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "activities_workspace_idx" ON "activities" ("workspaceId");
CREATE INDEX "activities_actor_idx" ON "activities" ("actorId");
CREATE INDEX "activities_created_idx" ON "activities" ("createdAt");
CREATE INDEX "attachments_task_idx" ON "attachments" ("taskId");
CREATE UNIQUE INDEX "channel_members_channel_user_unique" ON "channel_members" ("channelId", "userId");
CREATE UNIQUE INDEX "channels_workspace_name_unique" ON "channels" ("workspaceId", "name");
CREATE INDEX "channels_workspace_idx" ON "channels" ("workspaceId");
CREATE INDEX "channels_project_idx" ON "channels" ("projectId");
CREATE INDEX "comments_task_idx" ON "comments" ("taskId");
CREATE INDEX "comments_author_idx" ON "comments" ("authorId");
CREATE UNIQUE INDEX "labels_workspace_name_unique" ON "labels" ("workspaceId", "name");
CREATE INDEX "messages_channel_idx" ON "messages" ("channelId");
CREATE INDEX "messages_sender_idx" ON "messages" ("senderId");
CREATE INDEX "notifications_recipient_idx" ON "notifications" ("recipientId");
CREATE INDEX "notifications_recipient_read_idx" ON "notifications" ("recipientId", "isRead");
CREATE UNIQUE INDEX "projects_workspace_key_unique" ON "projects" ("workspaceId", "key");
CREATE INDEX "projects_workspace_idx" ON "projects" ("workspaceId");
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" ("userId");
CREATE UNIQUE INDEX "refresh_tokens_token_unique" ON "refresh_tokens" ("token");
CREATE UNIQUE INDEX "task_assignees_task_user_unique" ON "task_assignees" ("taskId", "userId");
CREATE UNIQUE INDEX "task_labels_task_label_unique" ON "task_labels" ("taskId", "labelId");
CREATE INDEX "tasks_project_idx" ON "tasks" ("projectId");
CREATE INDEX "tasks_workspace_idx" ON "tasks" ("workspaceId");
CREATE INDEX "tasks_status_idx" ON "tasks" ("status");
CREATE INDEX "tasks_parent_idx" ON "tasks" ("parentTaskId");
CREATE INDEX "tasks_reporter_idx" ON "tasks" ("reporterId");
CREATE UNIQUE INDEX "tasks_key_unique" ON "tasks" ("key");
CREATE INDEX "users_name_idx" ON "users" ("firstName", "lastName");
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
CREATE UNIQUE INDEX "workspace_members_workspace_user_unique" ON "workspace_members" ("workspaceId", "userId");
CREATE INDEX "workspace_members_workspace_idx" ON "workspace_members" ("workspaceId");
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" ("userId");
CREATE INDEX "workspaces_owner_idx" ON "workspaces" ("ownerId");
CREATE UNIQUE INDEX "workspaces_slug_unique" ON "workspaces" ("slug");
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "activities" ADD CONSTRAINT "activities_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "activities" ADD CONSTRAINT "activities_taskId_fk" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "activities" ADD CONSTRAINT "activities_actorId_fk" FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_taskId_fk" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaderId_fk" FOREIGN KEY ("uploaderId") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channelId_fk" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_userId_fk" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspaceId_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "channels" ADD CONSTRAINT "channels_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "channels" ADD CONSTRAINT "channels_createdById_fk" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "comments" ADD CONSTRAINT "comments_taskId_fk" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "comments" ADD CONSTRAINT "comments_authorId_fk" FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspaceId_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "messages" ADD CONSTRAINT "messages_channelId_fk" FOREIGN KEY ("channelId") REFERENCES "channels" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fk" FOREIGN KEY ("senderId") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fk" FOREIGN KEY ("recipientId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "projects" ADD CONSTRAINT "projects_leadId_fk" FOREIGN KEY ("leadId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fk" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_taskId_fk" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_userId_fk" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_taskId_fk" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_labelId_fk" FOREIGN KEY ("labelId") REFERENCES "labels" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fk" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reporterId_fk" FOREIGN KEY ("reporterId") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fk" FOREIGN KEY ("parentTaskId") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspaceId_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_userId_fk" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
