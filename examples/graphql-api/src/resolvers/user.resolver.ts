import { Service } from '@forinda/kickjs-core'
import { Resolver, Query, Mutation, Arg } from '@forinda/kickjs-graphql'

interface User {
  id: string
  name: string
  email: string
  role: string
}

let nextId = 4

const users: User[] = [
  { id: '1', name: 'Alice Johnson', email: 'alice@example.com', role: 'admin' },
  { id: '2', name: 'Bob Smith', email: 'bob@example.com', role: 'editor' },
  { id: '3', name: 'Charlie Brown', email: 'charlie@example.com', role: 'viewer' },
]

@Service()
@Resolver('User')
export class UserResolver {
  @Query('users', { returnType: '[User!]!' })
  findAll() {
    return users
  }

  @Query('user', { returnType: 'User' })
  findOne(@Arg('id', 'ID!') id: string) {
    return users.find((u) => u.id === id) ?? null
  }

  @Mutation('createUser', { returnType: 'User!' })
  create(@Arg('name', 'String!') name: string, @Arg('email', 'String!') email: string) {
    const user: User = { id: String(nextId++), name, email, role: 'viewer' }
    users.push(user)
    return user
  }

  @Mutation('deleteUser', { returnType: 'User' })
  delete(@Arg('id', 'ID!') id: string) {
    const index = users.findIndex((u) => u.id === id)
    if (index === -1) return null
    const [removed] = users.splice(index, 1)
    return removed
  }
}
