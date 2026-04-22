import 'reflect-metadata'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import bcrypt from 'bcryptjs'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  console.error('DATABASE_URL env variable is required')
  process.exit(1)
}

const client = postgres(connectionString, { max: 1 })
const db = drizzle(client, { schema })

async function seed() {
  console.log('Seeding database...\n')

  const passwordHash = await bcrypt.hash('Password123!', 10)

  // ── Users ──────────────────────────────────────────────
  const userRows = await db
    .insert(schema.users)
    .values([
      {
        email: 'admin@vibed.dev',
        passwordHash,
        firstName: 'Admin',
        lastName: 'User',
        globalRole: 'superadmin',
      },
      {
        email: 'alice@vibed.dev',
        passwordHash,
        firstName: 'Alice',
        lastName: 'Johnson',
        globalRole: 'user',
      },
      {
        email: 'bob@vibed.dev',
        passwordHash,
        firstName: 'Bob',
        lastName: 'Smith',
        globalRole: 'user',
      },
      {
        email: 'carol@vibed.dev',
        passwordHash,
        firstName: 'Carol',
        lastName: 'Williams',
        globalRole: 'user',
      },
    ])
    .returning()
  console.log(`Created ${userRows.length} users`)

  const [admin, alice, bob, carol] = userRows

  // ── Workspace ──────────────────────────────────────────
  const [workspace] = await db
    .insert(schema.workspaces)
    .values({
      name: 'Vibed HQ',
      slug: 'vibed-hq',
      description: 'Main workspace for the Vibed team',
      ownerId: admin.id,
    })
    .returning()
  console.log(`Created workspace: ${workspace.name}`)

  // ── Workspace Members ──────────────────────────────────
  await db.insert(schema.workspaceMembers).values([
    { workspaceId: workspace.id, userId: admin.id, role: 'admin' as const },
    { workspaceId: workspace.id, userId: alice.id, role: 'admin' as const },
    { workspaceId: workspace.id, userId: bob.id, role: 'member' as const },
    { workspaceId: workspace.id, userId: carol.id, role: 'member' as const },
  ])
  console.log('Added 4 workspace members')

  // ── Labels ─────────────────────────────────────────────
  const labelRows = await db
    .insert(schema.labels)
    .values([
      { workspaceId: workspace.id, name: 'bug', color: '#ef4444' },
      { workspaceId: workspace.id, name: 'feature', color: '#3b82f6' },
      { workspaceId: workspace.id, name: 'improvement', color: '#8b5cf6' },
      { workspaceId: workspace.id, name: 'docs', color: '#10b981' },
      { workspaceId: workspace.id, name: 'urgent', color: '#f97316' },
    ])
    .returning()
  console.log(`Created ${labelRows.length} labels`)

  const [bugLabel, featureLabel, _improvementLabel, docsLabel, urgentLabel] = labelRows

  // ── Projects ───────────────────────────────────────────
  const [backend] = await db
    .insert(schema.projects)
    .values({
      workspaceId: workspace.id,
      name: 'Backend API',
      key: 'API',
      description: 'KickJS backend for Vibed',
      leadId: alice.id,
      taskCounter: 6,
    })
    .returning()

  const [frontend] = await db
    .insert(schema.projects)
    .values({
      workspaceId: workspace.id,
      name: 'Frontend App',
      key: 'FE',
      description: 'React frontend for Vibed',
      leadId: bob.id,
      taskCounter: 4,
    })
    .returning()
  console.log('Created 2 projects: Backend API, Frontend App')

  // ── Tasks (Backend) ────────────────────────────────────
  const backendTaskData = [
    {
      key: 'API-1',
      title: 'Set up JWT authentication',
      description: 'Implement register, login, refresh token rotation, and logout endpoints.',
      status: 'done',
      priority: 'critical' as const,
      reporterId: admin.id,
      orderIndex: 0,
      assignees: [alice.id],
      labels: [featureLabel.id],
    },
    {
      key: 'API-2',
      title: 'Add workspace CRUD and membership',
      description: 'Create, read, update, delete workspaces. Invite members and manage roles.',
      status: 'done',
      priority: 'high' as const,
      reporterId: admin.id,
      orderIndex: 1,
      assignees: [alice.id, bob.id],
      labels: [featureLabel.id],
    },
    {
      key: 'API-3',
      title: 'Implement task management',
      description:
        'Full CRUD for tasks with status transitions, priority, assignees, and subtasks.',
      status: 'in-progress',
      priority: 'high' as const,
      reporterId: alice.id,
      orderIndex: 2,
      assignees: [alice.id],
      labels: [featureLabel.id],
    },
    {
      key: 'API-4',
      title: 'Fix duplicate route paths',
      description: 'Controller paths are doubling when module path is set.',
      status: 'done',
      priority: 'medium' as const,
      reporterId: alice.id,
      orderIndex: 3,
      assignees: [bob.id],
      labels: [bugLabel.id],
    },
    {
      key: 'API-5',
      title: 'Add WebSocket chat support',
      description: 'Real-time messaging via Socket.IO with typing indicators and presence.',
      status: 'review',
      priority: 'medium' as const,
      reporterId: alice.id,
      orderIndex: 4,
      assignees: [carol.id],
      labels: [featureLabel.id],
    },
    {
      key: 'API-6',
      title: 'Write API documentation',
      description: 'Document all endpoints in Swagger and add inline JSDoc comments.',
      status: 'todo',
      priority: 'low' as const,
      reporterId: admin.id,
      orderIndex: 5,
      assignees: [bob.id],
      labels: [docsLabel.id],
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  ]

  for (const t of backendTaskData) {
    const { assignees, labels, ...taskData } = t
    const [task] = await db
      .insert(schema.tasks)
      .values({ ...taskData, projectId: backend.id, workspaceId: workspace.id })
      .returning()

    if (assignees.length > 0) {
      await db
        .insert(schema.taskAssignees)
        .values(assignees.map((userId) => ({ taskId: task.id, userId })))
    }
    if (labels.length > 0) {
      await db
        .insert(schema.taskLabels)
        .values(labels.map((labelId) => ({ taskId: task.id, labelId })))
    }
  }
  console.log(`Created ${backendTaskData.length} backend tasks`)

  // ── Tasks (Frontend) ───────────────────────────────────
  const frontendTaskData = [
    {
      key: 'FE-1',
      title: 'Scaffold React app with Vite',
      status: 'done',
      priority: 'high' as const,
      reporterId: bob.id,
      orderIndex: 0,
      assignees: [bob.id],
      labels: [featureLabel.id],
    },
    {
      key: 'FE-2',
      title: 'Build kanban board component',
      description: 'Drag-and-drop task board with status columns.',
      status: 'in-progress',
      priority: 'high' as const,
      reporterId: bob.id,
      orderIndex: 1,
      assignees: [bob.id, carol.id],
      labels: [featureLabel.id, urgentLabel.id],
    },
    {
      key: 'FE-3',
      title: 'Implement auth flow UI',
      description: 'Login, register, and token refresh pages.',
      status: 'todo',
      priority: 'medium' as const,
      reporterId: bob.id,
      orderIndex: 2,
      assignees: [carol.id],
      labels: [featureLabel.id],
    },
    {
      key: 'FE-4',
      title: 'Performance regression on task list',
      description: 'Task list re-renders on every keystroke in the filter input.',
      status: 'todo',
      priority: 'high' as const,
      reporterId: carol.id,
      orderIndex: 3,
      assignees: [bob.id],
      labels: [bugLabel.id, urgentLabel.id],
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    },
  ]

  for (const t of frontendTaskData) {
    const { assignees, labels, ...taskData } = t
    const [task] = await db
      .insert(schema.tasks)
      .values({ ...taskData, projectId: frontend.id, workspaceId: workspace.id })
      .returning()

    if (assignees.length > 0) {
      await db
        .insert(schema.taskAssignees)
        .values(assignees.map((userId) => ({ taskId: task.id, userId })))
    }
    if (labels.length > 0) {
      await db
        .insert(schema.taskLabels)
        .values(labels.map((labelId) => ({ taskId: task.id, labelId })))
    }
  }
  console.log(`Created ${frontendTaskData.length} frontend tasks`)

  // ── Channels ───────────────────────────────────────────
  const channelData = [
    {
      workspaceId: workspace.id,
      name: 'general',
      description: 'General discussion',
      type: 'public' as const,
      createdById: admin.id,
      members: [admin.id, alice.id, bob.id, carol.id],
    },
    {
      workspaceId: workspace.id,
      projectId: backend.id,
      name: 'backend-dev',
      description: 'Backend development chat',
      type: 'public' as const,
      createdById: alice.id,
      members: [alice.id, bob.id, carol.id],
    },
    {
      workspaceId: workspace.id,
      projectId: frontend.id,
      name: 'frontend-dev',
      description: 'Frontend development chat',
      type: 'public' as const,
      createdById: bob.id,
      members: [bob.id, carol.id],
    },
  ]

  for (const c of channelData) {
    const { members, ...channelValues } = c
    const [channel] = await db.insert(schema.channels).values(channelValues).returning()
    await db
      .insert(schema.channelMembers)
      .values(members.map((userId) => ({ channelId: channel.id, userId })))
  }
  console.log('Created 3 channels')

  // ── Summary ────────────────────────────────────────────
  console.log('\n--- Seed complete ---')
  console.log(`Users:      ${userRows.length}`)
  console.log(`Workspace:  1 (${workspace.name})`)
  console.log(`Projects:   2`)
  console.log(`Tasks:      ${backendTaskData.length + frontendTaskData.length}`)
  console.log(`Labels:     ${labelRows.length}`)
  console.log(`Channels:   3`)
  console.log('\nLogin credentials (all users): Password123!')
  console.log('Admin: admin@vibed.dev')
  console.log('Users: alice@vibed.dev, bob@vibed.dev, carol@vibed.dev')

  await client.end()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
