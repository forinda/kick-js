import { DocumentsId } from '../value-objects/documents-id.vo'

interface DocumentsProps {
  id: DocumentsId
  name: string
  createdAt: Date
  updatedAt: Date
}

export class Documents {
  private constructor(private props: DocumentsProps) {}

  static create(params: { name: string }): Documents {
    const now = new Date()
    return new Documents({
      id: DocumentsId.create(),
      name: params.name,
      createdAt: now,
      updatedAt: now,
    })
  }

  static reconstitute(props: DocumentsProps): Documents {
    return new Documents(props)
  }

  get id(): DocumentsId {
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
