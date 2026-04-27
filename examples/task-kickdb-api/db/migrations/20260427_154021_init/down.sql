-- REVIEWED: false
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_ownerId_fk";
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_workspaceId_fk";
DROP INDEX "workspaces_slug_unique";
DROP INDEX "workspaces_owner_idx";
DROP INDEX "users_email_unique";
DROP INDEX "users_name_idx";
DROP INDEX "tasks_title_workspace_unique";
DROP INDEX "tasks_status_idx";
DROP INDEX "tasks_workspace_idx";
DROP TABLE "workspaces";
DROP TABLE "users";
DROP TABLE "tasks";
