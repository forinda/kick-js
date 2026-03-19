import { UsersId } from '../value-objects/users-id.vo'

interface UsersProps {
  id: UsersId
  name: string
  email: string
  createdAt: Date
  updatedAt: Date
}

export class Users {
  private constructor(private props: UsersProps) {}

  static create(params: { name: string; email: string }): Users {
    const now = new Date()
    return new Users({
      id: UsersId.create(),
      name: params.name,
      email: params.email,
      createdAt: now,
      updatedAt: now,
    })
  }

  static reconstitute(props: UsersProps): Users {
    return new Users(props)
  }

  get id(): UsersId {
    return this.props.id
  }
  get name(): string {
    return this.props.name
  }
  get email(): string {
    return this.props.email
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
      email: this.props.email,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    }
  }
}
