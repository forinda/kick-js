import 'reflect-metadata';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserModel } from '@/modules/users/infrastructure/schemas/user.schema';
import { WorkspaceModel } from '@/modules/workspaces/infrastructure/schemas/workspace.schema';
import { WorkspaceMemberModel } from '@/modules/workspaces/infrastructure/schemas/workspace-member.schema';
import { ProjectModel } from '@/modules/projects/infrastructure/schemas/project.schema';
import { LabelModel } from '@/modules/labels/infrastructure/schemas/label.schema';
import { TaskModel } from '@/modules/tasks/infrastructure/schemas/task.schema';
import { ChannelModel } from '@/modules/channels/infrastructure/schemas/channel.schema';

const MONGODB_URI = process.env.MONGODB_URI!;
if (!MONGODB_URI) {
  console.error('MONGODB_URI env variable is required');
  process.exit(1);
}

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected. Seeding database...\n');

  // ── Users ──────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const users = await UserModel.insertMany([
    { email: 'admin@vibed.dev', passwordHash, firstName: 'Admin', lastName: 'User', globalRole: 'superadmin' },
    { email: 'alice@vibed.dev', passwordHash, firstName: 'Alice', lastName: 'Johnson', globalRole: 'user' },
    { email: 'bob@vibed.dev', passwordHash, firstName: 'Bob', lastName: 'Smith', globalRole: 'user' },
    { email: 'carol@vibed.dev', passwordHash, firstName: 'Carol', lastName: 'Williams', globalRole: 'user' },
  ]);
  console.log(`Created ${users.length} users`);

  const [admin, alice, bob, carol] = users;

  // ── Workspace ──────────────────────────────────────────
  const workspace = await WorkspaceModel.create({
    name: 'Vibed HQ',
    slug: 'vibed-hq',
    description: 'Main workspace for the Vibed team',
    ownerId: admin._id,
  });
  console.log(`Created workspace: ${workspace.name}`);

  // ── Workspace Members ──────────────────────────────────
  await WorkspaceMemberModel.insertMany([
    { workspaceId: workspace._id, userId: admin._id, role: 'admin' },
    { workspaceId: workspace._id, userId: alice._id, role: 'admin' },
    { workspaceId: workspace._id, userId: bob._id, role: 'member' },
    { workspaceId: workspace._id, userId: carol._id, role: 'member' },
  ]);
  console.log('Added 4 workspace members');

  // ── Labels ─────────────────────────────────────────────
  const labels = await LabelModel.insertMany([
    { workspaceId: workspace._id, name: 'bug', color: '#ef4444' },
    { workspaceId: workspace._id, name: 'feature', color: '#3b82f6' },
    { workspaceId: workspace._id, name: 'improvement', color: '#8b5cf6' },
    { workspaceId: workspace._id, name: 'docs', color: '#10b981' },
    { workspaceId: workspace._id, name: 'urgent', color: '#f97316' },
  ]);
  console.log(`Created ${labels.length} labels`);

  const [bugLabel, featureLabel, improvementLabel, docsLabel, urgentLabel] = labels;

  // ── Projects ───────────────────────────────────────────
  const backend = await ProjectModel.create({
    workspaceId: workspace._id,
    name: 'Backend API',
    key: 'API',
    description: 'KickJS backend for Vibed',
    leadId: alice._id,
    taskCounter: 6,
  });

  const frontend = await ProjectModel.create({
    workspaceId: workspace._id,
    name: 'Frontend App',
    key: 'FE',
    description: 'React frontend for Vibed',
    leadId: bob._id,
    taskCounter: 4,
  });
  console.log('Created 2 projects: Backend API, Frontend App');

  // ── Tasks (Backend) ────────────────────────────────────
  const backendTasks = await TaskModel.insertMany([
    {
      projectId: backend._id, workspaceId: workspace._id,
      key: 'API-1', title: 'Set up JWT authentication',
      description: 'Implement register, login, refresh token rotation, and logout endpoints.',
      status: 'done', priority: 'critical',
      assigneeIds: [alice._id], reporterId: admin._id,
      labelIds: [featureLabel._id], orderIndex: 0,
    },
    {
      projectId: backend._id, workspaceId: workspace._id,
      key: 'API-2', title: 'Add workspace CRUD and membership',
      description: 'Create, read, update, delete workspaces. Invite members and manage roles.',
      status: 'done', priority: 'high',
      assigneeIds: [alice._id, bob._id], reporterId: admin._id,
      labelIds: [featureLabel._id], orderIndex: 1,
    },
    {
      projectId: backend._id, workspaceId: workspace._id,
      key: 'API-3', title: 'Implement task management',
      description: 'Full CRUD for tasks with status transitions, priority, assignees, and subtasks.',
      status: 'in-progress', priority: 'high',
      assigneeIds: [alice._id], reporterId: alice._id,
      labelIds: [featureLabel._id], orderIndex: 2,
    },
    {
      projectId: backend._id, workspaceId: workspace._id,
      key: 'API-4', title: 'Fix duplicate route paths',
      description: 'Controller paths are doubling when module path is set.',
      status: 'done', priority: 'medium',
      assigneeIds: [bob._id], reporterId: alice._id,
      labelIds: [bugLabel._id], orderIndex: 3,
    },
    {
      projectId: backend._id, workspaceId: workspace._id,
      key: 'API-5', title: 'Add WebSocket chat support',
      description: 'Real-time messaging via Socket.IO with typing indicators and presence.',
      status: 'review', priority: 'medium',
      assigneeIds: [carol._id], reporterId: alice._id,
      labelIds: [featureLabel._id], orderIndex: 4,
    },
    {
      projectId: backend._id, workspaceId: workspace._id,
      key: 'API-6', title: 'Write API documentation',
      description: 'Document all endpoints in Swagger and add inline JSDoc comments.',
      status: 'todo', priority: 'low',
      assigneeIds: [bob._id], reporterId: admin._id,
      labelIds: [docsLabel._id], dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      orderIndex: 5,
    },
  ]);
  console.log(`Created ${backendTasks.length} backend tasks`);

  // ── Tasks (Frontend) ───────────────────────────────────
  const frontendTasks = await TaskModel.insertMany([
    {
      projectId: frontend._id, workspaceId: workspace._id,
      key: 'FE-1', title: 'Scaffold React app with Vite',
      status: 'done', priority: 'high',
      assigneeIds: [bob._id], reporterId: bob._id,
      labelIds: [featureLabel._id], orderIndex: 0,
    },
    {
      projectId: frontend._id, workspaceId: workspace._id,
      key: 'FE-2', title: 'Build kanban board component',
      description: 'Drag-and-drop task board with status columns.',
      status: 'in-progress', priority: 'high',
      assigneeIds: [bob._id, carol._id], reporterId: bob._id,
      labelIds: [featureLabel._id, urgentLabel._id], orderIndex: 1,
    },
    {
      projectId: frontend._id, workspaceId: workspace._id,
      key: 'FE-3', title: 'Implement auth flow UI',
      description: 'Login, register, and token refresh pages.',
      status: 'todo', priority: 'medium',
      assigneeIds: [carol._id], reporterId: bob._id,
      labelIds: [featureLabel._id], orderIndex: 2,
    },
    {
      projectId: frontend._id, workspaceId: workspace._id,
      key: 'FE-4', title: 'Performance regression on task list',
      description: 'Task list re-renders on every keystroke in the filter input.',
      status: 'todo', priority: 'high',
      assigneeIds: [bob._id], reporterId: carol._id,
      labelIds: [bugLabel._id, urgentLabel._id],
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      orderIndex: 3,
    },
  ]);
  console.log(`Created ${frontendTasks.length} frontend tasks`);

  // ── Channels ───────────────────────────────────────────
  await ChannelModel.insertMany([
    {
      workspaceId: workspace._id, name: 'general',
      description: 'General discussion', type: 'public',
      memberIds: [admin._id, alice._id, bob._id, carol._id],
      createdById: admin._id,
    },
    {
      workspaceId: workspace._id, projectId: backend._id,
      name: 'backend-dev', description: 'Backend development chat',
      type: 'public', memberIds: [alice._id, bob._id, carol._id],
      createdById: alice._id,
    },
    {
      workspaceId: workspace._id, projectId: frontend._id,
      name: 'frontend-dev', description: 'Frontend development chat',
      type: 'public', memberIds: [bob._id, carol._id],
      createdById: bob._id,
    },
  ]);
  console.log('Created 3 channels');

  // ── Summary ────────────────────────────────────────────
  console.log('\n--- Seed complete ---');
  console.log(`Users:      ${users.length}`);
  console.log(`Workspace:  1 (${workspace.name})`);
  console.log(`Projects:   2`);
  console.log(`Tasks:      ${backendTasks.length + frontendTasks.length}`);
  console.log(`Labels:     ${labels.length}`);
  console.log(`Channels:   3`);
  console.log('\nLogin credentials (all users): Password123!');
  console.log('Admin: admin@vibed.dev');
  console.log('Users: alice@vibed.dev, bob@vibed.dev, carol@vibed.dev');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
