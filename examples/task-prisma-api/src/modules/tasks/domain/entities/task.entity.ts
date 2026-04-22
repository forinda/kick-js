/**
 * Task Entity
 *
 * Domain layer — the core business object.
 * Uses a private constructor with static factory methods (create, reconstitute)
 * to enforce invariants. Properties are accessed via getters to maintain encapsulation.
 *
 * Patterns used:
 *   - Private constructor: prevents direct instantiation
 *   - create(): factory for new entities (generates ID, sets timestamps)
 *   - reconstitute(): factory for rebuilding from persistence (no side effects)
 *   - changeName(): mutation method that enforces business rules
 */
import { TaskId } from '../value-objects/task-id.vo'

interface TaskProps {
  id: TaskId
  name: string
  createdAt: Date
  updatedAt: Date
}

export class Task {
  private constructor(private props: TaskProps) {}

  static create(params: { name: string }): Task {
    const now = new Date()
    return new Task({
      id: TaskId.create(),
      name: params.name,
      createdAt: now,
      updatedAt: now,
    })
  }

  static reconstitute(props: TaskProps): Task {
    return new Task(props)
  }

  get id(): TaskId {
    return this.props.id
  }
  get name(): string {
    return this.props.name
  }
  get createdAt(): Date {
    return this.props.createdAt
  }
  get updatedAt(): Date {
    return this.props.updatedAt
  }

  changeName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('Name cannot be empty')
    }
    this.props.name = name.trim()
    this.props.updatedAt = new Date()
  }

  toJSON() {
    return {
      id: this.props.id.toString(),
      name: this.props.name,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    }
  }
}
