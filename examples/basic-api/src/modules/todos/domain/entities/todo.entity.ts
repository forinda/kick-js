import { TodoId } from '../value-objects/todo-id.vo'

interface TodoProps {
  id: TodoId
  title: string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}

export class Todo {
  private constructor(private props: TodoProps) {}

  static create(params: { title: string }): Todo {
    const now = new Date()
    return new Todo({
      id: TodoId.create(),
      title: params.title.trim(),
      completed: false,
      createdAt: now,
      updatedAt: now,
    })
  }

  static reconstitute(props: TodoProps): Todo {
    return new Todo(props)
  }

  get id(): TodoId {
    return this.props.id
  }
  get title(): string {
    return this.props.title
  }
  get completed(): boolean {
    return this.props.completed
  }

  changeTitle(title: string): void {
    if (!title || title.trim().length === 0) {
      throw new Error('Title cannot be empty')
    }
    this.props.title = title.trim()
    this.props.updatedAt = new Date()
  }

  markCompleted(): void {
    this.props.completed = true
    this.props.updatedAt = new Date()
  }

  markIncomplete(): void {
    this.props.completed = false
    this.props.updatedAt = new Date()
  }

  toJSON() {
    return {
      id: this.props.id.toString(),
      title: this.props.title,
      completed: this.props.completed,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    }
  }
}
