-- REVIEWED: false
CREATE TABLE "tasks" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" uuid NOT NULL,
  "title" varchar(500) NOT NULL,
  "description" text,
  "status" varchar(50) NOT NULL DEFAULT 'todo',
  "priority" varchar(20) NOT NULL DEFAULT 'none',
  "estimatePoints" integer,
  "metadata" jsonb,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" varchar(255) NOT NULL,
  "firstName" varchar(100) NOT NULL,
  "lastName" varchar(100) NOT NULL,
  "avatarUrl" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE TABLE "workspaces" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "slug" varchar(255) NOT NULL,
  "description" text,
  "ownerId" uuid NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "tasks_workspace_idx" ON "tasks" ("workspaceId");
CREATE INDEX "tasks_status_idx" ON "tasks" ("status");
CREATE UNIQUE INDEX "tasks_title_workspace_unique" ON "tasks" ("title", "workspaceId");
CREATE INDEX "users_name_idx" ON "users" ("firstName", "lastName");
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");
CREATE INDEX "workspaces_owner_idx" ON "workspaces" ("ownerId");
CREATE UNIQUE INDEX "workspaces_slug_unique" ON "workspaces" ("slug");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
