
/**
 * Query field configurations for ctx.paginate() / ctx.qs() / @ApiQueryParams.
 * Centralized so Swagger docs and controllers stay in sync.
 */

import type { ApiQueryParamsConfig } from "@forinda/kickjs";

export const TASK_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['status', 'priority', 'assigneeId', 'labelId', 'projectId'],
  sortable: ['createdAt', 'title', 'priority', 'dueDate', 'orderIndex'],
  searchable: ['title', 'description'],
};

export const USER_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['createdAt', 'email', 'firstName'],
  searchable: ['firstName', 'lastName', 'email'],
};

export const NOTIFICATION_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['type', 'isRead'],
  sortable: ['createdAt'],
};

export const ACTIVITY_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['action'],
  sortable: ['createdAt'],
};

export const LABEL_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
};

export const CHANNEL_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['name', 'createdAt'],
  searchable: ['name', 'description'],
};

export const WORKSPACE_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['name', 'createdAt'],
  searchable: ['name', 'description'],
};

export const PROJECT_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['name', 'createdAt', 'key'],
  searchable: ['name', 'description', 'key'],
};

export const COMMENT_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['createdAt'],
};

export const ATTACHMENT_QUERY_CONFIG: ApiQueryParamsConfig = {
  sortable: ['createdAt', 'fileName'],
  searchable: ['fileName'],
};

export const MEMBER_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['role'],
  sortable: ['joinedAt'],
};
