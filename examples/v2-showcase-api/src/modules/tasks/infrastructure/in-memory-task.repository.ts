import crypto from 'node:crypto'
import { Repository } from '@forinda/kickjs'
import type { Task, CreateTaskDto, UpdateTaskDto, ITaskRepository } from '../domain/task.entity'

@Repository()
export class InMemoryTaskRepository implements ITaskRepository {
  private tasks = new Map<string, Task>()

  async findAll(): Promise<Task[]> {
    return [...this.tasks.values()]
  }

  async findById(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null
  }

  async create(dto: CreateTaskDto): Promise<Task> {
    const task: Task = {
      id: crypto.randomUUID(),
      title: dto.title,
      description: dto.description,
      completed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.tasks.set(task.id, task)
    return task
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task | null> {
    const task = this.tasks.get(id)
    if (!task) return null
    const updated = { ...task, ...dto, updatedAt: new Date() }
    this.tasks.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<boolean> {
    return this.tasks.delete(id)
  }
}
