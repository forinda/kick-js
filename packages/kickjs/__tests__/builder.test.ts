import { describe, expect, it } from 'vitest'
import { Builder, type BuilderOf, withBuilder } from '@forinda/kickjs'

describe('@Builder + withBuilder', () => {
  it('@Builder attaches a runtime builder() static and round-trips fields', () => {
    @Builder
    class UserDto {
      name!: string
      email!: string
      role!: string
      declare static readonly builder: () => BuilderOf<UserDto>
    }

    const user = UserDto.builder().name('Alice').email('alice@example.com').role('admin').build()

    expect(user).toBeInstanceOf(UserDto)
    expect(user.name).toBe('Alice')
    expect(user.email).toBe('alice@example.com')
    expect(user.role).toBe('admin')
  })

  it('withBuilder() infers BuilderOf<T> without a declare line', () => {
    class TaskDtoBase {
      title!: string
      done!: boolean
    }
    const TaskDto = withBuilder(TaskDtoBase)

    const task = TaskDto.builder().title('write tests').done(true).build()

    expect(task).toBeInstanceOf(TaskDtoBase)
    expect(task.title).toBe('write tests')
    expect(task.done).toBe(true)
  })

  it('builder chains share state across calls but restart per builder()', () => {
    class Box {
      a!: number
      declare static readonly builder: () => BuilderOf<Box>
    }
    Builder(Box)

    const first = Box.builder().a(1).build()
    const second = Box.builder().a(2).build()

    expect(first.a).toBe(1)
    expect(second.a).toBe(2)
  })
})
