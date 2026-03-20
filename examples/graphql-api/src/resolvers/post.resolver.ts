import { Service } from '@forinda/kickjs-core'
import { Resolver, Query, Mutation, Arg } from '@forinda/kickjs-graphql'

interface Post {
  id: string
  title: string
  content: string
  authorId: string
}

let nextId = 3

const posts: Post[] = [
  { id: '1', title: 'Getting Started with GraphQL', content: 'GraphQL is a query language...', authorId: '1' },
  { id: '2', title: 'Advanced TypeScript Patterns', content: 'Decorators enable powerful...', authorId: '2' },
]

@Service()
@Resolver('Post')
export class PostResolver {
  @Query('posts', { returnType: '[Post!]!' })
  findAll() {
    return posts
  }

  @Query('post', { returnType: 'Post' })
  findOne(@Arg('id', 'ID!') id: string) {
    return posts.find((p) => p.id === id) ?? null
  }

  @Mutation('createPost', { returnType: 'Post!' })
  create(
    @Arg('title', 'String!') title: string,
    @Arg('content', 'String!') content: string,
    @Arg('authorId', 'ID!') authorId: string,
  ) {
    const post: Post = { id: String(nextId++), title, content, authorId }
    posts.push(post)
    return post
  }
}
