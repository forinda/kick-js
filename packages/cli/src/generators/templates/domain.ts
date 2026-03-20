export function generateDomainService(pascal: string, kebab: string): string {
  return `/**
 * ${pascal} Domain Service
 *
 * Domain layer — contains business rules that don't belong to a single entity.
 * Use this for cross-entity logic, validation rules, and domain invariants.
 * Keep it free of HTTP/framework concerns.
 */
import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { ${pascal.toUpperCase()}_REPOSITORY, type I${pascal}Repository } from '../repositories/${kebab}.repository'

@Service()
export class ${pascal}DomainService {
  constructor(
    @Inject(${pascal.toUpperCase()}_REPOSITORY) private readonly repo: I${pascal}Repository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('${pascal} not found')
    }
  }
}
`
}

export function generateEntity(pascal: string, kebab: string): string {
  return `/**
 * ${pascal} Entity
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
import { ${pascal}Id } from '../value-objects/${kebab}-id.vo'

interface ${pascal}Props {
  id: ${pascal}Id
  name: string
  createdAt: Date
  updatedAt: Date
}

export class ${pascal} {
  private constructor(private props: ${pascal}Props) {}

  static create(params: { name: string }): ${pascal} {
    const now = new Date()
    return new ${pascal}({
      id: ${pascal}Id.create(),
      name: params.name,
      createdAt: now,
      updatedAt: now,
    })
  }

  static reconstitute(props: ${pascal}Props): ${pascal} {
    return new ${pascal}(props)
  }

  get id(): ${pascal}Id {
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
`
}

export function generateValueObject(pascal: string, kebab: string): string {
  return `/**
 * ${pascal} ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   ${pascal}Id.create()    — generate a new UUID
 *   ${pascal}Id.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class ${pascal}Id {
  private constructor(private readonly value: string) {}

  static create(): ${pascal}Id {
    return new ${pascal}Id(randomUUID())
  }

  static from(id: string): ${pascal}Id {
    if (!id || id.trim().length === 0) {
      throw new Error('${pascal}Id cannot be empty')
    }
    return new ${pascal}Id(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: ${pascal}Id): boolean {
    return this.value === other.value
  }
}
`
}
